// index.js (সম্পূর্ণ সংশোধিত কোড)

const express = require('express');
const { Pool } = require('pg'); 
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 10000; 

// --- গ্লোবাল কনস্ট্যান্টস (নতুন লস-প্রুফ রেট) ---
const POINTS_PER_TAKA = 250; // ২৫০ পয়েন্টে ১ টাকা (আগে ছিল ৫০)
const REFERRAL_BONUS_POINTS = 250; // ২৫০ পয়েন্ট রেফারেল বোনাস
const POINTS_PER_AD = 5; // প্রতি বিজ্ঞাপনে ৫ পয়েন্ট

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

app.use((req, res, next) => {
    const allowedOrigins = [
        'https://earnquickofficial.blogspot.com', 
        'https://t.me', 
        'http://localhost:3000', 
        'https://earnquickofficial.netlify.app' // আপনার ফ্রন্টএন্ড ডোমেন
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
            // নতুন ইউজার তৈরি
            await client.query('INSERT INTO users(telegram_user_id) VALUES($1)', [userId]);
            result = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [userId]);
        }
        
        const userData = result.rows[0];
        // ডাটাবেসে টাকা (taka) হিসেবে সেভ করা আছে, এটিকে পয়েন্ট (points) হিসেবে কনভার্ট করে পাঠানো হলো
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
    const takaValue = points / POINTS_PER_TAKA; // 5 পয়েন্ট / 250 = 0.02 টাকা যোগ হচ্ছে
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

// ৩. রেফারেল বোনাস যোগ করা (সমস্যাটি সমাধান করা হয়েছে)
app.post('/api/add_referral', async (req, res) => {
    const { referrerId, newUserId } = req.body; 
    const takaValue = REFERRAL_BONUS_POINTS / POINTS_PER_TAKA; // 250 পয়েন্ট / 250 = 1 টাকা বোনাস 
    let client;
    
    if (!referrerId || !newUserId || referrerId === newUserId) {
        return res.status(400).json({ success: false, message: 'Invalid or self-referral attempt.' });
    }

    try {
        client = await pool.connect();
        await client.query('BEGIN'); // ট্রানজাকশন শুরু

        // রেফারের পয়েন্ট ও কাউন্ট আপডেট করা হলো
        const referrerUpdateResult = await client.query(
            'UPDATE users SET earned_points = earned_points + $1, referral_count = referral_count + 1 WHERE telegram_user_id = $2 RETURNING earned_points, referral_count',
            [takaValue, referrerId]
        );

        if (referrerUpdateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Referrer not found.' });
        }
        
        await client.query('COMMIT'); // ট্রানজাকশন সফল: কমপ্লিট করা হলো

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

// ৪. উত্তোলন অনুরোধ API (১০,০০০ পয়েন্ট ন্যূনতম)
app.post('/api/withdraw', async (req, res) => {
    const { userId, pointsToWithdraw, paymentMethod, paymentNumber } = req.body; 

    // নতুন রেট অনুযায়ী ন্যূনতম উত্তোলন ১০,০০০ পয়েন্ট
    if (pointsToWithdraw < 10000) {
         return res.status(400).json({ success: false, message: 'উত্তোলনের ডেটা সম্পূর্ণ নয় বা সর্বনিম্ন পয়েন্ট পূরণ হয়নি (১০০০০)।' });
    }
    
    const takaToDeduct = pointsToWithdraw / POINTS_PER_TAKA; // ১০০০০ পয়েন্ট / ২৫০ = ৪০ টাকা

    if (!userId || !paymentMethod || !paymentNumber) {
        return res.status(400).json({ success: false, message: 'উত্তোলনের ডেটা সম্পূর্ণ নয় বা সর্বনিম্ন পয়েন্ট পূরণ হয়নি (১০০০০)।' });
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

// ৫. API: সকল ইউজার ডেটা দেখা (ড্যাশবোর্ডের জন্য - ত্রুটি সমাধান করা হয়েছে)
app.get('/api/admin/all_users', async (req, res) => {
    let client;
    try {
        client = await pool.connect(); 
        
        const result = await client.query(
            `SELECT 
                telegram_user_id, 
                (earned_points * ${POINTS_PER_TAKA}) AS earned_points_in_points, 
                earned_points AS earned_points_in_taka, 
                referral_count,
                created_at
            FROM users 
            ORDER BY earned_points DESC`
        );
        
        const withdrawResult = await client.query(
            `SELECT 
                user_id, 
                COUNT(*) as total_requests
            FROM withdrawals_requests
            GROUP BY user_id`
        );

        const withdrawCounts = withdrawResult.rows.reduce((acc, row) => {
            acc[row.user_id] = parseInt(row.total_requests);
            return acc;
        }, {});


        const usersData = result.rows.map(user => ({
            id: user.telegram_user_id,
            points: Math.round(user.earned_points_in_points),
            // parseFloat ব্যবহার করে স্ট্রিংকে সংখ্যায় রূপান্তর করে toFixed() ব্যবহার করা হয়েছে
            taka: parseFloat(user.earned_points_in_taka).toFixed(2), 
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
