// api.js

const express = require('express');
const router = express.Router();
const { pool } = require('./db'); 
const { awardMonetagPoints, handleWithdrawRequest, pointsToBdt } = require('./logic');
require('dotenv').config();

// এই মডিউলটি server.js থেকে bot এবং adminId গ্রহণ করবে।
module.exports = (bot, adminId) => { 
    
    // --- ১. মনিটেগ S2S কলব্যাক API রুট ---
    router.post('/monetag-callback', async (req, res) => {
        const { user_id, transaction_id, status } = req.body; 
        
        // **SECURITY: Monetag সিকিউরিটি টোকেন যাচাই**
        // এটি Monetag কলব্যাক URL এর query parameter হিসেবে আশা করা হচ্ছে (যেমন: /api/monetag-callback?secret=...)
        if (req.query.secret !== process.env.MONETAG_SECRET_KEY) { 
             console.log('Monetag Security Check Failed!');
             return res.status(403).json({ status: 'error', message: 'Forbidden: Security key invalid' });
        } 

        if (!user_id || !transaction_id || status !== 'success') {
            return res.status(400).json({ status: 'error', message: 'ব্যর্থ ট্রানজেকশন বা প্রয়োজনীয় ডেটা অনুপস্থিত' });
        }

        try {
            const result = await awardMonetagPoints(user_id, transaction_id);
            
            if (result.awarded) {
                return res.json({ status: 'ok', message: 'পয়েন্ট দেওয়া হয়েছে' });
            } else {
                return res.json({ status: 'info', message: result.message || 'ডুপ্লিকেট ট্রানজেকশন এড়িয়ে যাওয়া হলো' });
            }
        } catch (error) {
            console.error('Monetag Callback ত্রুটি:', error);
            res.status(500).json({ status: 'error', message: 'সার্ভার প্রক্রিয়াকরণ ত্রুটি' });
        }
    });

    // --- ২. উইথড্র রিকোয়েস্ট API রুট ---
    router.post('/withdraw', async (req, res) => {
        const { telegramId, points, paymentAddress } = req.body;

        if (!telegramId || !points || !paymentAddress) {
            return res.status(400).json({ success: false, message: "❌ সমস্ত তথ্য প্রদান করুন।" });
        }

        try {
            // logic.js থেকে ফাংশন কল করা
            const result = await handleWithdrawRequest(telegramId, points, paymentAddress, bot, adminId);
            
            if (result.success) {
                return res.status(200).json(result);
            } else {
                return res.status(400).json(result); 
            }
        } catch (error) {
            console.error("উইথড্র API ট্রানজেকশন ত্রুটি:", error);
            return res.status(500).json({ success: false, message: "❌ একটি অভ্যন্তরীণ ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।" });
        }
    });

    // --- ৩. ইউজার ডেটা API রুট (মিনি অ্যাপে পয়েন্ট দেখানোর জন্য) ---
    router.get('/user-data', async (req, res) => {
        const telegramId = req.query.id;
        if (!telegramId) {
            return res.status(400).json({ success: false, message: "ইউজার আইডি আবশ্যক।" });
        }

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

    return router;
};
