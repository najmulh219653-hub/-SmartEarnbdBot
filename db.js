const { Pool } = require('pg');

// 🟢 চূড়ান্ত ফিক্স: DATABASE_URL ভ্যারিয়েবল ব্যবহার করা নিশ্চিত করা হয়েছে
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon DB-এর জন্য অতিরিক্ত SSL কনফিগারেশন প্রয়োজন হলে এখানে যোগ করুন (যদিও URL-এ দেওয়া আছে)
    ssl: {
        rejectUnauthorized: false
    }
});

// Test connection
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// 🛠️ ডাটাবেস টেবিল তৈরি এবং এডমিন ইউজার সেটআপ
async function setupDatabase() {
    const client = await pool.connect();
    try {
        console.log('Attempting database setup...');

        // 1. Users Table (Must be created first)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY,
                username VARCHAR(255) UNIQUE,
                total_points INTEGER DEFAULT 0,
                daily_ad_count INTEGER DEFAULT 0,
                referral_code VARCHAR(10) UNIQUE,
                referrer_id BIGINT REFERENCES users(telegram_id) DEFAULT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('Table "users" ensured.');
        
        // 2. Ad Logs Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS ad_logs (
                log_id SERIAL PRIMARY KEY,
                telegram_id BIGINT REFERENCES users(telegram_id),
                points_added INTEGER,
                log_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('Table "ad_logs" ensured.');
        
        // 3. Withdraw Requests Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS withdraw_requests (
                request_id SERIAL PRIMARY KEY,
                telegram_id BIGINT REFERENCES users(telegram_id),
                points_requested INTEGER NOT NULL,
                account_details VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                request_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('Table "withdraw_requests" ensured.');
        
        // 4. Admin User Setup (if ADMIN_TELEGRAM_ID is set)
        const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;
        
        // 🟢 চূড়ান্ত ফিক্স: ADMIN_ID ভ্যালিডেশন
        if (adminTelegramId && /^\d+$/.test(adminTelegramId)) {
            const adminUsername = 'AdminUser' + adminTelegramId.slice(-4); 
            
            // Upsert the Admin user and set is_admin to TRUE
            await client.query(`
                INSERT INTO users (telegram_id, username, is_admin) 
                VALUES ($1, $2, TRUE)
                ON CONFLICT (telegram_id) 
                DO UPDATE SET is_admin = TRUE, username = $2;
            `, [adminTelegramId, adminUsername]);
            console.log(`Admin user ${adminTelegramId} status ensured.`);
        } else {
            console.warn('WARNING: ADMIN_TELEGRAM_ID is not set or invalid. Admin features disabled.');
        }

        console.log('Database setup complete and successful.');

    } catch (e) {
        console.error('Database setup error:', e);
        throw e; // Rerthrow the error to prevent server from starting without DB
    } finally {
        client.release();
    }
}

// 🛠️ ইউজার তৈরি বা খোঁজা
function generateReferralCode(length = 6) {
    return Math.random().toString(36).substring(2, length + 2).toUpperCase();
}

async function findOrCreateUser(telegramId, username, startParam) {
    const client = await pool.connect();
    try {
        // 1. Check if user exists
        let result = await client.query('SELECT telegram_id, username, total_points, is_admin FROM users WHERE telegram_id = $1', [telegramId]);
        let user = result.rows[0];
        
        if (user) {
            // Update username if necessary
            await client.query('UPDATE users SET username = $1 WHERE telegram_id = $2', [username, telegramId]);
            return user;
        }

        // 2. If user doesn't exist, create new user
        let referralCode = generateReferralCode();
        
        // Find referrer ID from startParam
        let referrerId = null;
        if (startParam) {
            const referrerResult = await client.query('SELECT telegram_id FROM users WHERE referral_code = $1', [startParam]);
            if (referrerResult.rows.length > 0) {
                referrerId = referrerResult.rows[0].telegram_id;
            }
        }

        // 3. Insert new user
        await client.query(`
            INSERT INTO users (telegram_id, username, referral_code, referrer_id, total_points) 
            VALUES ($1, $2, $3, $4, 0)
            RETURNING telegram_id, username, total_points, is_admin
        `, [telegramId, username, referralCode, referrerId]);

        // 4. If referred, give referral bonus (e.g., 250 points)
        if (referrerId) {
            const REFERRAL_BONUS = 250;
            await client.query(
                'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
                [REFERRAL_BONUS, referrerId]
            );
        }
        
        // Fetch the newly created user
        result = await client.query('SELECT telegram_id, username, total_points, is_admin FROM users WHERE telegram_id = $1', [telegramId]);
        return result.rows[0];

    } finally {
        client.release();
    }
}

// 🛠️ পয়েন্ট যোগ করা
async function addPoints(telegramId, points) {
    const client = await pool.connect();
    try {
        await client.query(
            'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
            [points, telegramId]
        );
    } finally {
        client.release();
    }
}

// 🛠️ রেফারেল সংখ্যা গণনা
async function getReferralCount(telegramId) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT COUNT(*) FROM users WHERE referrer_id = $1',
            [telegramId]
        );
        return parseInt(result.rows[0].count);
    } finally {
        client.release();
    }
}

// 🛠️ অ্যাড দেখা লগ করা
async function logAdView(telegramId, points) {
     const client = await pool.connect();
     try {
         await client.query(
             'INSERT INTO ad_logs (telegram_id, points_added) VALUES ($1, $2)',
             [telegramId, points]
         );
     } finally {
         client.release();
     }
}

// 🛠️ উইথড্র রিকোয়েস্ট
async function requestWithdraw(telegramId, points, account) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start transaction

        // 1. Check current points
        const userResult = await client.query('SELECT total_points FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);
        const currentPoints = userResult.rows[0].total_points;
        const MIN_WITHDRAW_POINTS = 5000;

        if (currentPoints < points || points < MIN_WITHDRAW_POINTS) {
            await client.query('ROLLBACK');
            return { success: false, message: 'Insufficient points or minimum withdrawal not met.' };
        }

        // 2. Deduct points
        await client.query(
            'UPDATE users SET total_points = total_points - $1 WHERE telegram_id = $2',
            [points, telegramId]
        );

        // 3. Log withdrawal request
        await client.query(
            'INSERT INTO withdraw_requests (telegram_id, points_requested, account_details) VALUES ($1, $2, $3)',
            [telegramId, points, account]
        );

        await client.query('COMMIT'); // End transaction
        return { success: true, message: 'Withdrawal request submitted successfully.' };
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Withdrawal transaction failed:', e);
        return { success: false, message: 'An unexpected error occurred during withdrawal.' };
    } finally {
        client.release();
    }
}

module.exports = {
    setupDatabase,
    findOrCreateUser,
    addPoints,
    getReferralCount,
    logAdView,
    requestWithdraw
};
