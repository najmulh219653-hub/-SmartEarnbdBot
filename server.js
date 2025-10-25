// server.js - প্রধান Express সার্ভার এবং টেলিগ্রাম ওয়েবহুক হ্যান্ডেল করে।
const express = require('express');
const bodyParser = require('body-parser');
// node-telegram-bot-api মডিউল লোড করা
const TelegramBot = require('node-telegram-bot-api'); 
const path = require('path');
require('dotenv').config(); // .env ফাইল লোড করার জন্য

// --- ১. কনফিগারেশন এবং পরিবেশ ভেরিয়েবল ---
// !!! আপনার আসল টেলিগ্রাম বট টোকেন দিয়ে পরিবর্তন করুন !!!
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE'; 
// !!! আপনার Render সার্ভিসের সম্পূর্ণ URL দিয়ে পরিবর্তন করুন !!!
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'YOUR_RENDER_EXTERNAL_URL'; 
// !!! আপনার কাস্টম সিক্রেট কী দিয়ে পরিবর্তন করুন !!!
const MONETAG_SECRET_KEY = process.env.MONETAG_SECRET_KEY || 'MyEarnQuickSecretKey123'; 
const PORT = process.env.PORT || 10000;

if (BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE' || RENDER_EXTERNAL_URL === 'YOUR_RENDER_EXTERNAL_URL') {
    console.error("গুরুত্বপূর্ণ কনফিগারেশন ত্রুটি: BOT_TOKEN এবং RENDER_EXTERNAL_URL সেট করুন।");
    process.exit(1);
}

// --- ২. অ্যাপ ইনিশিয়ালাইজেশন ---

// Webhook মোডে বট ইনিশিয়ালাইজ করা: polling: false
const bot = new TelegramBot(BOT_TOKEN, { polling: false }); 

const app = express();
const db = require('./db');
const apiRouter = require('./api');

// --- ৩. মিডলওয়্যার ---
app.use(bodyParser.json());
// সিক্রেট কী api.js এর জন্য পরিবেশ ভেরিয়েবলে সেট করা
process.env.MONETAG_SECRET_KEY = MONETAG_SECRET_KEY; 

// --- ৪. ডেটাবেস ইনিশিয়ালাইজেশন ---
db.initializeDatabase();

// --- ৫. রুট এবং API ---

// API রাউটস ব্যবহার করা
app.use('/api', apiRouter); 

// স্ট্যাটিক ফাইল পরিবেশন করা (Mini App UI - index.html)
app.use(express.static(path.join(__dirname))); 

// মূল রুট, Mini App UI দেখাবে
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// টেলিগ্রাম ওয়েবহুক হ্যান্ডেলার
app.post('/bot' + BOT_TOKEN, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// --- ৬. বট লজিক ---

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = msg.from.id; // ব্যবহারকারীর ID

    // টেলিগ্রাম মিনি অ্যাপের জন্য বাটন তৈরি করা
    const inlineKeyboard = {
        inline_keyboard: [
            [
                { 
                    text: '💸 আর্নিং অ্যাপ খুলুন', 
                    web_app: { 
                        url: RENDER_EXTERNAL_URL 
                    } 
                }
            ]
        ]
    };

    bot.sendMessage(chatId, 
        `স্বাগতম, *EarnQuick Bot*-এ! আপনার ইউজার আইডি হলো: \`${telegramUserId}\`।\n\nনিচের বাটনটি ক্লিক করে আমাদের ইনস্ট্যান্ট আর্নিং মিনি অ্যাপে প্রবেশ করুন।`, 
        { 
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard 
        }
    );
});

// --- ৭. সার্ভার চালু করা এবং ওয়েবহুক সেট করা ---

app.listen(PORT, async () => {
    console.log(`সার্ভার চালু হয়েছে পোর্টে ${PORT}`);

    const webhookUrl = `${RENDER_EXTERNAL_URL}/bot${BOT_TOKEN}`;
    try {
        // ওয়েবহুক সেট করা: node-telegram-bot-api এর setWebHook() ফাংশন
        await bot.setWebHook(webhookUrl); // 'setWebHook' (W ক্যাপিটাল) ব্যবহার করুন
        console.log(`টেলিগ্রাম ওয়েবহুক সফলভাবে সেট হয়েছে: ${webhookUrl}`);
    } catch (error) {
        console.error("টেলিগ্রাম ওয়েবহুক সেট করতে ব্যর্থ:", error.message);
    }
});
