// Express সার্ভার এবং ডাটাবেস সংযোগের জন্য
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db'); 

const app = express();
// পরিবেশ ভেরিয়েবল থেকে পোর্ট ব্যবহার করা
const PORT = process.env.PORT || 3000; 

// মিডলওয়্যার সেটআপ: JSON অনুরোধ এবং স্ট্যাটিক ফাইল হ্যান্ডেল করা
app.use(bodyParser.json());
app.use(express.static(__dirname)); 

// সার্ভার শুরু করার আগে ডাটাবেস সেটআপ নিশ্চিত করা
db.setupDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running successfully on port ${PORT}`);
    });
}).catch(err => {
    console.error('FATAL: Failed to start server due to database setup error:', err);
    process.exit(1); 
});


// =======================================================
// API Endpoints
// =======================================================

/**
 * ইউজার ডেটা লোড করার API
 * is_admin স্ট্যাটাস সহ ইউজার ডেটা রিটার্ন করবে।
 */
app.get('/api/user_data', async (req, res) => {
    const telegramId = req.query.id; 
    const username = req.query.username || 'GuestUser'; 

    if (!telegramId) {
        return res.status(400).json({ success: false, message: 'Telegram ID is required.' });
    }

    try {
        // ইউজার ডেটা আনা, না থাকলে INSERT, এবং is_admin সহ রিটার্ন করা
        const userResult = await db.query(
            `INSERT INTO users (telegram_id, username) 
             VALUES ($1, $2)
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = EXCLUDED.username
             RETURNING telegram_id, username, total_points, referrer_id, is_admin`, // is_admin যোগ করা হলো
            [telegramId, username]
        );
        
        const user = userResult.rows[0];

        // রেফারাল সংখ্যা গণনা করা
        const referralCountResult = await db.query(
            'SELECT COUNT(*) FROM users WHERE referrer_id = $1',
            [telegramId]
        );

        user.referral_count = parseInt(referralCountResult.rows[0].count) || 0;

        res.json({ success: true, user });

    } catch (error) {
        console.error('Error fetching user data:', error.stack);
        res.status(500).json({ success: false, message: 'Server error while loading data.' });
    }
});

/**
 * অ্যাপ কনফিগারেশন ডেটা লোড করার API (ব্যানার, নোটিশ)
 * Endpoint: /api/config
 */
app.get('/api/config', async (req, res) => {
    try {
        const result = await db.query('SELECT config_key, config_value FROM ads_config');
        
        // কী-ভ্যালু পেয়ার হিসেবে ডেটা সাজানো
        const config = result.rows.reduce((acc, row) => {
            acc[row.config_key] = row.config_value;
            return acc;
        }, {});
        
        res.json({ success: true, config });

    } catch (error) {
        console.error('Error fetching config data:', error.stack);
        res.status(500).json({ success: false, message: 'Failed to load app configuration.' });
    }
});


/**
 * পয়েন্ট যোগ করার API
 * Endpoint: /api/add_points
 */
app.post('/api/add_points', async (req, res) => {
    const { telegramId, points } = req.body; 
    const pointsToAdd = parseInt(points);

    if (!telegramId || isNaN(pointsToAdd) || pointsToAdd <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid input for points or ID.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN'); 

        // 1. user এর total_points আপডেট করা
        const updateQuery = `
            UPDATE users 
            SET total_points = total_points + $1 
            WHERE telegram_id = $2 
            RETURNING total_points`;
            
        const updateResult = await client.query(updateQuery, [pointsToAdd, telegramId]);

        if (updateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found for points update.' });
        }

        // 2. ad_logs টেবিলে লগ যোগ করা
        const logQuery = `
            INSERT INTO ad_logs (user_telegram_id, points_awarded) 
            VALUES ($1, $2)`;
            
        await client.query(logQuery, [telegramId, pointsToAdd]); 

        await client.query('COMMIT'); 

        res.json({ 
            success: true, 
            message: 'Points added successfully.',
            newPoints: updateResult.rows[0].total_points
        });
        
    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error('Error adding points and logging:', error.stack);
        res.status(500).json({ success: false, message: 'Server error while adding points.' });
    } finally {
        client.release();
    }
});

/**
 * উইথড্র রিকোয়েস্ট করার API
 * Endpoint: /api/request_withdraw
 */
app.post('/api/request_withdraw', async (req, res) => {
    const { telegramId, points, account } = req.body;
    const pointsRequested = parseInt(points);
    const MIN_WITHDRAW_POINTS = 5000; 

    if (!telegramId || isNaN(pointsRequested) || pointsRequested < MIN_WITHDRAW_POINTS || !account || account.trim() === '') {
        return res.status(400).json({ success: false, message: `Invalid input or minimum withdrawal is ${MIN_WITHDRAW_POINTS} points.` });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // 1. ইউজার এর পর্যাপ্ত পয়েন্ট আছে কিনা যাচাই করা এবং লক করা
        const userCheckResult = await client.query(
            'SELECT total_points FROM users WHERE telegram_id = $1 FOR UPDATE', 
            [telegramId]
        );

        if (userCheckResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const currentPoints = userCheckResult.rows[0].total_points;

        if (currentPoints < pointsRequested) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Insufficient points for withdrawal.' });
        }

        // 2. total_points থেকে পয়েন্ট বিয়োগ করা
        const updatePointsResult = await client.query(
            'UPDATE users SET total_points = total_points - $1 WHERE telegram_id = $2 RETURNING total_points',
            [pointsRequested, telegramId]
        );

        // 3. withdraw_requests টেবিলে লগ করা (স্ট্যাটাস 'Pending')
        const logWithdrawalQuery = `
            INSERT INTO withdraw_requests (user_telegram_id, points_requested, payment_details)
            VALUES ($1, $2, $3)`;
            
        await client.query(logWithdrawalQuery, [telegramId, pointsRequested, JSON.stringify({ account })]);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Withdrawal request submitted successfully.',
            newPoints: updatePointsResult.rows[0].total_points
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing withdrawal request:', error.stack);
        res.status(500).json({ success: false, message: 'Server error while processing withdrawal.' });
    } finally {
        client.release();
    }
});


// =======================================================
// Admin API Endpoints
// =======================================================

/**
 * এডমিন স্ট্যাটাস চেক করার মিডলওয়্যার
 */
async function checkAdmin(req, res, next) {
    const telegramId = req.query.id || req.body.adminId;

    if (!telegramId) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin ID required.' });
    }

    try {
        const result = await db.query('SELECT is_admin FROM users WHERE telegram_id = $1', [telegramId]);

        if (result.rows.length === 0 || !result.rows[0].is_admin) {
            return res.status(403).json({ success: false, message: 'Forbidden: User is not an admin.' });
        }
        next();
    } catch (error) {
        console.error('Admin check error:', error.stack);
        res.status(500).json({ success: false, message: 'Server error during admin verification.' });
    }
}


/**
 * পেন্ডিং উইথড্র রিকোয়েস্ট লোড করার API
 * Endpoint: /api/admin/withdrawals?id=<adminId>
 */
app.get('/api/admin/withdrawals', checkAdmin, async (req, res) => {
    try {
        const query = `
            SELECT 
                wr.id, 
                wr.user_telegram_id, 
                wr.points_requested, 
                wr.payment_details,
                wr.requested_at,
                u.username 
            FROM withdraw_requests wr
            JOIN users u ON wr.user_telegram_id = u.telegram_id
            WHERE wr.status = 'Pending'
            ORDER BY wr.requested_at ASC`;

        const result = await db.query(query);

        res.json({ success: true, withdrawals: result.rows });
    } catch (error) {
        console.error('Error fetching withdrawals:', error.stack);
        res.status(500).json({ success: false, message: 'Failed to fetch pending withdrawals.' });
    }
});


/**
 * উইথড্র রিকোয়েস্টের স্ট্যাটাস আপডেট করার API
 * Endpoint: /api/admin/update_withdrawal
 * body: { adminId: number, requestId: number, action: 'Approve' | 'Reject' }
 */
app.post('/api/admin/update_withdrawal', checkAdmin, async (req, res) => {
    const { requestId, action } = req.body; 

    if (!requestId || !['Approve', 'Reject'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Invalid request parameters.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const requestQuery = await client.query(
            'SELECT user_telegram_id, points_requested, status FROM withdraw_requests WHERE id = $1 FOR UPDATE', 
            [requestId]
        );

        if (requestQuery.rows.length === 0 || requestQuery.rows[0].status !== 'Pending') {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Withdrawal request not found or already processed.' });
        }

        const { user_telegram_id, points_requested } = requestQuery.rows[0];
        
        let newStatus = action === 'Approve' ? 'Paid' : 'Rejected';

        // 1. উইথড্র রিকোয়েস্ট আপডেট করা
        await client.query(
            'UPDATE withdraw_requests SET status = $1, processed_at = NOW() WHERE id = $2',
            [newStatus, requestId]
        );

        // 2. Reject হলে পয়েন্ট ফেরত দেওয়া
        if (action === 'Reject') {
            await client.query(
                'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
                [points_requested, user_telegram_id]
            );
            
            await client.query('COMMIT');
            return res.json({ success: true, message: `Request ${requestId} rejected. Points returned to user.` });
        }

        // Approve হলে (পয়েন্ট আগে থেকেই ডিডাক্ট করা ছিল)
        await client.query('COMMIT');
        res.json({ success: true, message: `Request ${requestId} approved and marked as Paid.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating withdrawal status:', error.stack);
        res.status(500).json({ success: false, message: 'Server error while processing admin action.' });
    } finally {
        client.release();
    }
});


// 404 এরর হ্যান্ডলিং: HTML ফাইল পরিবেশন করা
app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
        next(); 
    } else {
        res.sendFile(path.join(__dirname, 'Blogger_MiniApp_UI.html'));
    }
});

// রুট URL-এ HTML ফাইল পরিবেশন করা
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Blogger_MiniApp_UI.html'));
});
