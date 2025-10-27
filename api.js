// api.js
const express = require('express');
const router = express.Router(); 
const { pool } = require('./db');
const { getPointsByTelegramId, getTotalPoints } = require('./logic');

// --- ১. উইথড্র রিকোয়েস্ট API রুট (/withdraw) ---
router.post('/withdraw', async (req, res) => {
    const { telegramId, points, paymentMethod, paymentAddress } = req.body;
    
    if (!telegramId || !points || !paymentMethod || !paymentAddress) {
        return res.status(400).json({ success: false, message: "সকল ঘর পূরণ করুন।" });
    }

    try {
        const userPoints = await getPointsByTelegramId(telegramId);
        
        if (userPoints < points) {
            return res.status(403).json({ success: false, message: `আপনার অ্যাকাউন্টে যথেষ্ট পয়েন্ট নেই। আছে: ${userPoints}` });
        }

        // ইউজার থেকে পয়েন্ট বিয়োগ করা
        await pool.query(
            'UPDATE users SET total_points = total_points - $1 WHERE telegram_id = $2',
            [points, telegramId]
        );

        // উইথড্র রিকোয়েস্ট ডাটাবেসে যোগ করা
        await pool.query(
            'INSERT INTO withdraw_requests (user_id, points_requested, payment_method, payment_address) VALUES ((SELECT user_id FROM users WHERE telegram_id = $1), $2, $3, $4)',
            [telegramId, points, paymentMethod, paymentAddress]
        );

        const newPoints = await getTotalPoints(telegramId);

        return res.status(200).json({ 
            success: true, 
            message: `✅ সফলভাবে ${points} পয়েন্ট উইথড্র রিকোয়েস্ট পাঠানো হয়েছে।`,
            new_points: newPoints 
        });

    } catch (error) {
        console.error("উইথড্র রিকোয়েস্ট ত্রুটি:", error);
        res.status(500).json({ success: false, message: "অভ্যন্তরীণ সার্ভার ত্রুটি।" });
    }
});


// --- ২. ইউজার ডাটা API রুট (/user-data) ---
router.get('/user-data', async (req, res) => {
    const telegramId = req.query.id;
    if (!telegramId) {
        return res.status(400).json({ success: false, message: "Telegram ID অনুপস্থিত।" });
    }

    try {
        const result = await pool.query(
            `SELECT 
                u.total_points, 
                u.referral_code,
                (SELECT COUNT(*) FROM users AS r WHERE r.referrer_id = u.user_id) AS referral_count
             FROM users AS u
             WHERE u.telegram_id = $1`,
            [telegramId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "ইউজার খুঁজে পাওয়া যায়নি।" });
        }

        const userData = result.rows[0];

        return res.status(200).json({
            success: true,
            points: parseInt(userData.total_points),
            referral_code: userData.referral_code,
            referral_count: parseInt(userData.referral_count)
        });

    } catch (error) {
        console.error("ইউজার ডেটা লোড করার ত্রুটি:", error);
        res.status(500).json({ success: false, message: "অভ্যন্তরীণ সার্ভার ত্রুটি।" });
    }
});


// --- ৩. পয়েন্ট যোগ করার নতুন API রুট (/add-points) ---
router.post('/add-points', async (req, res) => {
    const { telegramId, points } = req.body;
    const pointsToAdd = points || 5; 
    
    if (!telegramId) {
        return res.status(400).json({ success: false, message: "Telegram ID অনুপস্থিত।" });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2 RETURNING total_points',
            [pointsToAdd, telegramId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "ইউজার খুঁজে পাওয়া যায়নি।" });
        }

        return res.status(200).json({ 
            success: true, 
            message: `✅ আপনি সফলভাবে ${pointsToAdd} পয়েন্ট অর্জন করেছেন!`, 
            new_points: result.rows[0].total_points
        });

    } catch (error) {
        console.error("পয়েন্ট যোগ করার ত্রুটি:", error);
        res.status(500).json({ success: false, message: "অভ্যন্তরীণ সার্ভার ত্রুটি।" });
    }
});


module.exports = router;
