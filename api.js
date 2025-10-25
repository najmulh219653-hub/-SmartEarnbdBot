// api.js - মিনি অ্যাপের ডেটাবেস অ্যাক্সেসের জন্য API রুট হ্যান্ডেল করে।
const express = require('express');
const router = express.Router();
const db = require('./db');

// --- কনফিগারেশন ---
// MONETAG_SECRET_KEY পরিবেশ ভেরিয়েবল থেকে লোড হচ্ছে
const MONETAG_SECRET_KEY = process.env.MONETAG_SECRET_KEY || 'MyEarnQuickSecretKey123'; 

/**
 * নিরাপত্তা এবং অথেনটিকেশন মিডলওয়্যার
 * নিশ্চিত করে যে অনুরোধটি অনুমোদিত এবং একটি বৈধ ইউজার আইডি ধারণ করে।
 */
const authMiddleware = (req, res, next) => {
    const secretKey = req.headers['secret-key'];
    // ইউজার আইডি Authorization Header বা Query Parameter থেকে নেওয়া হচ্ছে
    const userId = req.headers['authorization'] ? req.headers['authorization'].split(' ')[1] : req.query.userId;
    
    // ১. সিক্রেট কী চেক করা
    if (!secretKey || secretKey !== MONETAG_SECRET_KEY) {
        console.warn("Unauthorized API access attempt: Invalid Secret Key.");
        return res.status(401).json({ message: "Unauthorized: Invalid Secret Key" });
    }

    // ২. ইউজার আইডি চেক করা
    if (!userId) {
        return res.status(400).json({ message: "Bad Request: User ID is required" });
    }

    req.userId = userId;
    next();
};

router.use(authMiddleware);

// --- ১. ব্যালেন্স দেখা এবং ইউজার তৈরি করা ---
// GET /api/balance
router.get('/balance', async (req, res) => {
    const userId = req.userId;
    
    try {
        // ইউজার খুঁজে বের করা
        let result = await db.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
        let balance = 0;

        if (result.rows.length === 0) {
            // ইউজার না থাকলে নতুন ইউজার তৈরি করা
            await db.query('INSERT INTO users (user_id) VALUES ($1)', [userId]);
            console.log(`New user created: ${userId}`);
            balance = 0;
        } else {
            // ইউজার থাকলে ব্যালেন্স নেওয়া
            balance = result.rows[0].balance;
        }

        res.status(200).json({ userId, balance });

    } catch (error) {
        console.error(`Error fetching/creating user ${userId}:`, error.message);
        res.status(500).json({ message: "Internal Server Error during balance fetch" });
    }
});

// --- ২. রিওয়ার্ড প্রদান করা (পয়েন্ট যুক্ত করা) ---
// POST /api/grant-reward
router.post('/grant-reward', async (req, res) => {
    const userId = req.userId;
    const { points, transactionId } = req.body;

    // ভ্যালিডেশন
    if (!points || typeof points !== 'number' || points <= 0 || !transactionId) {
        return res.status(400).json({ message: "Invalid request parameters." });
    }

    try {
        // ডাবল রিওয়ার্ড আটকাতে ট্রানজেকশন আইডি চেক করা
        const transactionCheck = await db.query('SELECT * FROM transactions WHERE transaction_id = $1', [transactionId]);
        if (transactionCheck.rows.length > 0) {
            console.warn(`Attempted duplicate reward for Transaction ID: ${transactionId}`);
            return res.status(409).json({ message: "Duplicate reward detected." });
        }

        // ডেটাবেস ট্রানজেকশন শুরু করা
        await db.query('BEGIN');

        // ১. ব্যালেন্স আপডেট করা
        const updateResult = await db.query(
            'UPDATE users SET balance = balance + $1 WHERE user_id = $2 RETURNING balance',
            [points, userId]
        );
        
        // ২. ট্রানজেকশন লগ করা
        await db.query(
            'INSERT INTO transactions (transaction_id, user_id, points_granted) VALUES ($1, $2, $3)',
            [transactionId, userId, points]
        );

        // কমিট করা
        await db.query('COMMIT');

        const newBalance = updateResult.rows[0].balance;
        res.status(200).json({ 
            message: "Reward granted successfully.", 
            newBalance,
            pointsGranted: points 
        });

    } catch (error) {
        // কোনো ত্রুটি হলে রোলব্যাক করা
        await db.query('ROLLBACK');
        console.error(`Error granting reward for user ${userId}:`, error.message);
        res.status(500).json({ message: "Internal Server Error during reward grant" });
    }
});

module.exports = router;
