// প্রয়োজনীয় মডিউল ইম্পোর্ট
const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

// এনভায়রনমেন্ট ভেরিয়েবল লোড
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ডেটাবেস কনফিগারেশন
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// মিডলওয়্যার
app.use(cors());
app.use(express.json());

// **********************************************
// ** স্ট্যাটিক ফাইল সার্ভিং **
// **********************************************

app.get('/Blogger_MiniApp_UI.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'Blogger_MiniApp_UI.html'));
});

// রুট '/' এ হিট করলে Mini App UI ফাইলটি দেওয়া হবে
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Blogger_MiniApp_UI.html'));
});

// অ্যাডমিন পেজ সার্ভ করা হচ্ছে
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});


// **********************************************
// ** ডেটাবেস ইনিশিয়ালাইজেশন **
// **********************************************

/**
 * ইউজার এবং অন্যান্য টেবিল তৈরি করে যদি না থাকে।
 * ad_logs টেবিলে কলামের নাম 'user_telegram_id' এ ফিক্স করা হয়েছে।
 */
async function initializeDatabase() {
    try {
        const client = await pool.connect();
        
        // 1. users টেবিল তৈরি করা
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY,
                username VARCHAR(255),
                total_points INTEGER DEFAULT 0,
                referral_code VARCHAR(50) UNIQUE,
                referred_by_id BIGINT REFERENCES users(telegram_id),
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        
        // 2. withdraw_requests টেবিল তৈরি করা
        await client.query(`
            CREATE TABLE IF NOT EXISTS withdraw_requests (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT REFERENCES users(telegram_id),
                points_requested INTEGER NOT NULL,
                payment_method VARCHAR(50) NOT NULL,
                payment_address VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        // 3. ad_logs টেবিল তৈরি করা (ফিক্সড: 'user_telegram_id' ব্যবহার করা হলো, যা আপনার লগ ত্রুটির সাথে মেলে)
        await client.query(`
            CREATE TABLE IF NOT EXISTS ad_logs (
                id SERIAL PRIMARY KEY,
                user_telegram_id BIGINT REFERENCES users(telegram_id), 
                points_earned INTEGER NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        // অ্যাডমিন ব্যবহারকারী তৈরি বা আপডেট করা
        const adminId = process.env.ADMIN_TELEGRAM_ID;
        const adminUsername = process.env.ADMIN_USERNAME || 'AdminUser';
        
        if (adminId) {
            let adminReferralCode = process.env.ADMIN_REFERRAL_CODE;
            if (!adminReferralCode) {
                adminReferralCode = 'ADMIN' + crypto.randomUUID().substring(0, 5).toUpperCase();
            }

            // যদি রেফারেল কোড conflict হয়, তবে শুধুমাত্র is_admin আপডেট করা হবে
            await client.query(`
                INSERT INTO users (telegram_id, username, is_admin, referral_code)
                VALUES ($1, $2, TRUE, $3)
                ON CONFLICT (telegram_id) 
                DO UPDATE SET is_admin = TRUE, username = $2, referral_code = users.referral_code;
            `, [adminId, adminUsername, adminReferralCode]);
            console.log(`Admin user (ID: ${adminId}) ensured.`);
        }
        
        client.release();
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Database initialization failed:", err);
    }
}

// সার্ভার চালু হওয়ার সময় ডেটাবেস ইনিশিয়ালাইজেশন
initializeDatabase();


// **********************************************
// ** API রুটস **
// **********************************************

/**
 * ইউজার রেজিস্ট্রেশন/লগইন এবং ডেটা লোড
 */
app.get('/api/user-data', async (req, res) => {
    const { id, referrer } = req.query;
    const telegramId = id;

    if (!telegramId) {
        return res.status(400).json({ success: false, message: "Telegram ID required." });
    }

    try {
        let client = await pool.connect();

        // ইউজার খুঁজুন
        let userResult = await client.query('SELECT total_points, referral_code, referred_by_id, is_admin FROM users WHERE telegram_id = $1', [telegramId]);
        let user = userResult.rows[0];
        let message;

        // যদি ইউজার না থাকে, তবে রেজিস্ট্রেশন করুন
        if (!user) {
            let newReferralCode;
            let codeExists = true;
            while(codeExists) {
                newReferralCode = crypto.randomUUID().substring(0, 8);
                const check = await client.query('SELECT 1 FROM users WHERE referral_code = $1', [newReferralCode]);
                codeExists = check.rows.length > 0;
            }

            let referredById = null;
            let initialPoints = 0;
            message = "Registration successful.";
            
            // রেফারেল বোনাস লজিক
            if (referrer && referrer !== telegramId) {
                const referrerResult = await client.query('SELECT telegram_id FROM users WHERE referral_code = $1', [referrer]);
                
                if (referrerResult.rows.length > 0) {
                    referredById = referrerResult.rows[0].telegram_id;
                    initialPoints = 250; // নতুন ইউজারকে বোনাস
                    
                    // রেফারারকে বোনাস দিন (ট্রানজ্যাকশনের বাইরে রাখা হয়েছে সিম্পলিসিটির জন্য)
                    await client.query(
                        'UPDATE users SET total_points = total_points + 250 WHERE telegram_id = $1', 
                        [referredById]
                    );
                    message += ` You and your referrer (ID: ${referredById}) received a 250 point bonus!`;
                }
            }
            
            // নতুন ইউজার তৈরি
            await client.query(`
                INSERT INTO users (telegram_id, username, total_points, referral_code, referred_by_id)
                VALUES ($1, $2, $3, $4, $5)
            `, [telegramId, telegramId, initialPoints, newReferralCode, referredById]); // ইউজারনেম হিসেবে telegramId ব্যবহার করা হলো

            user = { 
                total_points: initialPoints, 
                referral_code: newReferralCode, 
                referred_by_id: referredById,
                is_admin: false
            };
        }

        // রেফারেল গণনা
        const referralCountResult = await client.query('SELECT COUNT(*) FROM users WHERE referred_by_id = $1', [telegramId]);
        const referralCount = parseInt(referralCountResult.rows[0].count);

        client.release();
        
        res.json({
            success: true,
            points: user.total_points,
            referral_code: user.referral_code,
            referral_count: referralCount,
            is_admin: user.is_admin,
            message: message || "User data loaded."
        });

    } catch (err) {
        console.error("Error loading user data:", err);
        res.status(500).json({ success: false, message: "Server error during data load." });
    }
});

/**
 * পয়েন্ট যোগ করা (অ্যাড ভিউ সিমুলেশন)
 */
app.post('/api/add-points', async (req, res) => {
    const { telegramId, points } = req.body;

    if (!telegramId || typeof points !== 'number' || points <= 0) {
        return res.status(400).json({ success: false, message: "Invalid request data." });
    }

    try {
        const client = await pool.connect();
        
        // পয়েন্ট আপডেট
        const updateResult = await client.query(
            'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2 RETURNING total_points', 
            [points, telegramId]
        );

        if (updateResult.rows.length === 0) {
            client.release();
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const newPoints = updateResult.rows[0].total_points;

        // 🔥🔥🔥 ফিক্স: ad_logs টেবিলে 'telegram_id' এর পরিবর্তে 'user_telegram_id' ব্যবহার করা হলো 🔥🔥🔥
        // এই পরিবর্তনটি PostgreSQL এর ত্রুটি (column "telegram_id" does not exist) সমাধান করবে।
        await client.query(
            'INSERT INTO ad_logs (user_telegram_id, points_earned) VALUES ($1, $2)', 
            [telegramId, points]
        );
        
        client.release();

        res.json({
            success: true,
            new_points: newPoints,
            message: `Successfully earned ${points} points!`
        });

    } catch (err) {
        console.error("Error adding points:", err);
        res.status(500).json({ success: false, message: "Server error while adding points." });
    }
});

/**
 * উইথড্র রিকোয়েস্ট তৈরি
 */
app.post('/api/withdraw', async (req, res) => {
    const { telegramId, points, paymentMethod, paymentAddress } = req.body;

    if (!telegramId || points < 1000 || !paymentMethod || !paymentAddress) {
        return res.status(400).json({ success: false, message: "Invalid withdrawal details." });
    }

    try {
        const client = await pool.connect();

        // বর্তমান পয়েন্ট চেক করা
        const userResult = await client.query('SELECT total_points FROM users WHERE telegram_id = $1', [telegramId]);
        const userPoints = userResult.rows[0]?.total_points;

        if (!userPoints || userPoints < points) {
            client.release();
            return res.status(400).json({ success: false, message: "Insufficient points." });
        }

        // পয়েন্ট ব্যালেন্স থেকে কাটুন
        const updateResult = await client.query(
            'UPDATE users SET total_points = total_points - $1 WHERE telegram_id = $2 RETURNING total_points',
            [points, telegramId]
        );
        const newPoints = updateResult.rows[0].total_points;

        // উইথড্র রিকোয়েস্ট তৈরি করুন
        await client.query(
            'INSERT INTO withdraw_requests (telegram_id, points_requested, payment_method, payment_address, status) VALUES ($1, $2, $3, $4, $5)',
            [telegramId, points, paymentMethod, paymentAddress, 'Pending']
        );

        client.release();
        
        res.json({
            success: true,
            new_points: newPoints,
            message: `Withdrawal request for ${points} points submitted successfully!`
        });

    } catch (err) {
        console.error("Error during withdrawal:", err);
        res.status(500).json({ success: false, message: "Server error during withdrawal." });
    }
});

// **********************************************
// ** অ্যাডমিন রুটস **
// **********************************************

app.get('/api/admin/pending-withdrawals', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query(`
            SELECT 
                wr.id, 
                wr.points_requested, 
                wr.payment_method, 
                wr.payment_address, 
                wr.requested_at, 
                u.telegram_id, 
                u.username 
            FROM withdraw_requests wr
            JOIN users u ON wr.telegram_id = u.telegram_id
            WHERE wr.status = 'Pending'
            ORDER BY wr.requested_at ASC
        `);
        client.release();
        res.json({ success: true, withdrawals: result.rows });
    } catch (err) {
        console.error("Admin error (pending withdrawals):", err);
        res.status(500).json({ success: false, message: "Server error fetching pending withdrawals." });
    }
});

app.post('/api/admin/update-withdrawal-status', async (req, res) => {
    const { withdrawalId, status } = req.body;
    
    if (!withdrawalId || !['Completed', 'Rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status or ID." });
    }

    try {
        const client = await pool.connect();
        
        await client.query('BEGIN');

        const updateResult = await client.query(
            'UPDATE withdraw_requests SET status = $1 WHERE id = $2 RETURNING telegram_id, points_requested', 
            [status, withdrawalId]
        );

        if (updateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ success: false, message: "Withdrawal request not found." });
        }
        
        const { telegram_id, points_requested } = updateResult.rows[0];

        if (status === 'Rejected') {
            await client.query(
                'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
                [points_requested, telegram_id]
            );
        }

        await client.query('COMMIT');
        client.release();
        
        res.json({ success: true, message: `Withdrawal ID ${withdrawalId} marked as ${status}.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Admin error (update status):", err);
        res.status(500).json({ success: false, message: "Server error updating withdrawal status." });
    }
});


// সার্ভার চালু করা
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
