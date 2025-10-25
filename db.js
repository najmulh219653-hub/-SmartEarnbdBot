// db.js - PostgreSQL ডেটাবেস সংযোগ এবং ইনিশিয়ালাইজেশন হ্যান্ডেল করে।
const { Pool } = require('pg');

// নিশ্চিত করা হচ্ছে যে DATABASE_URL পরিবেশ ভেরিয়েবল সেট করা আছে
if (!process.env.DATABASE_URL) {
    throw new Error("Fatal Error: DATABASE_URL পরিবেশ ভেরিয়েবল সেট করা নেই।");
}

// Render/Neon কানেকশন স্ট্রিং ব্যবহার করে Pool তৈরি করা
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // SSL কনফিগারেশন: Render এবং Neon এর মধ্যে নিরাপদ সংযোগ নিশ্চিত করা
    ssl: {
        rejectUnauthorized: false
    }
});

// ডেটাবেস সংযোগ চেক করা এবং প্রয়োজনীয় টেবিল তৈরি করা
async function initializeDatabase() {
    try {
        const client = await pool.connect();
        
        // ১. ইউজার টেবিল তৈরি করা (ব্যালেন্স সংরক্ষণের জন্য)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                user_id VARCHAR(255) PRIMARY KEY,
                balance INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ২. ট্রানজেকশন টেবিল তৈরি করা (ডাবল রিওয়ার্ড আটকাতে)
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                transaction_id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(255) REFERENCES users(user_id),
                points_granted INTEGER,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log("PostgreSQL ডেটাবেসের সাথে সংযোগ সফল।");
        client.release();
    } catch (error) {
        console.error("ডেটাবেস ইনিশিয়ালাইজেশন ব্যর্থ:", error.message);
        // ত্রুটি হলে সার্ভার বন্ধ করে দেওয়া
        process.exit(1); 
    }
}

// কুয়েরি চালানোর জন্য ইউটিলিটি ফাংশন
function query(text, params) {
    return pool.query(text, params);
}

module.exports = {
    query,
    initializeDatabase
};
