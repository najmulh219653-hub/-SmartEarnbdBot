// Node.js অ্যাপ্লিকেশন এবং PostgreSQL ডাটাবেসের মধ্যে সংযোগ স্থাপন এবং স্কিমা তৈরির জন্য
const { Pool } = require('pg');

// .env ফাইল থেকে পরিবেশ ভেরিয়েবল লোড করার জন্য, যদি দরকার হয়।
// Render বা অন্য হোস্টিং প্ল্যাটফর্মে DATABASE_URL স্বয়ংক্রিয়ভাবে সেট করা থাকে।
// require('dotenv').config(); 

// ডাটাবেস সংযোগের জন্য Pool তৈরি করা হলো
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // SSL কনফিগারেশন রেন্ডারের জন্য দরকার হতে পারে
    ssl: {
        rejectUnauthorized: false
    }
});

// ডাটাবেস সংযোগ পরীক্ষা
pool.on('connect', () => {
    console.log('Database connected successfully!');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// ডাটাবেসের টেবিলগুলো তৈরি করার ফাংশন (স্কিমা ফিক্স সহ)
async function setupDatabase() {
    try {
        const client = await pool.connect();
        
        // 1. users টেবিল তৈরি করা
        // referrer_id কলামটি যোগ করা হয়েছে, যা ডেটা লোডিং/রেফারাল লজিকে সমস্যা তৈরি করছিল।
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY UNIQUE,
                username VARCHAR(50) DEFAULT '',
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
        console.log('Users table ensured (referrer_id column added/confirmed).');
        
        // 2. ad_logs টেবিল তৈরি করা
        // user_telegram_id কলামটি যোগ করা হয়েছে, যা পয়েন্ট যোগ করার সময় সমস্যা তৈরি করছিল।
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
        console.log('Ad_logs table ensured (user_telegram_id column added/confirmed).');

        client.release();
    } catch (err) {
        console.error('Error setting up database tables:', err);
    }
}

// ডাটাবেস পুল এবং সেটআপ ফাংশন এক্সপোর্ট করা হলো
module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
    setupDatabase
};
