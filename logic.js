// logic.js - (পূর্বের কার্যকরী কোড)
const { pool } = require('./db'); 

const MIN_WITHDRAW_POINTS = 10000;
const MAX_WITHDRAW_POINTS = 100000;
const DAILY_LIMIT = 3;
const REFERRAL_BONUS = 250;
const WITHDRAW_START_HOUR = 6;
const WITHDRAW_END_HOUR = 20;

function pointsToBdt(points) {
    return (points / 10000) * 40; 
}

async function registerUser(telegramId, username, referrerCode) {
    const newReferralCode = `r_${telegramId}`; 
    let referrerId = null;
    let bonus = false;
    
    if (referrerCode) {
        const referrer = await pool.query('SELECT telegram_id FROM users WHERE referral_code = $1', [referrerCode]);
        if (referrer.rows.length) {
            referrerId = referrer.rows[0].telegram_id;
            await pool.query(
                'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2', 
                [REFERRAL_BONUS, referrerId]
            );
            bonus = true;
        }
    }

    try {
        await pool.query(
            'INSERT INTO users (telegram_id, username, total_points, referred_by_id, referral_code) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (telegram_id) DO NOTHING',
            [telegramId, username, 0, referrerId, newReferralCode]
        );
        return { isNew: true, referrerId: referrerId, bonus: bonus };
    } catch (e) {
        console.error("Registration/Referral Error:", e);
        return { isNew: false }; 
    }
}

async function handleWithdrawRequest(telegramId, requestedPoints, paymentAddress, paymentMethod) {
    const now = new Date();
    const currentHour = now.getHours();

    if (currentHour < WITHDRAW_START_HOUR || currentHour >= WITHDRAW_END_HOUR) {
        return { success: false, message: "❌ উইথড্র চালু সকাল ৬টা থেকে রাত ৮টা পর্যন্ত। বর্তমানে বন্ধ আছে।" };
    }
    
    if (requestedPoints < MIN_WITHDRAW_POINTS || requestedPoints > MAX_WITHDRAW_POINTS) {
        return { success: false, message: `পয়েন্ট লিমিট ${MIN_WITHDRAW_POINTS} থেকে ${MAX_WITHDRAW_POINTS} এর মধ্যে হতে হবে।` };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); 
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

        const amountInBdt = pointsToBdt(requestedPoints);
        
        await client.query(
            'INSERT INTO withdraw_requests (user_id, points_requested, amount_in_bdt, payment_address, payment_method) VALUES ($1, $2, $3, $4, $5)',
            [telegramId, requestedPoints, amountInBdt, paymentAddress, paymentMethod]
        );

        await client.query(
            'UPDATE users SET total_points = total_points - $1, daily_withdraw_count = daily_withdraw_count + 1 WHERE telegram_id = $2',
            [requestedPoints, telegramId]
        );

        await client.query('COMMIT');
        return { success: true, message: `✅ ${requestedPoints} পয়েন্টের (${amountInBdt} BDT) উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে।` };

    } catch (e) {
        await client.query('ROLLBACK'); 
        console.error("উইথড্র ত্রুটি:", e);
        return { success: false, message: "❌ একটি অভ্যন্তরীণ ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।" };
    } finally {
        client.release();
    }
}

module.exports = {
    pointsToBdt,
    registerUser,
    handleWithdrawRequest,
};
