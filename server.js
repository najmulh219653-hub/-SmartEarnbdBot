// server.js (চূড়ান্ত সংস্করণ)
const express = require('express');
const { Telegraf } = require('telegraf');
const apiRouter = require('./api');
// registerUser ফাংশনটি logic.js থেকে আসছে
const { registerUser } = require('./logic'); 
const { pool } = require('./db'); 
require('dotenv').config();

// --- কনফিগারেশন ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

// ***গুরুত্বপূর্ণ: আপনার অ্যাডমিন আইডি***
const ADMIN_ID = process.env.ADMIN_ID; // আপনার আইডি: 8145444675 
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

// ***API রাউটার লোড করা (api.js থেকে)***
app.use('/api', apiRouter); 

// --- টেলিগ্রাম বট লজিক ---
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    // অ্যাডমিন আইডি চেক করা
    const is_admin = telegramId.toString() === ADMIN_ID; 
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
            
            // ডেটাবেস ফিক্স অনুসারে: এখন আমরা রেফারকারীর telegram_id ব্যবহার করছি
            // ধরে নিচ্ছি logic.js referrerId এর পরিবর্তে referrerTelegramId পাঠাচ্ছে
            if(user.referrerTelegramId) { // <<-- এখানে সঠিক Property ব্যবহার করা হয়েছে
                 // রেফারকারীকে পয়েন্ট পাওয়ার বার্তা পাঠানো
                 bot.telegram.sendMessage(user.referrerTelegramId, `🎉 অভিনন্দন! আপনার রেফার করা নতুন ইউজার যুক্ত হয়েছে। আপনি ২৫০ পয়েন্ট পেয়েছেন।`);
            }
        }
    } catch (error) {
        console.error("ইউজার রেজিস্ট্রেশন ত্রুটি:", error);
    }

    // অ্যাডমিন বাটন তৈরি (যদি ইউজার অ্যাডমিন হয়)
    const adminButton = is_admin ? [{ text: '👑 অ্যাডমিন প্যানেল', web_app: { url: MINI_APP_URL + 'admin.html' } }] : [];
    
    // মিনি অ্যাপ এবং অ্যাডমিন বাটন প্রদর্শন
    ctx.reply(message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '💸 অ্যাড দেখুন ও ইনকাম করুন', web_app: { url: MINI_APP_URL } }],
                ...adminButton // অ্যাডমিন বাটন এখানে যোগ হবে
            ]
        }
    });
    
    // **অ্যাডমিনকে নিশ্চিতকরণ বার্তা**
    if (is_admin) {
        ctx.reply(`[ADMIN MODE]: আপনার ID (${telegramId}) সফলভাবে ADMIN_ID (${ADMIN_ID}) হিসাবে লোড হয়েছে।`);
    } 
});

// --- সার্ভার লিসেনিং ও ওয়েবহুক সেটআপ ---
const RENDER_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || "smartearnbdbot.onrender.com"; 
const WEBHOOK_URL = `https://${RENDER_HOSTNAME}/bot${BOT_TOKEN}`;

// ওয়েবহুক সেট করা
bot.telegram.setWebhook(WEBHOOK_URL).then(() => {
    console.log(`🤖 বট ওয়েবহুক সেট করা হয়েছে: ${WEBHOOK_URL}`);
});

// টেলিগ্রাম ওয়েবহুক কলব্যাক হ্যান্ডেল করা
app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));

app.listen(PORT, () => {
    console.log(`🚀 সার্ভার চালু হয়েছে পোর্ট ${PORT} এ`);
});
