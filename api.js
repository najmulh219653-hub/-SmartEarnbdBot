// api.js
const express = require('express');
const router = express.Router();
// নিশ্চিত করুন যে pool অবজেক্টটি db.js ফাইল থেকে destructuring করে নেওয়া হচ্ছে
const { pool } = require('./db'); 
const { pointsToBdt, handleWithdrawRequest } = require('./logic');
const { Telegraf } = require('telegraf');
require('dotenv').config();

// ... বাকি কোড ...
// লাইনে 61: এখানে সম্ভবত pool.query() ব্যবহার করার সময় ত্রুটি হচ্ছে।
// pool অবজেক্টটি undefined হলে এই ত্রুটি হবে।
// router.get('/user-data', async (req, res) => {
//     const telegramId = req.query.id;
//     // 61: const result = await pool.query('SELECT total_points, referral_code FROM users WHERE telegram_id = $1', [telegramId]); 
//     // ...
// });
