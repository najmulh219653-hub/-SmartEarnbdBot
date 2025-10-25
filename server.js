const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// --- PostgreSQL Pool Setup (Render Environment Variable 'DATABASE_URL' ব্যবহার করে) ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// --- CORS Configuration (ডেটা লোডিং/পয়েন্ট যোগ করার জন্য অপরিহার্য) ---
const allowedOrigins = [
    'https://earnquickofficial.blogspot.com', // আপনার ব্লগার ডোমেইন
    'https://t.me', // টেলিগ্রাম
    // যদি টেস্টিং-এর জন্য দরকার হয়, তবে অন্য ডোমেইন যুক্ত করুন
];

app.use(cors({
    origin: function (origin, callback) {
        // No origin (যেমন Postman, বা সার্ভার টু সার্ভার) হলে Allow করুন
        if (!origin) return callback(null, true); 
        
        if (allowedOrigins.indexOf(origin) === -1) {
            // যদি আপনার অনুমোদিত ডোমেইনের বাইরে হয়, তবে ব্লক করুন
            const msg = 'CORS policy does not allow access from this Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true); // Allow করুন
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', 
    credentials: true 
}));
// -------------------------------------------------------------------

app.use(express.json()); // JSON বডি পার্স করার জন্য

// --- ডেটাবেস ইনিশিয়ালাইজেশন (টেবিল তৈরি) ---
const initDb = async () => {
    try {
        const client = await pool.connect();
        
        // users টেবিল তৈরি: সকল প্রয়োজনীয় কলাম সহ (referral_bonus_given সহ)
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                telegram_user_id VARCHAR(50) PRIMARY KEY,
                earned_points DECIMAL(19, 2) DEFAULT 0.00,
                referral_count INTEGER DEFAULT 0,
                referrer_id VARCHAR(50),
                referral_bonus_given BOOLEAN DEFAULT FALSE, -- ❌ DB ত্রুটি ফিক্সড
                telegram_username VARCHAR(100),
                first_name VARCHAR(100),
                is_admin BOOLEAN DEFAULT FALSE,
                joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        // withdrawal_requests টেবিল তৈরি
        const createWithdrawalsTable = `
            CREATE TABLE IF NOT EXISTS withdrawal_requests (
                request_id SERIAL PRIMARY KEY,
                telegram_user_id VARCHAR(50) NOT NULL REFERENCES users(telegram_user_id),
                points_requested DECIMAL(19, 2) NOT NULL,
                payment_method VARCHAR(50) NOT NULL,
                payment_number VARCHAR(50) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending', 
                requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP WITH TIME ZONE
            );
        `;

        await client.query(createUsersTable);
        await client.query(createWithdrawalsTable);

        client.release();
        console.log("PostgreSQL DB initialized successfully with users and withdrawals tables.");
    } catch (err) {
        console.error("DB Initialization Error:", err);
        // Error handling for persistent errors, though Render usually restarts
    }
};

// --- API Endpoints ---

// 1. ইউজার রেজিস্ট্রেশন বা চেক করা
app.post('/api/register_or_check', async (req, res) => {
    // Note: client-side (Blogger) should send userId, refererId, username, firstName
    const { userId, refererId, username, firstName } = req.body; 

    if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required." });
    }

    try {
        let message = "Welcome back!";
        let client = await pool.connect();

        // ইউজারকে চেক করা
        let userResult = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [userId]);
        let user = userResult.rows[0];

        if (!user) {
            // নতুন ইউজার: ডেটা ইনসার্ট করা
            
            await client.query(
                `INSERT INTO users (telegram_user_id, earned_points, referral_count, referrer_id, telegram_username, first_name) 
                 VALUES ($1, $2, $3, $4, $5, $6)`, 
                [userId, 0, 0, refererId, username || null, firstName || null]
            );
            message = "New user registered!";

            // রেফারেল বোনাস দেওয়া (যদি refererId থাকে)
            if (refererId) {
                let referrerResult = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [refererId]);
                const referrer = referrerResult.rows[0];
                
                if (referrer && referrer.telegram_user_id !== userId) {
                    // রেফারেল বোনাস লজিক
                    await client.query(
                        `UPDATE users 
                         SET earned_points = earned_points + 250, referral_count = referral_count + 1 
                         WHERE telegram_user_id = $1`, 
                        [refererId]
                    );
                    message += " Referral bonus granted to referrer.";
                }
            }
        }
        
        // ইউজার ডেটা আবার লোড করা (নতুন ব্যালেন্স দেখানোর জন্য)
        userResult = await client.query('SELECT earned_points, referral_count, is_admin FROM users WHERE telegram_user_id = $1', [userId]);
        user = userResult.rows[0];

        client.release();
        
        if (!user) {
            // এই ক্ষেত্রে ব্যবহারকারীকে খুঁজে পাওয়া যায়নি (অসাধারণ ত্রুটি)
             return res.status(404).json({ success: false, message: "User not found after operation." });
        }

        res.json({ 
            success: true, 
            message: message,
            earned_points: user.earned_points,
            referral_count: user.referral_count,
            is_admin: user.is_admin
        });

    } catch (error) {
        console.error("Register/Check error:", error.message);
        res.status(500).json({ success: false, message: "Server error during registration/check. Check DB logs." });
    }
});

