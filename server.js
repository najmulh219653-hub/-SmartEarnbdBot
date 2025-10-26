// server.js (পরিবর্তিত: রেফার বাটন সরানো হয়েছে)
const express = require('express');
const { Telegraf } = require('telegraf');
const apiRouter = require('./api');
const { registerUser } = require('./logic');
const { pool } = require('./db'); 
require('dotenv').config();

// --- কনফিগারেশন ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID; // আপনার আইডি 8145444675 নিশ্চিত করুন
const MINI_APP_URL = process.env.MINI_APP_URL; 
const BOT_USERNAME = 'EarnQuick_Official_bot'; 

// --- অ্যাপ ইনিশিয়ালাইজেশন ---
const app = express();
const bot = new Telegraf(BOT_TOKEN, { username: BOT_USERNAME }); 

app.use(express.json()); 

// **CORS সমাধান:**
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
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
    
    // রেফার বাটন সরানো হয়েছে। শুধু মিনি অ্যাপ বাটন আছে।
    ctx.reply(message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '💸 অ্যাড দেখুন ও ইনকাম করুন', web_app: { url: MINI_APP_URL } }],
                ...adminButton 
            ]
        }
    });
});

// রেফার বাটন মিনি অ্যাপে চলে যাওয়ায় callback_query হ্যান্ডলারটি আর প্রয়োজন নেই, তাই সেটি সরানো হলো।


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
