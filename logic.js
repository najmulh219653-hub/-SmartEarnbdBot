// logic.js
const { pool } = require('./db');
// nanoid মডিউলটি ব্যবহার করা হয়েছে ইউনিক রেফারেল কোড তৈরির জন্য
const { nanoid } = require('nanoid'); 

// রেফারেল কোডের দৈর্ঘ্য (যেমন: 8 অক্ষর)
const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_BONUS_POINTS = 250; 

/**
 * @function generateReferralCode
 * ইউনিক রেফারেল কোড তৈরি করে
 */
function generateReferralCode() {
    // শুধুমাত্র অক্ষর এবং সংখ্যা ব্যবহার করে রেফারেল কোড তৈরি
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const code = nanoid(REFERRAL_CODE_LENGTH); 
    return `r_${code}`;
}

/**
 * @function registerUser
 * একজন নতুন ব্যবহারকারীকে রেজিস্টার করে বা বিদ্যমান ব্যবহারকারীকে ফিরিয়ে দেয়।
 * রেফারেল ট্র্যাকিং এবং বোনাস হ্যান্ডেল করে।
 * @param {number} telegramId - ইউজারের Telegram ID
 * @param {string} username - ইউজারের Telegram username
 * @param {string|null} payloadReferrerCode - /start কমান্ডের payload থেকে পাওয়া রেফারেল কোড
 */
async function registerUser(telegramId, username, payloadReferrerCode) {
    let client;
    let isNew = false;
    let bonus = 0;
    let referrerTelegramId = null; 

    try {
        client = await pool.connect();
        
        // ১. ব্যবহারকারী কি ইতিমধ্যেই আছে? চেক করুন
        const existingUser = await client.query(
            'SELECT telegram_id, total_points, referrer_id FROM users WHERE telegram_id = $1',
            [telegramId]
        );

        if (existingUser.rows.length > 0) {
            // পুরাতন ইউজার
            const user = existingUser.rows[0];
            return { 
                isNew: false, 
                telegramId: user.telegram_id, 
                totalPoints: user.total_points, 
                referrerTelegramId: user.referrer_id 
            };
        }

        // ২. নতুন ব্যবহারকারী: রেজিস্ট্রেশন প্রক্রিয়া শুরু করুন

        // ইউনিক রেফারেল কোড তৈরি
        const newReferralCode = generateReferralCode();
        
        // রেফারকারী ইউজারকে খুঁজে বের করুন
        if (payloadReferrerCode) {
            const referrerResult = await client.query(
                'SELECT telegram_id FROM users WHERE referral_code = $1',
                [payloadReferrerCode]
            );

            if (referrerResult.rows.length > 0) {
                // রেফারকারী খুঁজে পাওয়া গেছে, তার telegram_id সংরক্ষণ করুন
                referrerTelegramId = referrerResult.rows[0].telegram_id;
                bonus = REFERRAL_BONUS_POINTS;
            }
        }

        // ৩. ব্যবহারকারীকে ডেটাবেসে যোগ করুন
        const insertResult = await client.query(
            `INSERT INTO users (telegram_id, username, total_points, referral_code, referrer_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING telegram_id`,
            [telegramId, username, bonus, newReferralCode, referrerTelegramId] // referrer_id তে রেফারকারীর telegram_id যাবে
        );

        isNew = true;

        // ৪. যদি রেফারেল বোনাস থাকে, তবে রেফারকারীকে বোনাস পয়েন্ট দিন
        if (referrerTelegramId) {
            await client.query(
                'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
                [REFERRAL_BONUS_POINTS, referrerTelegramId]
            );
        }

        // ৫. ফলাফল ফেরত দিন
        return { 
            isNew: isNew, 
            telegramId: telegramId, 
            totalPoints: bonus, 
            bonus: bonus, 
            referrerTelegramId: referrerTelegramId 
        };

    } catch (error) {
        console.error("ডেটাবেসে ইউজার রেজিস্ট্রেশন/আপডেট ত্রুটি:", error);
        throw error; // ত্রুটি server.js এ ফিরিয়ে দিন
    } finally {
        if (client) {
            client.release();
        }
    }
}

/**
 * @function getPointsByTelegramId
 * ইউজারের বর্তমান পয়েন্ট ফেরত দেয়
 */
async function getPointsByTelegramId(telegramId) {
    const result = await pool.query(
        'SELECT total_points FROM users WHERE telegram_id = $1',
        [telegramId]
    );
    return result.rows.length > 0 ? parseInt(result.rows[0].total_points) : 0;
}

/**
 * @function getTotalPoints
 * getPointsByTelegramId এর অনুরূপ, api.js এ উইথড্রর পরে নতুন পয়েন্ট দেখানোর জন্য ব্যবহৃত।
 */
async function getTotalPoints(telegramId) {
    return getPointsByTelegramId(telegramId);
}


module.exports = {
    registerUser,
    getPointsByTelegramId,
    getTotalPoints
};
