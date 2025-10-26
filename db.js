// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // SSL প্রয়োজনীয়, Render-এ এটি আবশ্যক
    ssl: {
        rejectUnauthorized: false
    }
});

// সংযোগ পরীক্ষা (Server start এর সময় সমস্যা হলে এই ত্রুটি আসবে)
pool.query('SELECT NOW()', (err) => {
    if (err) {
        console.error('❌ Neon ডেটাবেস সংযোগ ব্যর্থ:', err.stack);
        // সংযোগ ব্যর্থ হলে pool undefined হবে, যা api.js এ ত্রুটি তৈরি করবে।
    } else {
        console.log('✅ Neon ডেটাবেসের সাথে সংযোগ সফল।');
    }
});

// pool অবজেক্টটি এক্সপোর্ট করা হলো
module.exports = { pool };
