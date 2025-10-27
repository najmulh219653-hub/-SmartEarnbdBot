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
            CREATE TABLE IF NOT EXISTS users (
                user_id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                total_points INTEGER DEFAULT 0,
                referral_code VARCHAR(8) UNIQUE NOT NULL,
                referrer_id INTEGER REFERENCES users(user_id)
            );

            CREATE TABLE IF NOT EXISTS withdraw_requests (
                request_id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(user_id) NOT NULL,
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
    }
}

setupDatabase();

module.exports = {
    pool,
    setupDatabase
};
