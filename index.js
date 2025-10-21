// index.js (Node.js Server Code)

const express = require('express');
const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL ক্লায়েন্ট সেটআপ
const client = new Client({
    connectionString: process.env.DATABASE_URL, 
    ssl: {
        rejectUnauthorized: false
    }
});

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
    try {
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
    }
});

// ২. পয়েন্ট আপডেট করা (বিজ্ঞাপন দেখার পর)
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body; 
    
    if (!userId || typeof points !== 'number' || points <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid input data.' });
    }
    
    const takaValue = points / 50; 

    try {
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
    }
});

// ৩. উত্তোলন অনুরোধ API (Withdrawal Request)
app.post('/api/withdraw', async (req, res) => {
    const { userId, amountPoints, paymentMethod, phoneNumber } = req.body;
    const minWithdrawPoints = 1000;
    const amountTakaToDeduct = amountPoints / 50;

    if (!userId || !paymentMethod || !phoneNumber || typeof amountPoints !== 'number' || amountPoints < minWithdrawPoints) {
        return res.status(400).json({ success: false, message: `Invalid request or minimum withdrawal is ${minWithdrawPoints} points (৳20).` });
    }

    try {
        await client.query('BEGIN');

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

        await client.query('COMMIT');

        res.json({ success: true, message: 'Withdrawal request submitted successfully.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error in /api/withdraw (Transaction failed):', err);
        res.status(500).json({ success: false, message: 'Transaction failed due to server error.' });
    }
});

// --- সার্ভার চালু করার ফাংশন ---
// এটি নিশ্চিত করে যে ডেটাবেস সংযোগ সফল হওয়ার পরেই সার্ভার চালু হবে।
client.connect()
    .then(() => {
        console.log('Successfully connected to Neon PostgreSQL');
        
        // ডেটাবেস সংযোগ সফল হলে সার্ভার চালু করা
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    })
    .catch(err => {
        // ডেটাবেস সংযোগ ব্যর্থ হলে প্রক্রিয়াটি বন্ধ করা (আপনার সমস্যার সমাধান!)
        console.error('FATAL: Database connection error. Check DATABASE_URL.', err.stack);
        process.exit(1); 
    });

// কোডটি এখন সম্পূর্ণ এবং আপনার ডেপ্লয়মেন্ট ত্রুটি (status 1) হ্যান্ডেল করার জন্য আরও সুরক্ষিত।
