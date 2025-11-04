// server.js (চূড়ান্ত সংশোধিত কোড)
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
// নিশ্চিত করুন যে db.js ফাইলটি একই ডিরেক্টরিতে আছে
const db = require('./db'); 

const app = express();
// Render-এর জন্য Port ব্যবহার
const PORT = process.env.PORT || 10000; 

// Render-এর জন্য প্রক্সি ট্রাস্ট সক্ষম করা
app.set('trust proxy', true); 

app.use(bodyParser.json());

// 💡 সমাধান: static ফাইল লোড করার জন্য, যেখানে index.html আছে 
// যেহেতু index.html main directory তে আছে, তাই শুধু __dirname ব্যবহার করা হলো।
app.use(express.static(path.join(__dirname))); 

// সার্ভার এবং ডাটাবেস সেটআপ লজিক
// Port scan timeout ত্রুটি এড়াতে ডাটাবেস সংযোগের আগেই সার্ভার চালু করার জন্য লজিকটিকে সরল করা হলো।
// ডাটাবেস সংযোগ চেষ্টা করবে, ব্যর্থ হলেও সার্ভার চালু থাকবে।
db.setupDatabase().then(() => {
    console.log('Database setup complete and successful.');
}).catch(err => {
    // ডাটাবেস সংযোগ ব্যর্থ হলেও Render যেন Port scan timeout না দেখায়, তাই সার্ভার চালু থাকবে।
    console.error('Warning: Database setup failed. Server will start but API calls may fail:', err);
});

// সরাসরি সার্ভার শুরু করুন (Port scan timeout ত্রুটির সমাধান)
app.listen(PORT, () => {
    console.log(`Server is running successfully on port ${PORT}`);
});


// =======================================================
// API Endpoints
// =======================================================

// ইউজার ডেটা লোড এবং রেজিস্ট্রেশন (রেফারেল সহ)
app.get('/api/user_data', async (req, res) => {
    const telegramId = req.query.id; 
    const username = req.query.username || 'GuestUser'; 
    const referrerIdFromUrl = req.query.start; 

    if (!telegramId) {
        return res.status(400).json({ success: false, message: 'Telegram ID is required.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const existingUserResult = await client.query('SELECT telegram_id, referrer_id, is_admin FROM users WHERE telegram_id = $1', [telegramId]);
        
        let referralRewardGiven = false;

        if (existingUserResult.rows.length === 0) {
            // নতুন ইউজার রেজিস্ট্রেশন এবং রেফারেল লজিক
            let referrerId = null;
            let referrerExists = false;

            if (referrerIdFromUrl && referrerIdFromUrl !== telegramId) {
                const referrerCheck = await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [referrerIdFromUrl]);
                if (referrerCheck.rows.length > 0) {
                    referrerId = referrerIdFromUrl;
                    referrerExists = true;
                }
            }
            
            await client.query(
                `INSERT INTO users (telegram_id, username, referrer_id) 
                 VALUES ($1, $2, $3)`,
                [telegramId, username, referrerId]
            );

            if (referrerExists) {
                // রেফারেল বোনাস লজিক
                const configResult = await client.query('SELECT config_key, config_value FROM ads_config WHERE config_key IN ($1, $2)', ['referral_bonus_new_user', 'referral_bonus_referrer']);
                const config = configResult.rows.reduce((acc, row) => {
                    acc[row.config_key] = parseInt(row.config_value) || 0;
                    return acc;
                }, {});

                const newUserBonus = config.referral_bonus_new_user || 50;
                const referrerBonus = config.referral_bonus_referrer || 100;
                
                await client.query(
                    'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
                    [newUserBonus, telegramId]
                );
                
                await client.query(
                    'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
                    [referrerBonus, referrerId]
                );
                
                referralRewardGiven = true;
            }
        } else {
             // বিদ্যমান ব্যবহারকারীর জন্য ইউজারনেম আপডেট করা
             await client.query(
                'UPDATE users SET username = $1 WHERE telegram_id = $2',
                [username, telegramId]
            );
        }

        // ইউজার ডেটা লোড
        const userResult = await client.query(
            'SELECT telegram_id, username, total_points, referrer_id, is_admin FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        const user = userResult.rows[0];

        // রেফারেল কাউন্ট
        const referralCountResult = await client.query(
            'SELECT COUNT(*) FROM users WHERE referrer_id = $1',
            [telegramId]
        );

        user.referral_count = parseInt(referralCountResult.rows[0].count) || 0;

        await client.query('COMMIT');
        
        res.json({ success: true, user, referralRewardGiven });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error fetching user data/registration:', error.stack);
        res.status(500).json({ success: false, message: 'Server error during user data load.' });
    } finally {
        client.release();
    }
});


// অ্যাপ কনফিগারেশন ডেটা লোড করার API (unchanged)
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


// পয়েন্ট যোগ করার API (Add Points API - Unchanged)
app.post('/api/add_points', async (req, res) => {
    const { telegramId, points } = req.body; 
    const pointsToAdd = parseInt(points);

    if (!telegramId || isNaN(pointsToAdd) || pointsToAdd <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid point amount received. Please reload the app or contact support.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN'); 
        
        const updateQuery = `
            UPDATE users 
            SET total_points = total_points + $1 
            WHERE telegram_id = $2 
            RETURNING total_points`;
            
        const updateResult = await client.query(updateQuery, [pointsToAdd, telegramId]);

        if (updateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User account not found. Please reload the app to create your profile.' });
        }

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


// উইথড্র রিকোয়েস্ট করার API (Withdraw API - Unchanged)
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


// এডমিন প্যানেল API (Admin Panel APIs - Unchanged)
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


// রুট এবং 404 হ্যান্ডলার
// 💡 index.html লোড করার জন্য
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// অন্য কোনো রুট বা 404 হলেও index.html দেখাবে, যদি API কল না হয়
app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
        next(); 
    } else {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});
