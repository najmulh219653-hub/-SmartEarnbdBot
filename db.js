// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.query('SELECT NOW()', (err) => {
    if (err) {
        console.error('❌ Neon ডেটাবেস সংযোগ ব্যর্থ:', err.stack);
    } else {
        console.log('✅ Neon ডেটাবেসের সাথে সংযোগ সফল।');
    }
});

module.exports = { pool };
