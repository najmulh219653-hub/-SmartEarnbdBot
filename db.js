// db.js

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('connect', () => {
    console.log('Database connected successfully!');
});

pool.on('error', (err) => {
    console.error('FATAL: Unexpected error on idle client. Check DATABASE_URL.', err.stack);
    process.exit(1);
});

async function setupDatabase() {
    let client;
    try {
        client = await pool.connect();
        
        // 1. users টেবিল তৈরি করা
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY UNIQUE,
                username VARCHAR(50) DEFAULT 'GuestUser',
                total_points INTEGER DEFAULT 0,
                referrer_id BIGINT NULL, 
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                CONSTRAINT fk_referrer
                    FOREIGN KEY (referrer_id)
                    REFERENCES users(telegram_id)
                    ON DELETE SET NULL
            );
        `;
        await client.query(createUsersTable);
        
        // 2. ad_logs টেবিল তৈরি করা
        const createAdLogsTable = `
            CREATE TABLE IF NOT EXISTS ad_logs (
                id SERIAL PRIMARY KEY,
                user_telegram_id BIGINT NOT NULL, 
                points_awarded INTEGER NOT NULL,
                logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                CONSTRAINT fk_ad_log_user
                    FOREIGN KEY (user_telegram_id)
                    REFERENCES users(telegram_id)
                    ON DELETE CASCADE
            );
        `;
        await client.query(createAdLogsTable);
        
        // 3. withdraw_requests টেবিল তৈরি করা
        const createWithdrawRequestsTable = `
            CREATE TABLE IF NOT EXISTS withdraw_requests (
                id SERIAL PRIMARY KEY,
                user_telegram_id BIGINT NOT NULL, 
                points_requested INTEGER NOT NULL,
                payment_details JSONB,
                status VARCHAR(20) DEFAULT 'Pending',
                requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                processed_at TIMESTAMP WITH TIME ZONE NULL,
                CONSTRAINT fk_withdraw_user
                    FOREIGN KEY (user_telegram_id)
                    REFERENCES users(telegram_id)
                    ON DELETE CASCADE
            );
        `;
        await client.query(createWithdrawRequestsTable);
        
        // 4. ads_config টেবিল তৈরি করা
        const createAdsConfigTable = `
            CREATE TABLE IF NOT EXISTS ads_config (
                id SERIAL PRIMARY KEY,
                config_key VARCHAR(50) UNIQUE NOT NULL,
                config_value TEXT,
                description VARCHAR(255)
            );
        `;
        await client.query(createAdsConfigTable);

        // 5. ডিফল্ট কনফিগারেশন যোগ/আপডেট করা
        const defaultConfigs = [
            { key: 'running_notice', value: 'আমাদের মিনি অ্যাপে স্বাগতম! পয়েন্ট অর্জন করতে প্রতিদিন অ্যাড দেখুন।', description: 'Scrolling marquee notice text.' },
            { key: 'banner_ad_url', value: 'https://placehold.co/480x80/22c55e/ffffff?text=Banner+Ad+Space', description: 'URL for the main banner image.' },
            { key: 'banner_link', value: '#', description: 'Link URL for the banner ad.' },
        ];

        for (const config of defaultConfigs) {
            await client.query(
                `INSERT INTO ads_config (config_key, config_value, description) 
                 VALUES ($1, $2, $3)
                 ON CONFLICT (config_key) 
                 DO UPDATE SET config_value = EXCLUDED.config_value, description = EXCLUDED.description`,
                [config.key, config.value, config.description]
            );
        }
        console.log('Database tables and config ensured.');


    } catch (err) {
        console.error('CRITICAL: Error setting up database tables. Check permissions/connection.', err.stack);
        process.exit(1);
    } finally {
        if (client) client.release();
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
    setupDatabase
};
