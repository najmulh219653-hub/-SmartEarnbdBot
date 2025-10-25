// server.js
const express = require('express');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
// .env ফাইল লোড করার জন্য, যদিও Render এ এটি দরকার নেই, লোকাল টেস্টিং এর জন্য রাখা ভালো।
require('dotenv').config(); 

// --- কনফিগারেশন এবং এনভায়রনমেন্ট ভেরিয়েবল ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
// আপনার Admin ID স্ট্রিং ফরম্যাটে রাখুন
const ADMIN_ID = process.env.ADMIN_ID ? process.env.ADMIN_ID.toString() : '8145444675'; 
const MINI_APP_URL = process.env.MINI_APP_URL || "আপনার_Blogger_বা_ফ্রন্টএন্ড_URL"; 
const BOT_USERNAME = process.env.BOT_USERNAME; // নতুন: বটের ইউজারনেম সেট করার জন্য

// --- ডেটাবেস সংযোগ ---
if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL সেট করা নেই! সার্ভার বন্ধ হচ্ছে।");
    process.exit(1);
}
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ডেটাবেস সংযোগ পরীক্ষা
pool.query('SELECT NOW()')
    .then(() => console.log('✅ PostgreSQL ডেটাবেসের সাথে সংযোগ সফল।'))
    .catch((err) => {
        console.error('❌ ডেটাবেস সংযোগ ব্যর্থ:', err.stack);
        process.exit(1); // সংযোগ ব্যর্থ হলে সার্ভার বন্ধ করে দেওয়া ভালো
    });

// --- অ্যাপ ইনিশিয়ালাইজেশন ---
if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN সেট করা নেই! সার্ভার বন্ধ হচ্ছে।");
    process.exit(1);
}
const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json()); // JSON ডেটা পার্স করার জন্য

