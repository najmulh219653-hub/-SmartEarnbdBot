// api.js
const express = require('express');
const router = express.Router();
// মডিউলটি সঠিকভাবে destructuring করে আমদানি করা হয়েছে
const { pool } = require('./db'); 
const { pointsToBdt, handleWithdrawRequest } = require('./logic');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID;

// --- ১. মনিটেগ S2S কলব্যাক API রুট ---
// ... (Monetag লজিক অপরিবর্তিত) ...

// --- ২. উইথড্র রিকোয়েস্ট API রুট ---
router.post('/withdraw', async (req, res) => {
    // paymentMethod রিকোয়েস্ট বডি থেকে নেওয়া হলো
    const { telegramId, points, paymentAddress, paymentMethod } = req.body;

    const result = await handleWithdrawRequest(telegramId, points, paymentAddress, paymentMethod);
    
    if (result.success) {
        // অ্যাডমিন নোটিফিকেশনে পেমেন্ট মেথড যোগ করা হলো
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

    // ডেটাবেস পুল লোড নিশ্চিতকরণ
    if (!pool || !pool.query) {
        console.error("ডেটাবেস পুল লোড হয়নি বা সংযোগ নেই।");
        return res.status(503).json({ success: false, message: "সার্ভার প্রস্তুত নয় (DB Error)" });
    }

    try {
        // রেফারেল কাউন্ট সহ ডেটা আনা হলো
        const userResult = await pool.query('SELECT total_points, referral_code FROM users WHERE telegram_id = $1', [telegramId]);
        const referralCountResult = await pool.query('SELECT COUNT(*) AS count FROM users WHERE referred_by_id = $1', [telegramId]);
        const referralCount = referralCountResult.rows.length ? referralCountResult.rows[0].count : 0;
        
        if (userResult.rows.length > 0) {
            return res.json({ 
                success: true, 
                points: userResult.rows[0].total_points,
                referral_code: userResult.rows[0].referral_code,
                referral_count: referralCount // নতুন ডেটা
            });
        }
        return res.status(404).json({ success: false, message: "ইউজার খুঁজে পাওয়া যায়নি।" });

    } catch (error) {
        console.error("ইউজার ডেটা ত্রুটি:", error);
        res.status(500).json({ success: false, message: "অভ্যন্তরীণ সার্ভার ত্রুটি।" });
    }
});

// router অবজেক্টটি এক্সপোর্ট করা হলো (আগের TypeError ঠিক করে)
module.exports = router;
