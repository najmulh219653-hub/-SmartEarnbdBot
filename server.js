// server.js - (CORS সমাধান এবং অ্যাডমিন বাটন লজিক সহ চূড়ান্ত কোড)
const express = require('express');
const { Telegraf } = require('telegraf');
const apiRouter = require('./api');
const { registerUser } = require('./logic');
const { pool } = require('./db'); 
require('dotenv').config();

// --- কনফিগারেশন ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID; // নিশ্চিত করুন যে আপনার সঠিক Telegram ID এখানে সেট করা আছে
const MINI_APP_URL = process.env.MINI_APP_URL; 
const BOT_USERNAME = 'EarnQuick_Official_bot'; // আপনার বটের ইউজারনেম দিন

// --- অ্যাপ ইনিশিয়ালাইজেশন ---
const app = express();
const bot = new Telegraf(BOT_TOKEN, { username: BOT_USERNAME }); 

app.use(express.json()); 

// **CORS সমাধান:** নেটওয়ার্ক ত্রুটি ঠিক করার জন্য
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Preflight (OPTIONS) রিকোয়েস্ট হ্যান্ডেল করা
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use('/api', apiRouter); 

// --- টেলিগ্রাম বট লজিক ---
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const is_admin = telegramId.toString() === ADMIN_ID; // অ্যাডমিন আইডি চেক
    const payload = ctx.startPayload; 
    let referrerCode = null;
    if (payload && payload.startsWith('r_')) {
        referrerCode = payload; 
    }
    
    let message = `স্বাগতম ${ctx.from.first_name}! অ্যাড দেখে আয় করা শুরু করুন।`;
    
    try {
        const user = await registerUser(telegramId, ctx.from.username, referrerCode);
        if (user && user.isNew && user.bonus) {
            message += `\n🎁 অভিনন্দন! আপনি রেফারেলের মাধ্যমে এসেছেন।`;
            if(user.referrerId) {
                 bot.telegram.sendMessage(user.referrerId, `🎉 অভিনন্দন! আপনার রেফার করা নতুন ইউজার যুক্ত হয়েছে। আপনি ২৫০ পয়েন্ট পেয়েছেন।`);
            }
        }
    } catch (error) {
        console.error("ইউজার রেজিস্ট্রেশন ত্রুটি:", error);
    }

    const adminButton = is_admin ? [{ text: '👑 অ্যাডমিন প্যানেল', web_app: { url: MINI_APP_URL + 'admin.html' } }] : [];
    
    // রেফার বাটন ও Mini App বাটন
    ctx.reply(message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '💸 অ্যাড দেখুন ও ইনকাম করুন', web_app: { url: MINI_APP_URL } }],
                [{ text: '🔗 রেফার করুন', callback_data: 'show_referral' }],
                ...adminButton // অ্যাডমিন বাটন যুক্ত করা হলো
            ]
        }
    });
});

bot.on('callback_query', async (ctx) => {
    if (ctx.callbackQuery.data === 'show_referral') {
        if (!pool) return ctx.answerCbQuery("সার্ভার এখনও প্রস্তুত নয়।");

        const result = await pool.query('SELECT referral_code FROM users WHERE telegram_id = $1', [ctx.from.id]);
        const refCode = result.rows.length ? result.rows[0].referral_code : `r_${ctx.from.id}`;
        
        const referralLink = `https://t.me/${BOT_USERNAME}?start=${refCode}`;
        
        ctx.editMessageText(`আপনার রেফারেল লিঙ্ক: \n${referralLink}\n\nপ্রতি রেফারে আপনি ২৫০ পয়েন্ট পাবেন।`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔗 কপি করুন ও শেয়ার করুন', url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}` }]
                ]
            }
        });
    }
});


// --- সার্ভার লিসেনিং ও ওয়েবহুক সেটআপ ---
const RENDER_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || "smartearnbdbot.onrender.com"; 
const WEBHOOK_URL = `https://${RENDER_HOSTNAME}/bot${BOT_TOKEN}`;

bot.telegram.setWebhook(WEBHOOK_URL).then(() => {
    console.log(`🤖 বট ওয়েবহুক সেট করা হয়েছে: ${WEBHOOK_URL}`);
});

app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));

app.listen(PORT, () => {
    console.log(`🚀 সার্ভার চালু হয়েছে পোর্ট ${PORT} এ`);
});
