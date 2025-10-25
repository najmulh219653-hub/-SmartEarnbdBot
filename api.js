// api.js
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
    const { user_id, transaction_id, status } = req.body; 
    
    if (status === 'success' && user_id) {
        try {
            // ডাবল-ক্রেডিট এড়ানোর জন্য ad_view_logs টেবিলে ইনসার্ট চেষ্টা করুন
            const logResult = await pool.query(
                'INSERT INTO ad_view_logs (user_id, monetag_transaction_id, points_awarded, is_verified) VALUES ($1, $2, 5, TRUE) ON CONFLICT (monetag_transaction_id) DO NOTHING RETURNING log_id',
                [user_id, transaction_id]
            );

            if (logResult.rows.length > 0) {
                // ইউজারকে ৫ পয়েন্ট প্রদান
                await pool.query(
                    'UPDATE users SET total_points = total_points + 5 WHERE telegram_id = $1',
                    [user_id]
                );
                return res.json({ status: 'ok', message: 'পয়েন্ট দেওয়া হয়েছে' }); 
            }
        } catch (error) {
            console.error('Monetag Callback Error:', error);
        }
    }
    res.json({ status: 'error', message: 'ব্যর্থ ট্রানজেকশন বা ডুপ্লিকেট' }); 
});

// --- ২. উইথড্র রিকোয়েস্ট API রুট ---
router.post('/withdraw', async (req, res) => {
    const { telegramId, points, paymentAddress } = req.body;

    const result = await handleWithdrawRequest(telegramId, points, paymentAddress);
    
    if (result.success) {
        // উইথড্র সফল হলে অ্যাডমিনকে নোটিফাই করুন
        const message = `🚨 নতুন উইথড্র রিকোয়েস্ট!\nইউজার ID: ${telegramId}\nপয়েন্ট: ${points}\nটাকা: ${pointsToBdt(points)} BDT\nপেমেন্ট অ্যাড্রেস: ${paymentAddress}`;
        bot.telegram.sendMessage(ADMIN_ID, message);
        
        return res.status(200).json(result);
    } else {
        return res.status(400).json(result); 
    }
});

// --- ৩. ইউজার ডেটা API রুট (পয়েন্ট দেখানোর জন্য) ---
router.get('/user-data', async (req, res) => {
    const telegramId = req.query.id;

    try {
        const result = await pool.query('SELECT total_points, referral_code FROM users WHERE telegram_id = $1', [telegramId]);
        
        if (result.rows.length > 0) {
            return res.json({ 
                success: true, 
                points: result.rows[0].total_points,
                referral_code: result.rows[0].referral_code 
            });
        }
        return res.status(404).json({ success: false, message: "ইউজার খুঁজে পাওয়া যায়নি।" });

    } catch (error) {
        console.error("ইউজার ডেটা ত্রুটি:", error);
        res.status(500).json({ success: false, message: "অভ্যন্তরীণ সার্ভার ত্রুটি।" });
    }
});

module.exports = router;
