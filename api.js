// api.js - (পূর্বের কার্যকরী কোড)
const express = require('express');
const router = express.Router();
const { pool } = require('./db'); 
const { pointsToBdt, handleWithdrawRequest } = require('./logic');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID;

// --- ১. মনিটেগ S2S কলব্যাক API রুট ---
router.post('/monetag-callback', async (req, res) => {
    // ... (Monetag লজিক এখানে থাকবে) ...
    res.status(200).send('OK');
});

// --- ২. উইথড্র রিকোয়েস্ট API রুট ---
router.post('/withdraw', async (req, res) => {
    const { telegramId, points, paymentAddress, paymentMethod } = req.body;

    const result = await handleWithdrawRequest(telegramId, points, paymentAddress, paymentMethod);
    
    if (result.success) {
        const message = `🚨 নতুন উইথড্র রিকোয়েস্ট!\nইউজার ID: ${telegramId}\nপয়েন্ট: ${points}\nটাকা: ${pointsToBdt(points)} BDT\nপেমেন্ট মেথড: ${paymentMethod}\nপেমেন্ট অ্যাড্রেস: ${paymentAddress}`;
        bot.telegram.sendMessage(ADMIN_ID, message);
        
        return res.status(200).json(result);
    } else {
        return res.status(400).json(result); 
    }
});

// --- ৩. ইউজার ডেটা API রুট (পয়েন্ট দেখানোর জন্য) ---
router.get('/user-data', async (req, res) => {
    const telegramId = req.query.id;

    if (!pool || !pool.query) {
        return res.status(503).json({ success: false, message: "সার্ভার প্রস্তুত নয় (DB Error)" });
    }

    try {
        const userResult = await pool.query('SELECT total_points, referral_code FROM users WHERE telegram_id = $1', [telegramId]);
        const referralCountResult = await pool.query('SELECT COUNT(*) AS count FROM users WHERE referred_by_id = $1', [telegramId]);
        const referralCount = referralCountResult.rows.length ? referralCountResult.rows[0].count : 0;
        
        if (userResult.rows.length > 0) {
            return res.json({ 
                success: true, 
                points: userResult.rows[0].total_points,
                referral_code: userResult.rows[0].referral_code,
                referral_count: referralCount 
            });
        }
        // যদি ইউজার না থাকে, তবে 404 নয়, 0 পয়েন্ট দিয়ে ইউজার ডেটা পাঠানো হচ্ছে।
        // যাতে Mini App-এ "নেটওয়ার্ক ত্রুটি" না দেখিয়ে "0" দেখায়।
        return res.json({ 
            success: true, 
            points: 0,
            referral_code: `r_${telegramId}`, 
            referral_count: 0
        });

    } catch (error) {
        console.error("ইউজার ডেটা ত্রুটি:", error);
        res.status(500).json({ success: false, message: "অভ্যন্তরীণ সার্ভার ত্রুটি।" });
    }
});

module.exports = router;
