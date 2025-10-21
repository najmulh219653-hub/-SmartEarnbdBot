// index.js (GitHub)
const express = require('express');
const { Pool } = require('pg'); 
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 10000; 

// --- গ্লোবাল কনস্ট্যান্টস ---
const POINTS_PER_TAKA = 50; 
const REFERRAL_BONUS_POINTS = 250; 

// --- PostgreSQL Pool সেটআপ ---
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL environment variable is not set. Cannot proceed.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL, 
    ssl: { rejectUnauthorized: false },
    idleTimeoutMillis: 30000, 
    connectionTimeoutMillis: 20000,
    max: 10, 
});

// Middleware and CORS (CORS is critical for Mini App security)
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    // Blogspot URL নিশ্চিত করা হয়েছে
    const allowedOrigins = ['https://earnquickofficial.blogspot.com', 'https://t.me', 'http://localhost:3000']; 
    const origin = req.headers.origin;
    
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// --- API Routes ---

// ১. ইউজার ডেটা লোড বা তৈরি করা
app.get('/api/user/:userId', async (req, res) => {
    const userId = req.params.userId;
    let client;
    try {
        client = await pool.connect(); 
        let result = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [userId]);
        
        if (result.rows.length === 0) {
            await client.query('INSERT INTO users(telegram_user_id) VALUES($1)', [userId]);
            result = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [userId]);
        }
        
        const userData = result.rows[0];
        res.json({
            telegram_user_id: userData.telegram_user_id,
            earned_points: Math.round(userData.earned_points * POINTS_PER_TAKA), 
            referral_count: userData.referral_count,
        });
    } catch (err) {
        console.error('Error in /api/user:', err);
        res.status(500).send('Server Error');
    } finally {
        if (client) client.release();
    }
});

// ২. পয়েন্ট আপডেট করা (বিজ্ঞাপন দেখার পর)
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body; 
    const takaValue = points / POINTS_PER_TAKA; 
    let client;
    
    if (!userId || typeof points !== 'number' || points <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid input data.' });
    }
    
    try {
        client = await pool.connect();
        const result = await client.query(
            'UPDATE users SET earned_points = earned_points + $1 WHERE telegram_user_id = $2 RETURNING earned_points',
            [takaValue, userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).send('User not found');
        }
        
        const newPoints = Math.round(result.rows[0].earned_points * POINTS_PER_TAKA);
        res.json({ success: true, new_points: newPoints });
    } catch (err) {
        console.error('Error in /api/add_points:', err);
        res.status(500).send('Server Error');
    } finally {
        if (client) client.release();
    }
});

// ৩. রেফারেল বোনাস যোগ করা
app.post('/api/add_referral', async (req, res) => {
    const { referrerId, newUserId } = req.body; 
    const takaValue = REFERRAL_BONUS_POINTS / POINTS_PER_TAKA; 
    let client;
    
    if (!referrerId || !newUserId || referrerId === newUserId) {
        return res.status(400).json({ success: false, message: 'Invalid or self-referral attempt.' });
    }

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const referrerUpdateResult = await client.query(
            'UPDATE users SET earned_points = earned_points + $1, referral_count = referral_count + 1 WHERE telegram_user_id = $2 RETURNING earned_points, referral_count',
            [takaValue, referrerId]
        );

        if (referrerUpdateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Referrer not found.' });
        }
        
        await client.query('COMMIT'); 

        const newPoints = Math.round(referrerUpdateResult.rows[0].earned_points * POINTS_PER_TAKA);

        res.json({ 
            success: true, 
            message: `Referral successful. ${REFERRAL_BONUS_POINTS} points added.`, 
            new_points: newPoints,
        });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('Error in /api/add_referral (Transaction failed):', err);
        res.status(500).json({ success: false, message: 'Referral transaction failed.' });
    } finally {
        if (client) client.release();
    }
});

// ৪. উত্তোলন অনুরোধ API (এখনও ডেভেলপমেন্টে)
app.post('/api/withdraw', async (req, res) => {
    res.status(501).json({ success: false, message: 'Withdrawal API is under development.' });
});


// --- সার্ভার চালু করা ---
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
