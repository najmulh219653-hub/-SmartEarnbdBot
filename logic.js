// logic.js
const { pool } = require('./db');
const { customAlphabet } = require('nanoid');

// ন্যানোইড দিয়ে রেফারেল কোড তৈরি
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);
const REFERRAL_BONUS = 250; 

// নতুন ইউজার রেজিস্টার ফাংশন
async function registerUser(telegramId, username, referrerCode) {
    let client;
    try {
        client = await pool.connect();

        // ১. ইউজার কি বিদ্যমান?
        const checkUser = await client.query(
            'SELECT user_id, total_points, referral_code FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        // যদি ইউজার খুঁজে পাওয়া যায়, তাকেই ফেরত দিন
        if (checkUser.rows.length > 0) {
            return { 
                isNew: false, 
                userId: checkUser.rows[0].user_id,
                points: checkUser.rows[0].total_points
            }; 
        }

        // ২. রেফারার আইডি খুঁজে বের করুন
        let referrerId = null;
        if (referrerCode) {
            const referrerResult = await client.query(
                'SELECT user_id FROM users WHERE referral_code = $1',
                [referrerCode]
            );
            if (referrerResult.rows.length > 0) {
                referrerId = referrerResult.rows[0].user_id;
            }
        }
        
        // ৩. নতুন ইউজারকে ডাটাবেসে যোগ করুন
        const newReferralCode = nanoid();
        const initialPoints = referrerId ? REFERRAL_BONUS : 0; // রেফারার থাকলে ২৫০ পয়েন্ট বোনাস
        
        const newUserResult = await client.query(
            'INSERT INTO users (telegram_id, username, total_points, referral_code, referrer_id) VALUES ($1, $2, $3, $4, $5) RETURNING user_id',
            [telegramId, username || 'user', initialPoints, newReferralCode, referrerId]
        );

        const newUserId = newUserResult.rows[0].user_id;

        // ৪. রেফারারকে বোনাস দিন
        if (referrerId) {
             await client.query(
                'UPDATE users SET total_points = total_points + $1 WHERE user_id = $2',
                [REFERRAL_BONUS, referrerId]
            );
        }

        return { 
            isNew: true, 
            userId: newUserId, 
            points: initialPoints, 
            bonus: referrerId ? REFERRAL_BONUS : 0,
            referrerId: referrerId // বট মেসেজ পাঠানোর জন্য
        };

    } catch (error) {
        console.error("ইউজার রেজিস্ট্রেশন লজিক ত্রুটি:", error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

// টেলিগ্রাম আইডি দিয়ে পয়েন্ট পাওয়া
async function getPointsByTelegramId(telegramId) {
    try {
        const result = await pool.query(
            'SELECT total_points FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        if (result.rows.length > 0) {
            return parseInt(result.rows[0].total_points);
        }
        return 0;
    } catch (error) {
        console.error("পয়েন্ট লোড করার ত্রুটি:", error);
        return 0;
    }
}

// এই ফাংশনটি আগেরটিই, কিন্তু নাম পরিবর্তন
async function getTotalPoints(telegramId) {
    return await getPointsByTelegramId(telegramId);
}


module.exports = {
    registerUser,
    getPointsByTelegramId,
    getTotalPoints
};
