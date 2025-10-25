// logic.js
const { pool } = require('./db'); 

// --- কনস্ট্যান্টস ---
const MIN_WITHDRAW_POINTS = 10000;
const MAX_WITHDRAW_POINTS = 100000;
const DAILY_LIMIT = 3;
const REFERRAL_BONUS = 250;
const POINTS_PER_AD = 5;
const WITHDRAW_START_HOUR = 6;  // সকাল 6টা
const WITHDRAW_END_HOUR = 20;   // রাত 8টা (20:00)

// পয়েন্ট থেকে টাকায় রূপান্তর
function pointsToBdt(points) {
    // 10,000 Points = 40 Taka
    return (points / 10000) * 40;
}

// --- ১. ইউজার রেজিস্ট্রেশন এবং রেফারেল বোনাস লজিক ---
async function registerUser(telegramId, username, referrerCode) {
    const newReferralCode = `r_${telegramId}`; 
    let referrerId = null;
    let bonus = false;
    
    // প্রথমে ইউজারটি ইতিমধ্যে বিদ্যমান কিনা তা চেক করুন
    const existingUser = await pool.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [telegramId]);
    if (existingUser.rows.length > 0) {
        return { isNew: false };
    }
    
    // রেফারারকে খুঁজে বের করা এবং বোনাস প্রদান
    if (referrerCode) {
        const referrer = await pool.query('SELECT telegram_id FROM users WHERE referral_code = $1', [referrerCode]);
        if (referrer.rows.length) {
            referrerId = referrer.rows[0].telegram_id;
            
            // রেফারারকে ২৫০ পয়েন্ট প্রদান
            await pool.query(
                'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2', 
                [REFERRAL_BONUS, referrerId]
            );
            bonus = true;
        }
    }

    // নতুন ইউজারকে ডেটাবেসে ইনসার্ট করা
    try {
        await pool.query(
            'INSERT INTO users (telegram_id, username, total_points, referred_by_id, referral_code) VALUES ($1, $2, $3, $4, $5)',
            [telegramId, username, 0, referrerId, newReferralCode]
        );
        return { isNew: true, referrerId: referrerId, bonus: bonus };
    } catch (e) {
        console.error("ইউজার রেজিস্ট্রেশন (INSERT) ত্রুটি:", e);
        // যদি কোনো কারণে ইনসার্ট ব্যর্থ হয়
        return { isNew: false }; 
    }
}

// --- ২. উইথড্র রিকোয়েস্ট হ্যান্ডেলিং লজিক ---
async function handleWithdrawRequest(telegramId, requestedPoints, paymentAddress, bot, ADMIN_ID) {
    const now = new Date();
    const currentHour = now.getHours();

    // টাইম চেক (সার্ভার টাইম অনুযায়ী)
    if (currentHour < WITHDRAW_START_HOUR || currentHour >= WITHDRAW_END_HOUR) {
        return { success: false, message: "❌ উইথড্র চালু সকাল ৬টা থেকে রাত ৮টা পর্যন্ত। বর্তমানে বন্ধ আছে।" };
    }
    
    // পয়েন্ট লিমিট চেক
    if (requestedPoints < MIN_WITHDRAW_POINTS || requestedPoints > MAX_WITHDRAW_POINTS) {
        return { success: false, message: `পয়েন্ট লিমিট ${MIN_WITHDRAW_POINTS} থেকে ${MAX_WITHDRAW_POINTS} এর মধ্যে হতে হবে।` };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // ট্রানজেকশন শুরু

        // ইউজার ডেটা লক এবং চেক করুন
        const userResult = await client.query(
            'SELECT total_points, daily_withdraw_count FROM users WHERE telegram_id = $1 FOR UPDATE',
            [telegramId]
        );
        const user = userResult.rows[0];

        if (!user || user.total_points < requestedPoints) {
            await client.query('ROLLBACK');
            return { success: false, message: "আপনার অ্যাকাউন্টে যথেষ্ট পয়েন্ট নেই।" };
        }
        if (user.daily_withdraw_count >= DAILY_LIMIT) {
            await client.query('ROLLBACK');
            return { success: false, message: `দৈনিক উইথড্র লিমিট (${DAILY_LIMIT} বার) অতিক্রম করেছেন।` };
        }

        // রিকোয়েস্ট সেভ
        const amountInBdt = pointsToBdt(requestedPoints);
        await client.query(
            'INSERT INTO withdraw_requests (user_id, points_requested, amount_in_bdt, payment_address) VALUES ($1, $2, $3, $4)',
            [telegramId, requestedPoints, amountInBdt.toFixed(2), paymentAddress]
        );

        // পয়েন্ট ও কাউন্ট আপডেট
        await client.query(
            'UPDATE users SET total_points = total_points - $1, daily_withdraw_count = daily_withdraw_count + 1 WHERE telegram_id = $2',
            [requestedPoints, telegramId]
        );

        await client.query('COMMIT'); // ট্রানজেকশন সফল
        
        // অ্যাডমিনকে নোটিফিকেশন পাঠানো
        const message = `🚨 নতুন উইথড্র রিকোয়েস্ট!\nইউজার ID: ${telegramId}\nপয়েন্ট: ${requestedPoints}\nটাকা: ${amountInBdt.toFixed(2)} BDT\nপেমেন্ট অ্যাড্রেস: ${paymentAddress}`;
        if (bot && ADMIN_ID) {
             bot.telegram.sendMessage(ADMIN_ID, message);
        }

        return { success: true, message: `✅ ${requestedPoints} পয়েন্টের (${amountInBdt.toFixed(2)} BDT) উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে।` };

    } catch (e) {
        await client.query('ROLLBACK'); // কোনো ত্রুটি হলে পরিবর্তন বাতিল
        console.error("উইথড্র ট্রানজেকশন ত্রুটি:", e);
        return { success: false, message: "❌ একটি অভ্যন্তরীণ ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।" };
    } finally {
        client.release();
    }
}

// --- ৩. অ্যাড পয়েন্ট লজিক (Monetag-এর জন্য) ---
async function awardMonetagPoints(userId, transactionId) {
    try {
        // ডাবল-ক্রেডিট এড়ানোর জন্য ad_view_logs টেবিলে ইনসার্ট চেষ্টা করুন
        const logResult = await pool.query(
            'INSERT INTO ad_view_logs (user_id, monetag_transaction_id, points_awarded, is_verified) VALUES ($1, $2, $3, TRUE) ON CONFLICT (monetag_transaction_id) DO NOTHING RETURNING log_id',
            [userId, transactionId, POINTS_PER_AD]
        );

        if (logResult.rows.length > 0) {
             // ইউজারকে পয়েন্ট প্রদান
            await pool.query(
                'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2',
                [POINTS_PER_AD, userId]
            );
            return { awarded: true };
        } else {
            return { awarded: false, message: 'ডুপ্লিকেট ট্রানজেকশন' };
        }
    } catch (error) {
        console.error('Monetag পয়েন্ট প্রদান ত্রুটি:', error);
        throw error;
    }
}


module.exports = {
    pointsToBdt,
    registerUser,
    handleWithdrawRequest,
    awardMonetagPoints,
    MIN_WITHDRAW_POINTS,
    MAX_WITHDRAW_POINTS
};
