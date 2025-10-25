// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// সংযোগ পরীক্ষা
pool.query('SELECT NOW()', (err) => {
    if (err) {
        // যদি সংযোগ ব্যর্থ হয়, আমরা প্রক্রিয়া বন্ধ করব না
        console.error('❌ Neon ডেটাবেস সংযোগ ব্যর্থ:', err.stack);
    } else {
        console.log('✅ Neon ডেটাবেসের সাথে সংযোগ সফল।');
    }
});

module.exports = { pool };
