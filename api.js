// api.js

const express = require('express');
const router = express.Router();
// এখানে ধরে নেওয়া হচ্ছে যে db.js (বা server.js এর মতো) থেকে পুলটিকে ইম্পোর্ট করা যাবে
// যদি আপনি server.js এ pool তৈরি করেন, তবে আপনাকে এটি module.exports এর মাধ্যমে এক্সপোর্ট করতে হবে।
// আপাতত ধরে নিচ্ছি server.js এ pool ইম্পোর্ট করার জন্য একটি Pool object পাস হবে।
// এটি server.js এ এডিট করতে হবে: app.use('/api', apiRouter(pool));
module.exports = (pool, bot, adminId) => {
    
    // --- ইউটিলিটি ফাংশন ---

    // পয়েন্ট কনভার্সন ফাংশন: 10,000 Points = 40 Taka
    const pointsToBdt = (points) => {
        return (points / 10000) * 40;
    }

    // উইথড্র রিকোয়েস্ট হ্যান্ডেলিং ফাংশন (server.js থেকে এখানে নিয়ে আসা হয়েছে)
    const handleWithdrawRequest = async (telegramId, requestedPoints, paymentAddress) => {
        const WITHDRAW_START_HOUR = 6;
        const WITHDRAW_END_HOUR = 20; 
        const MIN_WITHDRAW_POINTS = 10000;
        const MAX_WITHDRAW_POINTS = 100000;
        const DAILY_LIMIT = 3;
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
            await client.query('BEGIN');

            // ইউজার ডেটা চেক
            const userResult = await client.query(
                'SELECT total_points, daily_withdraw_count FROM users WHERE telegram_id = $1 FOR UPDATE',
                [telegramId]
            );
            const user = userResult.rows[0];

            if (!user || user.total_points < requestedPoints) {
                return { success: false, message: "আপনার অ্যাকাউন্টে যথেষ্ট পয়েন্ট নেই।" };
            }
            if (user.daily_withdraw_count >= DAILY_LIMIT) {
                return { success: false, message: `দৈনিক উইথড্র লিমিট (${DAILY_LIMIT} বার) অতিক্রম করেছেন।` };
            }

            // রিকোয়েস্ট সেভ
            const amountInBdt = pointsToBdt(requestedPoints);
            await client.query(
                'INSERT INTO withdraw_requests (user_id, points_requested, amount_in_bdt, payment_address) VALUES ($1, $2, $3, $4)',
                [telegramId, requestedPoints, amountInBdt.toFixed(2), paymentAddress]
            );

            // পয়েন্ট আপডেট
            await client.query(
                'UPDATE users SET total_points = total_points - $1, daily_withdraw_count = daily_withdraw_count + 1 WHERE telegram_id = $2',
                [requestedPoints, telegramId]
            );

            await client.query('COMMIT');
            return { success: true, message: `✅ ${requestedPoints} পয়েন্টের (${amountInBdt.toFixed(2)} BDT) উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে।` };

        } catch (e) {
            await client.query('ROLLBACK');
            throw e; // সার্ভার.js এ ত্রুটি হ্যান্ডেল করার জন্য
        } finally {
            client.release();
        }
    }


    // --- ১. মনিটেগ S2S কলব্যাক API রুট ---
    router.post('/monetag-callback', async (req, res) => {
        const { user_id, transaction_id, status } = req.body; 

        // SECURITY: Monetag সিকিউরিটি টোকেন যাচাই এখানে যোগ করুন
        // if (req.query.secret !== process.env.MONETAG_SECRET_KEY) { return res.status(403).send('Forbidden'); } 

        if (!user_id || !transaction_id || status !== 'success') {
            return res.status(400).json({ status: 'error', message: 'ব্যর্থ ট্রানজেকশন বা প্রয়োজনীয় ডেটা অনুপস্থিত' });
        }

        try {
            const logResult = await pool.query(
                'INSERT INTO ad_view_logs (user_id, monetag_transaction_id, points_awarded, is_verified) VALUES ($1, $2, 5, TRUE) ON CONFLICT (monetag_transaction_id) DO NOTHING RETURNING log_id',
                [user_id, transaction_id]
            );

            if (logResult.rows.length > 0) {
                // ৫ পয়েন্ট প্রদান
                await pool.query(
                    'UPDATE users SET total_points = total_points + 5 WHERE telegram_id = $1',
                    [user_id]
                );
                return res.json({ status: 'ok', message: 'পয়েন্ট দেওয়া হয়েছে' });
            } else {
                return res.json({ status: 'info', message: 'ডুপ্লিকেট ট্রানজেকশন আইডি এড়িয়ে যাওয়া হলো' });
            }
        } catch (error) {
            console.error('Monetag Callback Error:', error);
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
            const result = await handleWithdrawRequest(telegramId, points, paymentAddress);
            
            if (result.success) {
                // উইথড্র সফল হলে অ্যাডমিনকে নোটিফাই করুন
                const amountInBdt = pointsToBdt(points);
                const message = `🚨 নতুন উইথড্র রিকোয়েস্ট!\nইউজার ID: ${telegramId}\nপয়েন্ট: ${points}\nটাকা: ${amountInBdt.toFixed(2)} BDT\nপেমেন্ট অ্যাড্রেস: ${paymentAddress}`;
                bot.telegram.sendMessage(adminId, message); // bot এবং adminId ব্যবহার করা হয়েছে
                
                return res.status(200).json(result);
            } else {
                return res.status(400).json(result); 
            }
        } catch (error) {
            console.error("উইথড্র API ট্রানজেকশন ত্রুটি:", error);
            return res.status(500).json({ success: false, message: "❌ একটি অভ্যন্তরীণ ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।" });
        }
    });

    // --- ৩. ইউজার ডেটা API রুট ---
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
