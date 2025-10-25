// db.js
const { Pool } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL এনভায়রনমেন্ট ভ্যারিয়েবল সেট করা নেই!");
    // প্রজেক্টের জন্য ডেটাবেস কনফিগারেশন আবশ্যক
    process.exit(1); 
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        // Render/Neon ব্যবহার করার জন্য SSL মোড প্রয়োজন
        rejectUnauthorized: false
    }
});

// ডেটাবেস সংযোগ পরীক্ষা
pool.query('SELECT NOW()')
    .then(() => console.log('✅ PostgreSQL ডেটাবেসের সাথে সংযোগ সফল। (db.js)'))
    .catch((err) => {
        console.error('❌ ডেটাবেস সংযোগ ব্যর্থ:', err.stack);
        process.exit(1); 
    });

module.exports = {
    pool
};
