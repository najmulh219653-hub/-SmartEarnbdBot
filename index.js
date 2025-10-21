// index.js (Final and STABLE Server Code)

const express = require('express');
const { Pool } = require('pg'); // *** Client এর বদলে Pool ব্যবহার করা হলো ***
const dotenv = require('dotenv');

dotenv.config();

const app = express();
// Render সাধারণত পরিবেশ ভেরিয়েবল থেকে পোর্টে বাইন্ড করে। 
// 10000 পোর্টটি আপনার লগে দেখা যাচ্ছিল, তাই এটিই রাখা হলো।
const port = process.env.PORT || 10000; 

// 🚨 PostgreSQL পুল সেটআপ
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
}

// *** নতুন Pool ইনস্ট্যান্স ***
const pool = new Pool({
    connectionString: DATABASE_URL, 
    ssl: {
        rejectUnauthorized: false
    },
    // ফ্রি-টিয়ার ব্যবহারের জন্য গুরুত্বপূর্ণ:
    // যখন ক্লায়েন্ট সংযোগের প্রয়োজন হবে, Pool তখন সংযোগ তৈরি করবে।
    // নিষ্ক্রিয় সংযোগগুলি Pool নিজেই হ্যান্ডেল করবে।
    idleTimeoutMillis: 30000, // 30 সেকেন্ড পর নিষ্ক্রিয় ক্লায়েন্ট বন্ধ হবে
    connectionTimeoutMillis: 20000,
});


// ডেটাবেস সংযোগ পরীক্ষা
async function connectToDatabase() {
    try {
        const client = await pool.connect();
        client.release(); // সংযোগ পরীক্ষা করার পর ছেড়ে দেওয়া
        console.log('Successfully connected to Neon PostgreSQL Pool!');
    } catch (err) {
        console.error('FATAL: Database connection error during startup check. Check DATABASE_URL and network.', err.stack);
        process.exit(1); 
    }
}

// Middleware
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

// CORS কনফিগারেশন:
app.use((req, res, next) => {
    const allowedOrigins = ['https://earnquickofficial.blogspot.com']; 
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
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
    let client; // ক্লায়েন্ট ভেরিয়েবল ঘোষণা
    try {
        client = await pool.connect(); // পুল থেকে ক্লায়েন্ট নেওয়া
        
        let result = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [userId]);
        
        if (result.rows.length === 0) {
            await client.query('INSERT INTO users(telegram_user_id) VALUES($1)', [userId]);
            result = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [userId]);
        }
        
        const userData = result.rows[0];
        const responseData = {
            telegram_user_id: userData.telegram_user_id,
            earned_points: Math.round(userData.earned_points * 50), 
            referral_count: userData.referral_count,
        };

        res.json(responseData);
    } catch (err) {
        console.error('Error in /api/user:', err);
        res.status(500).send('Server Error');
    } finally {
        if (client) client.release(); // রিকোয়েস্ট শেষে ক্লায়েন্ট পুল-এ ফেরত দেওয়া
    }
});

// ২. পয়েন্ট আপডেট করা (বিজ্ঞাপন দেখার পর)
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body; 
    
    if (!userId || typeof points !== 'number' || points <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid input data.' });
    }
    
    const takaValue = points / 50; 
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            'UPDATE users SET earned_points = earned_points + $1 WHERE telegram_user_id = $2 RETURNING earned_points',
            [takaValue, userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).send('User not found');
        }
        
        const newPoints = Math.round(result.rows[0].earned_points * 50);
        res.json({ success: true, new_points: newPoints });
    } catch (err) {
        console.error('Error in /api/add_points:', err);
        res.status(500).send('Server Error');
    } finally {
        if (client) client.release();
    }
});

// ৩. উত্তোলন অনুরোধ API (Withdrawal Request)
app.post('/api/withdraw', async (req, res) => {
    const { userId, amountPoints, paymentMethod, phoneNumber } = req.body;
    const minWithdrawPoints = 1000;
    const amountTakaToDeduct = amountPoints / 50;
    let client;
    
    if (!userId || !paymentMethod || !phoneNumber || typeof amountPoints !== 'number' || amountPoints < minWithdrawPoints) {
        return res.status(400).json({ success: false, message: `Invalid request or minimum withdrawal is ${minWithdrawPoints} points (৳20).` });
    }

    try {
        client = await pool.connect(); // পুল থেকে ক্লায়েন্ট নেওয়া
        await client.query('BEGIN'); // Transaction শুরু

        const balanceResult = await client.query('SELECT earned_points FROM users WHERE telegram_user_id = $1', [userId]);
        if (balanceResult.rows.length === 0) {
             await client.query('ROLLBACK');
             return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const currentBalanceTaka = balanceResult.rows[0].earned_points;

        if (amountTakaToDeduct > currentBalanceTaka) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Insufficient balance.' });
        }

        await client.query(
            'UPDATE users SET earned_points = earned_points - $1 WHERE telegram_user_id = $2', 
            [amountTakaToDeduct, userId]
        );

        await client.query(
            'INSERT INTO withdraw_requests (telegram_user_id, amount_points, payment_method, phone_number) VALUES ($1, $2, $3, $4)',
            [userId, amountPoints, paymentMethod, phoneNumber]
        );

        await client.query('COMMIT'); // Transaction শেষ

        res.json({ success: true, message: 'Withdrawal request submitted successfully.' });

    } catch (err) {
        if (client) await client.query('ROLLBACK'); // ত্রুটি হলে রোলব্যাক
        console.error('Error in /api/withdraw (Transaction failed):', err);
        res.status(500).json({ success: false, message: 'Transaction failed due to server error.' });
    } finally {
        if (client) client.release(); // রিকোয়েস্ট শেষে ক্লায়েন্ট পুল-এ ফেরত দেওয়া
    }
});

// --- সার্ভার চালু করা ---
connectToDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
        console.log(`Application successfully established a stable connection pool.`);
    });
});
