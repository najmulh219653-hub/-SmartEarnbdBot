// --- index.js (Render Server Code) ---
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors'); 

const app = express();
const port = process.env.PORT || 10000;

// --- কনস্ট্যান্টস ---
const POINTS_PER_AD = 5; 
const REFERRAL_BONUS_POINTS = 250; 
const POINTS_PER_TAKA = 250; // ২৫০ পয়েন্টে ১ টাকা

// মিডলওয়্যার
app.use(cors({
    origin: ['https://earnquickofficial.netlify.app', 'http://localhost:3000'], // আপনার Netlify ডোমেন
    methods: ['GET', 'POST'],
    credentials: true,
}));
app.use(bodyParser.json());

// PostgreSQL কানেকশন পুল সেটআপ
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// ডেটাবেস কানেকশন টেস্ট
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log("Connected to PostgreSQL database!");
    release();
});

// --- ১. ইউজার ডেটা লোড করা (/api/user/:userId) ---
app.get('/api/user/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const result = await pool.query('SELECT earned_points, referral_count FROM users WHERE telegram_user_id = $1', [userId]);
        
        if (result.rows.length === 0) {
            // নতুন ইউজার, ডাটাবেসে যোগ করা
            await pool.query('INSERT INTO users (telegram_user_id) VALUES ($1)', [userId]);
            return res.json({ 
                success: true, 
                earned_points: 0, 
                referral_count: 0 
            });
        }
        
        const earnedTaka = parseFloat(result.rows[0].earned_points);
        const earnedPoints = Math.round(earnedTaka * POINTS_PER_TAKA);

        res.json({ 
            success: true, 
            earned_points: earnedPoints, 
            referral_count: result.rows[0].referral_count 
        });

    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ success: false, message: 'Server error fetching user data.' });
    }
});

// --- ২. পয়েন্ট যোগ করা (/api/add_points) ---
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body;
    if (!userId || !points) {
        return res.status(400).json({ success: false, message: 'Missing userId or points.' });
    }

    const takaEquivalent = points / POINTS_PER_TAKA;

    try {
        const query = 'UPDATE users SET earned_points = earned_points + $1 WHERE telegram_user_id = $2 RETURNING earned_points';
        const result = await pool.query(query, [takaEquivalent, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        
        const newEarnedTaka = parseFloat(result.rows[0].earned_points);
        const newEarnedPoints = Math.round(newEarnedTaka * POINTS_PER_TAKA);

        res.json({ 
            success: true, 
            new_points: newEarnedPoints, 
            taka_added: takaEquivalent 
        });

    } catch (error) {
        console.error('Error adding points:', error);
        res.status(500).json({ success: false, message: 'Server error adding points.' });
    }
});

// --- ৩. রেফারেল যোগ করা (/api/add_referral) ---
app.post('/api/add_referral', async (req, res) => {
    const { referrerId, newUserId } = req.body;
    
    if (!referrerId || !newUserId) {
        return res.status(400).json({ success: false, message: 'Missing referrerId or newUserId.' });
    }

    if (referrerId === newUserId) {
         return res.status(400).json({ success: false, message: 'Self-referral is not allowed.' });
    }
    
    const bonusTaka = REFERRAL_BONUS_POINTS / POINTS_PER_TAKA; 
    
    const client = await pool.connect();

    try {
        await client.query('BEGIN'); 
        
        // ক. নতুন ইউজারকে ডেটাবেসে যোগ করা (যদি না থাকে)
        const newUserQuery = 'INSERT INTO users (telegram_user_id) VALUES ($1) ON CONFLICT (telegram_user_id) DO NOTHING RETURNING telegram_user_id';
        await client.query(newUserQuery, [newUserId]);

        // খ. রেফারকারীকে বোনাস পয়েন্ট এবং কাউন্ট যোগ করা
        const referrerUpdateQuery = `
            UPDATE users 
            SET earned_points = earned_points + $1, 
                referral_count = referral_count + 1
            WHERE telegram_user_id = $2
            RETURNING telegram_user_id
        `;
        const result = await client.query(referrerUpdateQuery, [bonusTaka, referrerId]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Referrer not found.' });
        }

        await client.query('COMMIT'); 
        res.json({ 
            success: true, 
            message: `Referral bonus of ${REFERRAL_BONUS_POINTS} points added to ${referrerId}.` 
        });

    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error('Error in /api/add_referral:', error);
        res.status(500).json({ success: false, message: 'Server error during referral process.' });
    } finally {
        client.release();
    }
});

// --- ৪. উত্তোলন রিকোয়েস্ট (/api/withdraw) ---
app.post('/api/withdraw', async (req, res) => {
    const { userId, pointsToWithdraw, paymentMethod, paymentNumber } = req.body;
    
    if (!userId || !pointsToWithdraw || !paymentMethod || !paymentNumber) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    
    const takaEquivalent = pointsToWithdraw / POINTS_PER_TAKA;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // ক. ইউজারের বর্তমান ব্যালেন্স চেক করা
        const userResult = await client.query('SELECT earned_points FROM users WHERE telegram_user_id = $1 FOR UPDATE', [userId]);
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        
        const currentTaka = parseFloat(userResult.rows[0].earned_points);
        if (currentTaka < takaEquivalent) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Insufficient balance for withdrawal.' });
        }

        // খ. ব্যালেন্স আপডেট করা
        const updateQuery = 'UPDATE users SET earned_points = earned_points - $1 WHERE telegram_user_id = $2 RETURNING earned_points';
        const updateResult = await client.query(updateQuery, [takaEquivalent, userId]);

        // গ. উত্তোলনের অনুরোধ রেকর্ড করা (যদি আপনার কাছে withdrawals_requests টেবিল থাকে)
        // const withdrawQuery = 'INSERT INTO withdrawals_requests (user_id, amount_points, amount_taka, method, number) VALUES ($1, $2, $3, $4, $5)';
        // await client.query(withdrawQuery, [userId, pointsToWithdraw, takaEquivalent.toFixed(2), paymentMethod, paymentNumber]);

        await client.query('COMMIT');

        const newEarnedTaka = parseFloat(updateResult.rows[0].earned_points);
        const newEarnedPoints = Math.round(newEarnedTaka * POINTS_PER_TAKA);

        res.json({ success: true, new_points: newEarnedPoints });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in /api/withdraw:', error);
        res.status(500).json({ success: false, message: 'Server error during withdrawal process.' });
    } finally {
        client.release();
    }
});

// --- ৫. অ্যাডমিন ডেটা লোড করা (/api/admin/all_users) ---
app.get('/api/admin/all_users', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users');
        
        const users = result.rows.map(row => {
            const earnedTaka = parseFloat(row.earned_points || 0);
            const earnedPoints = Math.round(earnedTaka * POINTS_PER_TAKA);
            
            return {
                id: row.telegram_user_id,
                points: earnedPoints,
                taka: earnedTaka.toFixed(2), // ফিক্সড টু ২ নিশ্চিত করা হলো (toFixed ত্রুটি ফিক্সড)
                referrals: row.referral_count || 0,
                withdraw_requests: row.withdraw_requests_count || 0,
                joined: row.created_at ? new Date(row.created_at).toLocaleDateString() : 'N/A'
            };
        });

        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching admin data:', error);
        res.status(500).json({ success: false, message: 'Server error fetching admin data.' });
    }
});

// সার্ভার চালু
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
