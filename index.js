// index.js (GitHub) - চূড়ান্ত সংশোধিত কোড
const express = require('express');
const { Pool } = require('pg'); 
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 10000; 

// --- গ্লোবাল কনস্ট্যান্টস ---
const POINTS_PER_TAKA = 50; 
const REFERRAL_BONUS_POINTS = 250; 
const POINTS_PER_AD = 1; 

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

// Middleware and CORS 
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

// ★★★ CORS সেটিংস ★★★
app.use((req, res, next) => {
    // Netlify URL এবং Telegram Webview-কে অনুমোদন দেওয়া হলো
    const allowedOrigins = [
        'https://earnquickofficial.blogspot.com', // পুরাতন URL, ব্যাকআপের জন্য রাখা হলো
        'https://t.me', 
        'http://localhost:3000', 
        'https://earnquickofficial.netlify.app' // আপনার নতুন Netlify URL
    ]; 
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
            earned_points: Math.round(userData.earned_points * POINTS_PER_TAKA), // পয়েন্ট হিসেবে পাঠানো হলো
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

// ৪. উত্তোলন অনুরোধ API
app.post('/api/withdraw', async (req, res) => {
    const { userId, pointsToWithdraw, paymentMethod, paymentNumber } = req.body; 

    const takaToDeduct = pointsToWithdraw / POINTS_PER_TAKA;

    if (!userId || pointsToWithdraw < 2000 || !paymentMethod || !paymentNumber) {
        return res.status(400).json({ success: false, message: 'উত্তোলনের ডেটা সম্পূর্ণ নয় বা সর্বনিম্ন পয়েন্ট পূরণ হয়নি (২০০০)।' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN'); 

        const userResult = await client.query(
            'SELECT earned_points FROM users WHERE telegram_user_id = $1 FOR UPDATE', 
            [userId]
        );

        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'ইউজার খুঁজে পাওয়া যায়নি।' });
        }

        const currentTakaBalance = userResult.rows[0].earned_points;

        if (currentTakaBalance < takaToDeduct) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'উত্তোলনের জন্য পর্যাপ্ত পয়েন্ট নেই। (ডাটাবেস চেক ফেল)' });
        }

        const newTakaBalance = currentTakaBalance - takaToDeduct;

        await client.query(
            'UPDATE users SET earned_points = $1 WHERE telegram_user_id = $2',
            [newTakaBalance, userId]
        );

        await client.query(
            'INSERT INTO withdrawals_requests (user_id, amount_points, amount_taka, method, number, status, requested_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
            [userId, pointsToWithdraw, takaToDeduct, paymentMethod, paymentNumber, 'Pending']
        );

        await client.query('COMMIT'); 

        const newPoints = Math.round(newTakaBalance * POINTS_PER_TAKA);

        res.json({ success: true, new_points: newPoints, message: "উত্তোলন সফলভাবে জমা হয়েছে।" });

    } catch (err) {
        if (client) await client.query('ROLLBACK'); 
        console.error('Error in /api/withdraw (Transaction failed):', err);
        res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি। উত্তোলন প্রক্রিয়া করা যায়নি।' });
    } finally {
        if (client) client.release();
    }
});

// ৫. ★★★ নতুন API: সকল ইউজার ডেটা দেখা (ড্যাশবোর্ডের জন্য) ★★★
app.get('/api/admin/all_users', async (req, res) => {
    let client;
    try {
        client = await pool.connect(); 
        
        // সকল ইউজারকে তাদের পয়েন্টের ভিত্তিতে সাজিয়ে দেখা
        const result = await client.query(
            `SELECT 
                telegram_user_id, 
                (earned_points * 50) AS earned_points_in_points, 
                earned_points AS earned_points_in_taka, 
                referral_count,
                created_at
            FROM users 
            ORDER BY earned_points DESC`
        );
        
        // উত্তোলনের অনুরোধের সংখ্যা দেখা
        const withdrawResult = await client.query(
            `SELECT 
                user_id, 
                COUNT(*) as total_requests
            FROM withdrawals_requests
            GROUP BY user_id`
        );

        // উত্তোলনের সংখ্যা ম্যাপ করা
        const withdrawCounts = withdrawResult.rows.reduce((acc, row) => {
            acc[row.user_id] = parseInt(row.total_requests);
            return acc;
        }, {});


        const usersData = result.rows.map(user => ({
            id: user.telegram_user_id,
            points: Math.round(user.earned_points_in_points),
            taka: user.earned_points_in_taka.toFixed(2),
            referrals: user.referral_count,
            withdraw_requests: withdrawCounts[user.telegram_user_id] || 0, 
            joined: user.created_at.toISOString().split('T')[0]
        }));
        
        res.json({ success: true, users: usersData });
        
    } catch (err) {
        console.error('Error in /api/admin/all_users:', err);
        res.status(500).json({ success: false, message: 'Server Error: Could not fetch user data.' });
    } finally {
        if (client) client.release();
    }
});


// --- সার্ভার চালু করা ---
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