// 2. পয়েন্ট যোগ করা
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body;

    if (!userId || typeof points !== 'number') {
        return res.status(400).json({ success: false, message: "Invalid input." });
    }

    try {
        const client = await pool.connect();
        
        const result = await client.query(
            `UPDATE users 
             SET earned_points = earned_points + $1, last_login = CURRENT_TIMESTAMP 
             WHERE telegram_user_id = $2 
             RETURNING earned_points`,
            [points, userId]
        );

        client.release();
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        res.json({ 
            success: true, 
            message: `${points} points added.`,
            new_points: result.rows[0].earned_points
        });

    } catch (error) {
        console.error("Add points error:", error.message);
        res.status(500).json({ success: false, message: "Server error adding points. Check DB logs." });
    }
});


// 3. উইথড্রয়াল রিকোয়েস্ট
app.post('/api/withdraw', async (req, res) => {
    const { userId, pointsToWithdraw, paymentMethod, paymentNumber } = req.body;

    if (!userId || !pointsToWithdraw || !paymentMethod || !paymentNumber) {
        return res.status(400).json({ success: false, message: "All fields are required for withdrawal." });
    }
    
    const points = parseFloat(pointsToWithdraw);

    try {
        const client = await pool.connect();
        await client.query('BEGIN'); // Transaction শুরু

        // ব্যালেন্স চেক করা
        const userCheck = await client.query('SELECT earned_points FROM users WHERE telegram_user_id = $1 FOR UPDATE', [userId]);
        if (userCheck.rows.length === 0 || userCheck.rows[0].earned_points < points) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(400).json({ success: false, message: "Insufficient balance or user not found." });
        }

        // ব্যালেন্স আপডেট
        const updateResult = await client.query(
            'UPDATE users SET earned_points = earned_points - $1 WHERE telegram_user_id = $2 RETURNING earned_points',
            [points, userId]
        );

        // উইথড্রয়াল রিকোয়েস্ট তৈরি
        await client.query(
            `INSERT INTO withdrawal_requests (telegram_user_id, points_requested, payment_method, payment_number) 
             VALUES ($1, $2, $3, $4)`,
            [userId, points, paymentMethod, paymentNumber]
        );

        await client.query('COMMIT'); // Transaction শেষ

        client.release();
        
        res.json({ 
            success: true, 
            message: "Withdrawal request submitted.",
            new_points: updateResult.rows[0].earned_points 
        });

    } catch (error) {
        await pool.query('ROLLBACK'); // কোনো ত্রুটি হলে রোলব্যাক
        console.error("Withdraw error:", error.message);
        res.status(500).json({ success: false, message: "Server error during withdrawal." });
    }
});


// সার্ভার চালু করা
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDb(); // সার্ভার চালু হওয়ার সময় ডেটাবেস ইনিশিয়ালাইজ করা
});