// Render এর জন্য Webhook URL তৈরি
const WEBHOOK_BASE = process.env.RENDER_EXTERNAL_HOSTNAME ? 
    `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : 
    `http://localhost:${PORT}`; // লোকাল টেস্টিং এর জন্য 
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${WEBHOOK_BASE}${WEBHOOK_PATH}`;


// --- ১. টেলিগ্রাম বট লজিক ---

// ত্রুটি হ্যান্ডেলিং: বট-এর ত্রুটি ধরুন
bot.catch((err, ctx) => {
    console.error(`[Telegraf] ${ctx.updateType} আপডেটে ত্রুটি:`, err);
});

// বট স্টার্ট এবং রেফারেল হ্যান্ডেলিং
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const is_admin = telegramId.toString() === ADMIN_ID;
    
    // রেফারেল কোড বের করা
    const payload = ctx.startPayload; 
    let referrerCode = null;
    if (payload && payload.startsWith('r_')) { // Null/undefined চেক যোগ করা হয়েছে
        referrerCode = payload.substring(2); 
    }
    
    let message = `স্বাগতম ${ctx.from.first_name}! EarnQuick_Official_bot এ অ্যাড দেখে আয় করা শুরু করুন।`;
    
    // ডেটাবেসে ইউজার নিবন্ধন এবং রেফারেল বোনাস লজিক
    try {
        const result = await registerUser(pool, telegramId, ctx.from.username, referrerCode); // Pool পাস করা
        if (result.isNew && result.bonus && result.referrerId) {
            message += `\n🎁 অভিনন্দন! আপনি রেফারেলের মাধ্যমে এসেছেন।`;
            // নিশ্চিত করুন যে রেফারারকে মেসেজ পাঠানো হচ্ছে
            ctx.telegram.sendMessage(result.referrerId, `🎉 অভিনন্দন! আপনার রেফার করা নতুন ইউজার যুক্ত হয়েছে। আপনি ২৫০ পয়েন্ট পেয়েছেন।`);
        }
    } catch (error) {
        console.error("ইউজার রেজিস্ট্রেশন ত্রুটি:", error);
    }

    // কিবোর্ড বাটন তৈরি
    const adminButton = is_admin ? [{ text: '👑 অ্যাডমিন প্যানেল', web_app: { url: MINI_APP_URL + '/admin.html' } }] : [];
    
    ctx.reply(message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '💸 অ্যাড দেখুন ও ইনকাম করুন', web_app: { url: MINI_APP_URL } }],
                [{ text: '🔗 রেফার করুন', callback_data: 'show_referral' }],
                ...adminButton
            ]
        }
    });
});

// রেফারেল লজিক দেখানোর জন্য অ্যাকশন
bot.on('callback_query', async (ctx) => {
    if (ctx.callbackQuery.data === 'show_referral') {
        const user = await pool.query('SELECT referral_code FROM users WHERE telegram_id = $1', [ctx.from.id]);
        
        if (user.rows.length === 0) {
            return ctx.editMessageText('আপনার ইউজার ডেটা খুঁজে পাওয়া যায়নি। /start লিখে আবার চেষ্টা করুন।');
        }
        
        const refCode = user.rows[0].referral_code;
        // সংশোধিত: বটের ইউজারনেম নিশ্চিত করার জন্য try-catch বা BOT_USERNAME ব্যবহার করা হয়েছে
        const botUsername = BOT_USERNAME || (await bot.telegram.getMe()).username; 
        const referralLink = `https://t.me/${botUsername}?start=r_${refCode}`;
        
        ctx.editMessageText(`আপনার রেফারেল লিঙ্ক: \n${referralLink}\n\nপ্রতি রেফারে আপনি ২৫০ পয়েন্ট পাবেন।`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'ক্লিক করে কপি করুন', url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}` }]
                ]
            }
        });
    }
});

// --- ২. API রুট (Monetag ও Withdraw) ---

// API রাউটার সেটআপ
const apiRouter = express.Router();

// ক. মনিটেগ S2S কলব্যাক API
apiRouter.post('/monetag-callback', async (req, res) => {
    // SECURITY: আপনাকে অবশ্যই এখানে মনিটেগের সিকিউরিটি টোকেন বা হ্যাশ চেক করতে হবে
    // if (req.query.secret !== process.env.MONETAG_SECRET_KEY) { return res.status(403).send('Forbidden'); } 

    const { user_id, transaction_id, status } = req.body; 

    if (!user_id || !transaction_id || status !== 'success') {
        return res.status(400).json({ status: 'error', message: 'ব্যর্থ ট্রানজেকশন বা প্রয়োজনীয় ডেটা অনুপস্থিত' });
    }

    try {
        // ডাবল-ক্রেডিট এড়ানোর জন্য ad_view_logs টেবিলে ইনসার্ট চেষ্টা
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
        console.error('Monetag কলব্যাক ত্রুটি:', error);
        res.status(500).json({ status: 'error', message: 'সার্ভার প্রক্রিয়াকরণ ত্রুটি' });
    }
});


// খ. উইথড্র রিকোয়েস্ট API
apiRouter.post('/withdraw', async (req, res) => {
    // ইনপুট ভ্যালিডেশন
    const { telegramId, points, paymentAddress } = req.body;
    if (!telegramId || !points || !paymentAddress) {
        return res.status(400).json({ success: false, message: "❌ প্রয়োজনীয় ডেটা অনুপস্থিত।" });
    }
    
    try {
        const result = await handleWithdrawRequest(pool, telegramId, points, paymentAddress);
        
        if (result.success) {
            // উইথড্র সফল হলে অ্যাডমিনকে নোটিফাই করুন
            const amountInBdt = pointsToBdt(points);
            const message = `🚨 নতুন উইথড্র রিকোয়েস্ট!\nইউজার ID: ${telegramId}\nপয়েন্ট: ${points}\nটাকা: ${amountInBdt.toFixed(2)} BDT\nপেমেন্ট অ্যাড্রেস: ${paymentAddress}`;
            bot.telegram.sendMessage(ADMIN_ID, message);
            
            return res.status(200).json(result);
        } else {
            return res.status(400).json(result);
        }
    } catch (error) {
        console.error("উইথড্র API ত্রুটি:", error);
        return res.status(500).json({ success: false, message: "❌ একটি অভ্যন্তরীণ ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।" });
    }
});

// সমস্ত API রুট যুক্ত করা
app.use('/api', apiRouter);

// --- ৩. সার্ভার লিসেনিং এবং ওয়েবহুক সেটআপ ---

// রুট গেট রিকোয়েস্টের জন্য একটি সাধারণ সাড়া (Render চেক করার জন্য)
app.get('/', (req, res) => {
    res.send('EarnQuick_Official_bot সার্ভার চালু আছে।');
});

// টেলিগ্রাম ওয়েবহুক সেট করা
// bot.telegram.setWebhook() শুধুমাত্র একবার সেট করা উচিত, সার্ভার স্টার্ট হওয়ার পর
bot.telegram.setWebhook(WEBHOOK_URL)
    .then(() => console.log(`✅ টেলিগ্রাম ওয়েবহুক সেট হয়েছে: ${WEBHOOK_URL}`))
    .catch((err) => console.error("❌ ওয়েবহুক সেটআপ ত্রুটি:", err));

app.use(bot.webhookCallback(WEBHOOK_PATH));


app.listen(PORT, async () => {
    console.log(`🚀 সার্ভার চালু হয়েছে পোর্ট ${PORT} এ`);
    // নিশ্চিত ইউজারনেম প্রিন্ট করার জন্য
    try {
        const me = await bot.telegram.getMe();
        bot.options.username = me.username; // bot.options.username সেট করা হলো
        console.log(`বট ইউজারনেম: @${me.username}`); 
    } catch (e) {
        console.warn("বটের ইউজারনেম পেতে ব্যর্থ।");
    }
});

// --- *গুরুত্বপূর্ণ লজিক ফাংশন* ---

// পয়েন্ট কনভার্সন ফাংশন
function pointsToBdt(points) {
    return (points / 10000) * 40;
}

// ইউজার রেজিস্ট্রেশন এবং রেফারেল বোনাস লজিক
async function registerUser(pool, telegramId, username, referrerCode) { // pool ইনপুট হিসেবে নেওয়া হলো
    const newReferralCode = 'r_' + telegramId; 
    let referrerId = null;
    let bonus = false;
    let isNewUser = false;

    // ইউজার কি ইতিমধ্যেই আছে? চেক করুন
    const existingUser = await pool.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [telegramId]);
    if (existingUser.rows.length > 0) {
        return { isNew: false };
    }
    
    isNewUser = true;

    // রেফারার চেক এবং বোনাস প্রদান
    if (referrerCode) {
        const referrer = await pool.query('SELECT telegram_id FROM users WHERE referral_code = $1', [referrerCode]);
        if (referrer.rows.length) {
            referrerId = referrer.rows[0].telegram_id;
            // রেফারারকে পয়েন্ট দেওয়া
            await pool.query('UPDATE users SET total_points = total_points + 250 WHERE telegram_id = $1', [referrerId]);
            bonus = true;
        }
    }

    try {
        await pool.query(
            'INSERT INTO users (telegram_id, username, total_points, referred_by_id, referral_code) VALUES ($1, $2, $3, $4, $5)',
            [telegramId, username, 0, referrerId, newReferralCode]
        );
        return { isNew: isNewUser, referrerId: referrerId, bonus: bonus };
    } catch (e) {
        // যদি ডাটাবেসে অন্য কোনো ত্রুটি হয়
        console.error("ডাটাবেস INSERT ত্রুটি:", e);
        return { isNew: false };
    }
}

// উইথড্র রিকোয়েস্ট হ্যান্ডেলিং ফাংশন (আগের লজিক অপরিবর্তিত)
async function handleWithdrawRequest(pool, telegramId, requestedPoints, paymentAddress) {
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
            [telegramId, requestedPoints, amountInBdt, paymentAddress]
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
        return { success: false, message: "❌ একটি অভ্যন্তরীণ ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।" };
    } finally {
        client.release();
    }
}
