// db.js (বিকল্প কনফিগারেশন)
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    // এই ভেরিয়েবলগুলোও Render এ আলাদাভাবে সেট করতে হবে:
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: {
        rejectUnauthorized: false
    }
});
// ... rest of the code remains the same ...
