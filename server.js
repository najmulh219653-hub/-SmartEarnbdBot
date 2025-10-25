const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// 🛑 গুরুত্বপূর্ণ: আপনার অ্যাডমিন টেলিগ্রাম আইডি
const ADMIN_TELEGRAM_ID = '8145444675'; 

// --- PostgreSQL Pool Setup ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// --- CORS Configuration ---
const allowedOrigins = [
    'https://earnquickofficial.blogspot.com', // আপনার ব্লগার ডোমেইন
    'https://t.me', 
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true); 
        
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'CORS policy does not allow access from this Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true); 
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', 
    credentials: true 
}));
// -------------------------------------------------------------------

app.use(express.json()); 

// --- ডেটাবেস ইনিশিয়ালাইজেশন (টেবিল তৈরি) ---
const initDb = async () => {
    try {
        const client = await pool.connect();
        
        // users টেবিল তৈরি: সকল প্রয়োজনীয় কলাম সহ
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                telegram_user_id VARCHAR(50) PRIMARY KEY,
                earned_points DECIMAL(19, 2) DEFAULT 0.00,
                referral_count INTEGER DEFAULT 0,
                referrer_id VARCHAR(50),
                referral_bonus_given BOOLEAN DEFAULT FALSE, 
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
        
        // অ্যাডমিন আইডিকে is_admin = TRUE হিসেবে সেট করা
        await client.query(
            `INSERT INTO users (telegram_user_id, is_admin) 
             VALUES ($1, TRUE) 
             ON CONFLICT (telegram_user_id) 
             DO UPDATE SET is_admin = TRUE, last_login = CURRENT_TIMESTAMP`,
            [ADMIN_TELEGRAM_ID]
        );

        client.release();
        console.log("PostgreSQL DB initialized successfully with users and withdrawals tables.");
    } catch (err) {
        console.error("DB Initialization Error:", err);
    }
};

// --- API Endpoints ---

// নতুন: অ্যাডমিন ডেটা এন্ডপয়েন্ট (রিয়েল-টাইম ইনফরমেশনের জন্য)
app.get('/api/admin/data/:userId', async (req, res) => {
    const { userId } = req.params;

    // 🛑 শুধুমাত্র অ্যাডমিনই এই ডেটা অ্যাক্সেস করতে পারবে
    if (userId !== ADMIN_TELEGRAM_ID) {
        // একটি অতিরিক্ত চেক: যদি DB-তে is_admin = TRUE থাকে, তবেই অনুমতি
        try {
            const adminCheck = await pool.query('SELECT is_admin FROM users WHERE telegram_user_id = $1', [userId]);
            if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
                 return res.status(403).json({ success: false, message: "Access denied. Not an admin." });
            }
        } catch (e) {
            console.error("Admin check error:", e.message);
            return res.status(403).json({ success: false, message: "Access denied." });
        }
    }


    try {
        const client = await pool.connect();

        // ১. সকল ইউজার ডেটা
        const usersResult = await client.query(
            `SELECT 
                telegram_user_id, 
                earned_points, 
                referral_count, 
                telegram_username,
                first_name,
                joined_at
             FROM users 
             ORDER BY earned_points DESC, joined_at ASC
             LIMIT 100` // টেস্টিং-এর জন্য প্রথম ১০০ জন
        );

        // ২. পেন্ডিং উইথড্রয়াল রিকোয়েস্ট
        const withdrawalsResult = await client.query(
            `SELECT 
                request_id, 
                telegram_user_id, 
                points_requested, 
                payment_method, 
                payment_number, 
                requested_at
             FROM withdrawal_requests 
             WHERE status = 'pending' 
             ORDER BY requested_at ASC`
        );

        client.release();

        res.json({
            success: true,
            users: usersResult.rows,
            pendingWithdrawals: withdrawalsResult.rows
        });

    } catch (error) {
        console.error("Admin data fetch error:", error.message);
        res.status(500).json({ success: false, message: "Server error fetching admin data." });
    }
});


// অন্যান্য API এন্ডপয়েন্ট (register_or_check, add_points, withdraw) অপরিবর্তিত আছে।

// 1. ইউজার রেজিস্ট্রেশন বা চেক করা
app.post('/api/register_or_check', async (req, res) => {
    const { userId, refererId, username, firstName } = req.body; 

    if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required." });
    }

    try {
        let message = "Welcome back!";
        let client = await pool.connect();

        let userResult = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [userId]);
        let user = userResult.rows[0];
        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            await client.query(
                `INSERT INTO users (telegram_user_id, earned_points, referral_count, referrer_id, telegram_username, first_name) 
                 VALUES ($1, $2, $3, $4, $5, $6)`, 
                [userId, 0, 0, refererId, username || null, firstName || null]
            );
            message = "New user registered!";

            if (refererId) {
                let referrerResult = await client.query('SELECT * FROM users WHERE telegram_user_id = $1', [refererId]);
                const referrer = referrerResult.rows[0];
                
                if (referrer && referrer.telegram_user_id !== userId) {
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
        
        userResult = await client.query('SELECT earned_points, referral_count, is_admin FROM users WHERE telegram_user_id = $1', [userId]);
        user = userResult.rows[0];

        client.release();
        
        if (!user) {
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

        const userCheck = await client.query('SELECT earned_points FROM users WHERE telegram_user_id = $1 FOR UPDATE', [userId]);
        if (userCheck.rows.length === 0 || userCheck.rows[0].earned_points < points) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(400).json({ success: false, message: "Insufficient balance or user not found." });
        }

        const updateResult = await client.query(
            'UPDATE users SET earned_points = earned_points - $1 WHERE telegram_user_id = $2 RETURNING earned_points',
            [points, userId]
        );

        await client.query(
            `INSERT INTO withdrawal_requests (telegram_user_id, points_requested, payment_method, payment_number) 
             VALUES ($1, $2, $3, $4)`,
            [userId, points, paymentMethod, paymentNumber]
        );

        await client.query('COMMIT'); 

        client.release();
        
        res.json({ 
            success: true, 
            message: "Withdrawal request submitted.",
            new_points: updateResult.rows[0].earned_points 
        });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error("Withdraw error:", error.message);
        res.status(500).json({ success: false, message: "Server error during withdrawal." });
    }
});


// সার্ভার চালু করা
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDb(); 
});
