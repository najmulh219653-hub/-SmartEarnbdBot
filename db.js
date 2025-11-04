// db.js
const { Pool } = require('pg');

// Render Environment Variable থেকে DATABASE_URL ব্যবহার করা হয়েছে
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Render PostgreSQL-এর জন্য প্রয়োজন হতে পারে
    }
});

/**
 * ডাটাবেস টেবিল এবং ডিফল্ট কনফিগারেশন নিশ্চিত করে।
 */
async function setupDatabase() {
    const client = await pool.connect();
    try {
        // ট্রানজেকশন শুরু
        await client.query('BEGIN');

        // 1. users টেবিল
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_id VARCHAR(20) PRIMARY KEY,
                username VARCHAR(100),
                total_points INT DEFAULT 0,
                referrer_id VARCHAR(20) REFERENCES users(telegram_id),
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('User table ensured.');

        // 2. ad_logs টেবিল
        await client.query(`
            CREATE TABLE IF NOT EXISTS ad_logs (
                id SERIAL PRIMARY KEY,
                user_telegram_id VARCHAR(20) REFERENCES users(telegram_id),
                points_awarded INT NOT NULL,
                logged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Ad logs table ensured.');

        // 3. withdraw_requests টেবিল
        await client.query(`
            CREATE TABLE IF NOT EXISTS withdraw_requests (
                id SERIAL PRIMARY KEY,
                user_telegram_id VARCHAR(20) REFERENCES users(telegram_id),
                points_requested INT NOT NULL,
                payment_details JSONB,
                status VARCHAR(20) DEFAULT 'Pending',
                requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP WITH TIME ZONE
            );
        `);
        console.log('Withdraw requests table ensured.');

        // 4. ads_config টেবিল
        await client.query(`
            CREATE TABLE IF NOT EXISTS ads_config (
                config_key VARCHAR(50) PRIMARY KEY,
                config_value VARCHAR(255)
            );
        `);
        console.log('Ads config table ensured.');
        
        // 5. ডিফল্ট কনফিগারেশন ডেটা নিশ্চিত করা
        const defaultConfigs = [
            { key: 'min_withdraw_points', value: '5000' },
            { key: 'points_per_ad', value: '50' },
            { key: 'referral_bonus_new_user', value: '50' },
            { key: 'referral_bonus_referrer', value: '100' }
        ];

        for (const config of defaultConfigs) {
            await client.query(
                `INSERT INTO ads_config (config_key, config_value) VALUES ($1, $2)
                 ON CONFLICT (config_key) DO NOTHING`,
                [config.key, config.value]
            );
        }
        console.log('Default config data checked/inserted.');

        // 6. এডমিন ইউজার নিশ্চিত করা (গুরুত্বপূর্ণ: আপনার Telegram ID এখানে বসান)
        const adminTelegramId = process.env.ADMIN_TELEGRAM_ID || '8145444675'; // 🛑 আপনার আইডি এখানে ব্যবহার করুন
        await client.query(
            `INSERT INTO users (telegram_id, username, is_admin) 
             VALUES ($1, 'AdminUser', TRUE)
             ON CONFLICT (telegram_id) 
             DO UPDATE SET is_admin = TRUE, username = EXCLUDED.username`,
            [adminTelegramId]
        );
        console.log(`Admin user ${adminTelegramId} ensured.`);


        // ট্রানজেকশন কমিট
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database setup error:', error.stack);
        throw error;
    } finally {
        client.release();
    }
}

// সাধারণ কোয়েরি ফাংশন
function query(text, params) {
    return pool.query(text, params);
}

module.exports = {
    pool,
    query,
    setupDatabase
};
