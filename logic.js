// logic.js
const { pool } = require('./db');
const { generateReferralCode } = require('./utils'); // ধরে নিলাম utils ফাইলে এটি আছে

const REFERRAL_BONUS = 250; 

// --- ১. ইউজার রেজিস্ট্রেশন ---
async function registerUser(telegramId, username, referrerCode) {
    let client;
    try {
        client = await pool.connect();
        
        // ১. ইউজার আছে কিনা চেক
        const userCheck = await client.query('SELECT user_id, telegram_id, total_points FROM users WHERE telegram_id = $1', [telegramId]);

        if (userCheck.rows.length > 0) {
            // পুরাতন ইউজার
            return { isNew: false, bonus: 0, referrerId: null };
        }

        // ২. নতুন ইউজার, রেফার কোড তৈরি
        const newReferralCode = generateReferralCode(telegramId);
        let referrerId = null; 
        let bonus = 0;

        // ৩. রেফারেল চেক ও বোনাস
        if (referrerCode) {
            // r_8145444675 থেকে শুধু 8145444675 বের করা 
            const referrerTelegramId = referrerCode.substring(2); 
            
            // রেফারকারীকে খুঁজে বের করা
            const referrerResult = await client.query('SELECT user_id, telegram_id FROM users WHERE telegram_id = $1', [referrerTelegramId]);
            
            if (referrerResult.rows.length > 0) {
                referrerId = referrerResult.rows[0].user_id;
                
                // রেফারকারীকে বোনাস পয়েন্ট দেওয়া
                await client.query(
                    'UPDATE users SET total_points = total_points + $1 WHERE user_id = $2',
                    [REFERRAL_BONUS, referrerId]
                );
                
                bonus = REFERRAL_BONUS;
            }
        }

        // ৪. নতুন ইউজার ডাটাবেজে যোগ করা
        await client.query(
            'INSERT INTO users (telegram_id, username, total_points, referral_code, referrer_id) VALUES ($1, $2, $3, $4, $5)',
            [telegramId, username || `user_${telegramId}`, bonus, newReferralCode, referrerId]
        );

        return { isNew: true, bonus: bonus, referrerId: referrerId ? referrerTelegramId : null };

    } catch (error) {
        console.error("ইউজার রেজিস্ট্রেশন ত্রুটি:", error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

// --- ২. টোটাল পয়েন্ট লোড করা ---
async function getTotalPoints(telegramId) {
    try {
        const result = await pool.query('SELECT total_points FROM users WHERE telegram_id = $1', [telegramId]);
        if (result.rows.length > 0) {
            return parseInt(result.rows[0].total_points);
        }
        return 0;
    } catch (error) {
        console.error("পয়েন্ট লোড করার ত্রুটি:", error);
        return 0;
    }
}

// --- ৩. getPointsByTelegramId (উইথড্র লজিকের জন্য) ---
async function getPointsByTelegramId(telegramId) {
    return getTotalPoints(telegramId);
}

module.exports = {
    registerUser,
    getTotalPoints,
    getPointsByTelegramId,
};
