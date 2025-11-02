// server.js

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path'); // Path মডিউল ইম্পোর্ট করা হলো
const db = require('./db'); 

const app = express();
const PORT = process.env.PORT || 10000; 

app.use(bodyParser.json());

// 💡 সংশোধন #১: স্ট্যাটিক ফাইল ডিরেক্টরি স্পষ্টভাবে সেট করা হলো
// এখন এটি সার্ভারের root ফোল্ডারে থাকা 'public' ফোল্ডারটিকে স্ট্যাটিক হিসেবে ব্যবহার করবে।
app.use(express.static(path.join(__dirname, 'public'))); 

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
 */
app.get('/api/user_data', async (req, res) => {
    const telegramId = req.query.id; 
    const username = req.query.username || 'GuestUser'; 

    if (!telegramId) {
        return res.status(400).json({ success: false, message: 'Telegram ID is required.' });
    }

    try {
        const userResult = await db.query(
            `INSERT INTO users (telegram_id, username) 
             VALUES ($1, $2)
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = EXCLUDED.username
             RETURNING telegram_id, username, total_points, referrer_id, is_admin`,
            [telegramId, username]
        );
        
        const user = userResult.rows[0];

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
 * পয়েন্ট যোগ করার API (Data Type ও User Check সহ সংশোধিত)
 */
app.post('/api/add_points', async (req, res) => {
    const { telegramId, points } = req.body; 
    const pointsToAdd = parseInt(points);

    // 💡 Data Type Validation: NaN, 0 বা নেগেটিভ পয়েন্ট চেক করা
    if (!telegramId || isNaN(pointsToAdd) || pointsToAdd <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid point amount received. Please reload the app or contact support.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN'); 
        
        // User Check: ইউজার ডাটাবেসে আছে কিনা যাচাই করা
        const userCheck = await client.query('SELECT 1 FROM users WHERE telegram_id = $1', [telegramId]);
        
        if (userCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'User account not found. Please reload the app to create your profile.' });
        }


        // Update user points
        const updateQuery = `
            UPDATE users 
            SET total_points = total_points + $1 
            WHERE telegram_id = $2 
            RETURNING total_points`;
            
        const updateResult = await client.query(updateQuery, [pointsToAdd, telegramId]);


        // Log the ad view
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

// ... (বাকি API এন্ডপয়েন্টগুলি একই থাকবে)

// রুট URL-এ index.html ফাইল পরিবেশন করা
app.get('/', (req, res) => {
    // 💡 সংশোধন #২: 'public' ফোল্ডারের মধ্যে index.html ফাইলটি দেখানো হলো
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 এরর হ্যান্ডলিং: API কল ছাড়া অন্য কিছু হলে index.html ফাইল পরিবেশন করা
app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
        next(); 
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// ... (বাকি admin API কোড)

/**
 * অ্যাপ কনফিগারেশন ডেটা লোড করার API (আগের মতোই)
 */
app.get('/api/config', async (req, res) => {
    try {
        const result = await db.query('SELECT config_key, config_value FROM ads_config');
        
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
 * উইথড্র রিকোয়েস্ট করার API (আগের মতোই)
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

        const updatePointsResult = await client.query(
            'UPDATE users SET total_points = total_points - $1 WHERE telegram_id = $2 RETURNING total_points',
            [pointsRequested, telegramId]
        );

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


/**
 * এডমিন স্ট্যাটাস চেক করার মিডলওয়্যার (আগের মতোই)
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
 * পেন্ডিং উইথড্র রিকোয়েস্ট লোড করার API (আগের মতোই)
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
 * উইথড্র রিকোয়েস্টের স্ট্যাটাস আপডেট করার API (আগের মতোই)
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

        await client.query(
            'UPDATE withdraw_requests SET status = $1, processed_at = NOW() WHERE id = $2',
            [newStatus, requestId]
        );

        if (action === 'Reject') {
            await client.query(
                'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
                [points_requested, user_telegram_id]
            );
            
            await client.query('COMMIT');
            return res.json({ success: true, message: `Request ${requestId} rejected. Points returned to user.` });
        }

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
