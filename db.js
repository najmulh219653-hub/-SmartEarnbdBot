// db.js (চূড়ান্ত এবং ত্রুটিমুক্ত)
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function setupDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. users টেবিল তৈরি (IF NOT EXISTS থাকায় দ্বিতীয়বার ত্রুটি হবে না)
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
        // 2. অন্যান্য টেবিল তৈরি
        await client.query(`
            CREATE TABLE IF NOT EXISTS ad_logs (
                id SERIAL PRIMARY KEY,
                user_telegram_id VARCHAR(20) REFERENCES users(telegram_id),
                points_awarded INT NOT NULL,
                logged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
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
        await client.query(`
            CREATE TABLE IF NOT EXISTS ads_config (
                config_key VARCHAR(50) PRIMARY KEY,
                config_value VARCHAR(255)
            );
        `);

        // 3. ডিফল্ট কনফিগারেশন যুক্ত করা
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
        
        // 4. এডমিন ইউজার নিশ্চিত করা (ADMIN_TELEGRAM_ID এর সুরক্ষা সহ)
        const adminTelegramId = process.env.ADMIN_TELEGRAM_ID; 

        if (adminTelegramId && /^\d+$/.test(adminTelegramId)) {
            await client.query(
                `INSERT INTO users (telegram_id, username, is_admin) 
                 VALUES ($1, 'AdminUser', TRUE)
                 ON CONFLICT (telegram_id) 
                 DO UPDATE SET is_admin = TRUE, username = EXCLUDED.username`,
                [adminTelegramId]
            );
        } else {
             // এই সতর্কতাটি লগে দেখা যাবে যদি ADMIN_TELEGRAM_ID ঠিক না থাকে
             console.warn("ADMIN_TELEGRAM_ID is missing or invalid. Admin user was not set.");
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database setup error:', error.stack);
        throw error;
    } finally {
        client.release();
    }
}

function query(text, params) {
    return pool.query(text, params);
}

module.exports = {
    pool,
    query,
    setupDatabase
};
