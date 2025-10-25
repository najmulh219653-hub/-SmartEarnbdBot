// server.js
const express = require('express');
const { Telegraf } = require('telegraf');
const { pool } = require('./db'); // db.js থেকে pool আমদানি করা হয়েছে
require('dotenv').config(); 

// মডিউলগুলি ইম্পোর্ট করা
const { registerUser, MIN_WITHDRAW_POINTS, MAX_WITHDRAW_POINTS } = require('./logic');
const apiRouter = require('./api'); 

// --- কনফিগারেশন এবং এনভায়রনমেন্ট ভেরিয়েবল ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? process.env.ADMIN_ID.toString() : '8145444675'; 
const MINI_APP_URL = process.env.MINI_APP_URL || "আপনার_Blogger_বা_ফ্রন্টএন্ড_URL"; 
const BOT_USERNAME = process.env.BOT_USERNAME; 

if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN সেট করা নেই! সার্ভার বন্ধ হচ্ছে।");
    process.exit(1);
}
const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json()); 

// Render এর জন্য Webhook URL তৈরি
const WEBHOOK_BASE = process.env.RENDER_EXTERNAL_HOSTNAME ? 
    `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : 
    `http://localhost:${PORT}`; 
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `${WEBHOOK_BASE}${WEBHOOK_PATH}`;


// --- ১. টেলিগ্রাম বট লজিক ---

bot.catch((err, ctx) => {
    console.error(`[Telegraf] ${ctx.updateType} আপডেটে ত্রুটি:`, err);
    ctx.reply('দুঃখিত, একটি অভ্যন্তরীণ ত্রুটি হয়েছে।');
});

// বট স্টার্ট এবং রেফারেল হ্যান্ডেলিং
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const is_admin = telegramId.toString() === ADMIN_ID;
    
    const payload = ctx.startPayload; 
    let referrerCode = null;
    if (payload && payload.startsWith('r_')) { 
        referrerCode = payload.substring(2); 
    }
    
    let message = `স্বাগতম ${ctx.from.first_name}! EarnQuick_Official_bot এ অ্যাড দেখে আয় করা শুরু করুন।`;
    
    try {
        const result = await registerUser(telegramId, ctx.from.username, referrerCode); 
        
        if (result.isNew) {
            message += `\n🎉 অভিনন্দন! আপনার অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে।`;
            if (result.bonus && result.referrerId) {
                message += `\n🎁 আপনি রেফারেলের মাধ্যমে এসেছেন।`;
                ctx.telegram.sendMessage(result.referrerId, `🎉 অভিনন্দন! আপনার রেফার করা নতুন ইউজার যুক্ত হয়েছে। আপনি ২৫০ পয়েন্ট পেয়েছেন।`);
            }
        } else {
             message += `\nআপনার অ্যাকাউন্ট ইতিমধ্যে তৈরি আছে।`;
        }
    } catch (error) {
        console.error("ইউজার রেজিস্ট্রেশন ত্রুটি:", error);
    }

    const adminButton = is_admin ? [{ text: '👑 অ্যাডমিন প্যানেল (Coming Soon)', web_app: { url: MINI_APP_URL + '/admin.html' } }] : [];
    
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
        try {
            const user = await pool.query('SELECT referral_code FROM users WHERE telegram_id = $1', [ctx.from.id]);
            
            if (user.rows.length === 0) {
                return ctx.editMessageText('আপনার ইউজার ডেটা খুঁজে পাওয়া যায়নি। /start লিখে আবার চেষ্টা করুন।');
            }
            
            const refCode = user.rows[0].referral_code;
            
            const botUsername = bot.options.username || BOT_USERNAME || (await bot.telegram.getMe()).username; 
            const referralLink = `https://t.me/${botUsername}?start=r_${refCode}`;
            
            ctx.editMessageText(`আপনার রেফারেল লিঙ্ক: \n\`${referralLink}\`\n\nপ্রতি রেফারে আপনি ২৫০ পয়েন্ট পাবেন।`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'ক্লিক করে কপি করুন', url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}` }]
                    ]
                }
            });
        } catch (e) {
            console.error("রেফারেল লজিক ত্রুটি:", e);
            ctx.reply('রেফারেল ডেটা আনতে ব্যর্থ।');
        }
    }
});


// --- ২. API রুট যুক্ত করা ---
// bot এবং adminId কে api.js এ পাঠানো হলো
app.use('/api', apiRouter(bot, ADMIN_ID));


// --- ৩. সার্ভার লিসেনিং ---

app.get('/', (req, res) => {
    res.send('EarnQuick_Official_bot সার্ভার চালু আছে।');
});

bot.telegram.setWebhook(WEBHOOK_URL)
    .then(() => console.log(`✅ টেলিগ্রাম ওয়েবহুক সেট হয়েছে: ${WEBHOOK_URL}`))
    .catch((err) => console.error("❌ ওয়েবহুক সেটআপ ত্রুটি:", err));

app.use(bot.webhookCallback(WEBHOOK_PATH));


app.listen(PORT, async () => {
    console.log(`🚀 সার্ভার চালু হয়েছে পোর্ট ${PORT} এ`);
    try {
        const me = await bot.telegram.getMe();
        bot.options.username = me.username; 
        console.log(`বট ইউজারনেম: @${me.username}`); 
    } catch (e) {
        console.warn("বটের ইউজারনেম পেতে ব্যর্থ।");
    }
});
