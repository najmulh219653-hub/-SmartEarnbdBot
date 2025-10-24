// server.js (Final PostgreSQL Version)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg'); 

const app = express();
const PORT = process.env.PORT || 3000; 

// ⚠️⚠️ আপনার Neon সংযোগ স্ট্রিং (Connection String) ⚠️⚠️
const DATABASE_URL = 'postgresql://neondb_owner:npg_2bGKhcvWZw9s@ep-spring-field-a158wlgh-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

// PostgreSQL Pool তৈরি করা (SSL আবশ্যক)
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const REFERRAL_POINTS = 250;

// --- ডাটাবেস ইনিশিয়ালাইজেশন ফাংশন ---
async function initializeDB() {
    try {
        const client = await pool.connect();
        
        // 1. users টেবিল তৈরি: শুধুমাত্র প্রয়োজনীয় কলাম রয়েছে
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_user_id TEXT PRIMARY KEY,
                earned_points INTEGER DEFAULT 0,
                referral_count INTEGER DEFAULT 0,
                referer_id TEXT,
                referral_bonus_given INTEGER DEFAULT 0,
                joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. withdrawals টেবিল তৈরি
        await client.query(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                id SERIAL PRIMARY KEY,
                telegram_user_id TEXT,
                points INTEGER,
                payment_method TEXT,
                payment_number TEXT,
                status TEXT DEFAULT 'Pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        client.release();
        console.log('PostgreSQL DB initialized successfully with users and withdrawals tables.');
    } catch (err) {
        console.error('Error during database initialization:', err.message);
    }
}
initializeDB();


// --- API Endpoints ---

// 1. Register or Check User (Referral System Included)
app.post('/api/register_or_check', async (req, res) => {
    const { userId, refererId } = req.body;
    let message = 'User loaded successfully.';
    let client;
    
    try {
        client = await pool.connect();
        
        // **সংশোধিত কোয়ারি:** ত্রুটিপূর্ণ কলামটি (is_referrer_checked) বাদ দেওয়া হয়েছে
        let result = await client.query('SELECT earned_points, referral_count, referral_bonus_given FROM users WHERE telegram_user_id = $1', [userId]);
        let row = result.rows[0];

        if (row) {
            return res.json({ success: true, earned_points: row.earned_points, referral_count: row.referral_count, message });
        } else {
            await client.query('INSERT INTO users (telegram_user_id, referer_id) VALUES ($1, $2)', [userId, refererId]);
            
            // Referral bonus check (যদি রেফারার থাকে এবং বোনাস না দেওয়া থাকে)
            if (refererId && refererId !== userId) {
                let refererResult = await client.query('SELECT referral_bonus_given FROM users WHERE telegram_user_id = $1', [refererId]);
                let referer = refererResult.rows[0];

                if (referer && referer.referral_bonus_given === 0) { 
                    await client.query(
                        'UPDATE users SET earned_points = earned_points + $1, referral_count = referral_count + 1, referral_bonus_given = 1 WHERE telegram_user_id = $2', 
                        [REFERRAL_POINTS, refererId]
                    );
                    message = `Referral bonus of ${REFERRAL_POINTS} points added to referrer ${refererId}'s account.`;
                }
            }

            res.json({ success: true, earned_points: 0, referral_count: 0, message });
        }
    } catch (err) {
        console.error('Register/Check error:', err.message);
        res.status(500).json({ success: false, message: 'Database error.', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// 2. Add Points (For Ads)
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body;
    let client;
    if (points <= 0) return res.status(400).json({ success: false, message: "Invalid points value." });
    try {
        client = await pool.connect();
        await client.query('UPDATE users SET earned_points = earned_points + $1 WHERE telegram_user_id = $2', [points, userId]);
        const result = await client.query('SELECT earned_points FROM users WHERE telegram_user_id = $1', [userId]);
        
        if (result.rows.length === 0) {
             return res.status(404).json({ success: false, message: 'User not found.' });
        }
        res.json({ success: true, new_points: result.rows[0].earned_points });
    } catch (err) {
        console.error('Add points error:', err.message);
        res.status(500).json({ success: false, message: 'Database error.', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// 3. Withdraw Request
app.post('/api/withdraw', async (req, res) => {
    const { userId, pointsToWithdraw, paymentMethod, paymentNumber } = req.body;
    let client;
    if (pointsToWithdraw <= 0) return res.status(400).json({ success: false, message: "Invalid points value." });

    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Transaction শুরু

        const userResult = await client.query('SELECT earned_points FROM users WHERE telegram_user_id = $1 FOR UPDATE', [userId]);
        const user = userResult.rows[0];

        if (!user || user.earned_points < pointsToWithdraw) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Not enough points or User not found.' });
        }

        await client.query('UPDATE users SET earned_points = earned_points - $1 WHERE telegram_user_id = $2', [pointsToWithdraw, userId]);
        await client.query('INSERT INTO withdrawals (telegram_user_id, points, payment_method, payment_number) VALUES ($1, $2, $3, $4)', [userId, pointsToWithdraw, paymentMethod, paymentNumber]);

        await client.query('COMMIT'); // Transaction শেষ

        const newBalanceResult = await client.query('SELECT earned_points FROM users WHERE telegram_user_id = $1', [userId]);
        res.json({ success: true, new_points: newBalanceResult.rows[0].earned_points });

    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(e => console.error('Rollback error', e)); 
        console.error('Withdraw error:', err.message);
        res.status(500).json({ success: false, message: 'Server or transaction error.', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// 4. Admin - Get Stats
app.get('/api/get_admin_stats', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const userStats = await client.query('SELECT COUNT(*) AS total_users, SUM(earned_points) AS total_points FROM users');
        const withdrawalStats = await client.query("SELECT COUNT(*) AS pending_withdrawals FROM withdrawals WHERE status = 'Pending'");

        const stats = {
            total_users: parseInt(userStats.rows[0].total_users) || 0,
            total_points: parseInt(userStats.rows[0].total_points) || 0,
            pending_withdrawals: parseInt(withdrawalStats.rows[0].pending_withdrawals) || 0
        };
        res.json({ success: true, ...stats });
    } catch (err) {
        console.error('Admin Stats error:', err.message);
        res.status(500).json({ success: false, message: 'Database error.', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// 5. Admin - Get Withdrawals by Status
app.get('/api/get_withdrawals', async (req, res) => {
    const status = req.query.status || 'Pending';
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM withdrawals WHERE status = $1 ORDER BY created_at DESC', [status]);
        res.json(result.rows);
    } catch (err) {
        console.error('Get withdrawals error:', err.message);
        res.status(500).json({ success: false, message: 'Database error.', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// 6. Admin - Update Withdrawal Status
app.post('/api/update_withdrawal_status', async (req, res) => {
    const { requestId, status } = req.body;
    let client;
    if (!['Completed', 'Cancelled'].includes(status)) { return res.status(400).json({ success: false, message: 'Invalid status provided.' }); }

    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const updateResult = await client.query('UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *', [status, requestId]);
        
        if (updateResult.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Withdrawal request not found.' }); }
        
        if (status === 'Cancelled') {
            const request = updateResult.rows[0];
            await client.query('UPDATE users SET earned_points = earned_points + $1 WHERE telegram_user_id = $2', [request.points, request.telegram_user_id]);
            await client.query('COMMIT');
            res.json({ success: true, message: `Status updated to ${status}. Points refunded to user ${request.telegram_user_id}.` });
        } else {
            await client.query('COMMIT');
            res.json({ success: true, message: `Status updated to ${status}.` });
        }
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(e => console.error('Rollback error', e));
        console.error('Update status error:', err.message);
        res.status(500).json({ success: false, message: 'Database update failed.', error: err.message });
    } finally {
        if (client) client.release();
    }
});


// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
