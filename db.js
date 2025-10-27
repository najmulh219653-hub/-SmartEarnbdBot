// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ডাটাবেস টেবিল তৈরি (যদি না থাকে)
async function setupDatabase() {
    try {
        await pool.query(`
            -- 'users' টেবিল: telegram_id কে Primary Key হিসেবে ব্যবহার করা হচ্ছে
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY,  /* user_id এর পরিবর্তে */
                username VARCHAR(255),
                total_points INTEGER DEFAULT 0,
                referral_code VARCHAR(8) UNIQUE NOT NULL,
                -- referrer_id এখন রেফারকারী ইউজারের telegram_id-কে রেফার করবে
                referrer_id BIGINT REFERENCES users(telegram_id), 
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- 'withdraw_requests' টেবিল: user_telegram_id কে Foreign Key হিসেবে ব্যবহার করা হচ্ছে
            CREATE TABLE IF NOT EXISTS withdraw_requests (
                request_id SERIAL PRIMARY KEY,
                user_telegram_id BIGINT REFERENCES users(telegram_id) NOT NULL, /* user_id এর পরিবর্তে */
                points_requested INTEGER NOT NULL,
                payment_method VARCHAR(50) NOT NULL,
                payment_address VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ ডাটাবেস টেবিল সফলভাবে তৈরি বা বিদ্যমান আছে।");
    } catch (error) {
        console.error("❌ ডাটাবেস সেটআপ ত্রুটি:", error);
        // যদি এটি Render এ এরর দেয়, তবে এটি গুরুত্বপূর্ণ
        // Render এরর দেখালে আপনাকে ডেটাবেস ম্যানুয়ালি ড্রপ করতে হবে
    }
}

setupDatabase();

module.exports = {
    pool,
    setupDatabase
};
