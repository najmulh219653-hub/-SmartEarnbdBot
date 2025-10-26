// db.js
const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL ডেটাবেজ সংযোগের জন্য Pool তৈরি করা
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: {
        rejectUnauthorized: false // Render/Neon-এর জন্য SSL প্রয়োজন
    }
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// ডেটাবেজ সংযোগ পরীক্ষা করা
async function connectDB() {
    try {
        const client = await pool.connect();
        console.log('✅ PostgreSQL ডেটাবেজের সাথে সফলভাবে সংযোগ স্থাপন করা হয়েছে।');
        client.release();
    } catch (err) {
        console.error('❌ PostgreSQL ডেটাবেজে সংযোগ ব্যর্থ:', err.message);
        // যদি db.js connectDB() ফাংশন server.js এ কল না করা হয়, 
        // তবে এটি শুধু সংযোগের জন্য ব্যবহার করা হয়।
    }
}

// যদি আপনি server.js এ connectDB() কল না করেন, তাহলেও ঠিক আছে।
// কারণ pool এক্সপোর্ট করা হচ্ছে।

module.exports = {
    pool,
    connectDB
};
