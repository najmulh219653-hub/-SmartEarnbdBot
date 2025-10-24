// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS (Cross-Origin Resource Sharing) Setup
// Allow requests from your static site and local host for testing
const allowedOrigins = [
    'https://smartearnbdbot-1.onrender.com', // Your Mini App Frontend URL
    'http://localhost:8000', 
    'http://127.0.0.1:5500' 
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', true);
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// --- MongoDB Connection ---
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log('MongoDB connected successfully.');
}).catch(err => {
    console.error('MongoDB connection error:', err.message);
    // Exiting the process to force Render restart if DB connection fails
    process.exit(1); 
});

// --- MongoDB Schema ---
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: String,
    earned_points: { type: Number, default: 0 },
    referral_count: { type: Number, default: 0 },
    referred_by: String,
    is_admin: { type: Boolean, default: false },
    last_ad_time: { type: Date, default: new Date(0) }
}, { timestamps: true });

const WithdrawalSchema = new mongoose.Schema({
    user_id: { type: String, required: true },
    points: { type: Number, required: true },
    method: { type: String, required: true },
    account: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Completed', 'Cancelled'], default: 'Pending' },
    processed_by: String 
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

// --- Telegram Bot Setup ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.ADMIN_ID || '8145444675';
const BOT_USERNAME = 'EarnQuick_Official_bot'; 

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Mini App URL (Set in BotFather)
const MINI_APP_URL = 'https://smartearnbdbot-1.onrender.com/'; 

// Handle /start command
bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const refererId = match[1]; 
    
    // Register the user with referral logic
    await registerOrCheckUser(userId, msg.from.username, refererId);
    
    // Send message with the Mini App button
    bot.sendMessage(chatId, `স্বাগতম! Mini App চালু করতে নিচের বাটনে ক্লিক করুন। 🚀`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '⭐ Open Mini App', web_app: { url: MINI_APP_URL + '?start=' + userId } }]
            ]
        }
    });
});

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    await registerOrCheckUser(userId, msg.from.username, null);
    
    bot.sendMessage(chatId, `স্বাগতম! Mini App চালু করতে নিচের বাটনে ক্লিক করুন। 🚀`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '⭐ Open Mini App', web_app: { url: MINI_APP_URL } }]
            ]
        }
    });
});

// Bot error handling
bot.on('polling_error', (error) => {
    console.error("Polling Error:", error);
});


// --- User Registration & Check (For /start command) ---
async function registerOrCheckUser(userId, username, refererId) {
    let message = 'Welcome!';
    try {
        let user = await User.findOne({ userId });
        
        if (!user) {
            // New User Registration
            user = new User({ 
                userId, 
                username, 
                is_admin: userId === TELEGRAM_ADMIN_ID,
                referred_by: refererId || null
            });
            await user.save();
            message = 'New user registered.';

            // Referral Logic
            if (refererId && refererId !== userId) {
                const referrer = await User.findOne({ userId: refererId });
                if (referrer) {
                    referrer.earned_points += 250; // 250 points bonus
                    referrer.referral_count += 1;
                    await referrer.save();
                    message = `Referral bonus of 250 points added to referrer ${refererId}.`;
                }
            }
        }
    } catch (error) {
        console.error('Registration/Check Error:', error);
        message = 'Server error during registration.';
    }
    return { user, message };
}


// --- API Routes for Mini App ---

// 1. Register or Check User (Initial Load)
app.post('/api/register_or_check', async (req, res) => {
    const { userId, refererId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    const { user, message } = await registerOrCheckUser(userId, null, refererId);
    if (!user) return res.status(500).json({ error: 'Could not process user data' });

    res.json({
        success: true,
        earned_points: user.earned_points,
        referral_count: user.referral_count,
        message: message 
    });
});

// 2. Add Points (When user watches an ad)
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body;
    if (!userId || !points) return res.status(400).json({ error: 'User ID and points are required' });

    try {
        const user = await User.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Basic Rate Limit Check (Optional, better to handle on client-side too)
        // For simplicity, skip rate limiting here. 

        user.earned_points += points;
        await user.save();

        res.json({ success: true, new_points: user.earned_points });

    } catch (error) {
        console.error('Add Points Error:', error);
        res.status(500).json({ error: 'Failed to update points' });
    }
});

// 3. Submit Withdrawal Request
app.post('/api/withdraw', async (req, res) => {
    const { userId, method, account, points } = req.body;

    if (!userId || !method || !account || !points || points < 10000) {
        return res.status(400).json({ error: 'Invalid request data or points are too low (min 10000)' });
    }

    try {
        const user = await User.findOne({ userId });
        if (!user || user.earned_points < points) {
            return res.status(400).json({ error: 'Insufficient balance or user not found' });
        }

        // Create withdrawal record
        const withdrawal = new Withdrawal({ user_id: userId, points, method, account });
        await withdrawal.save();

        // Deduct points from user's balance
        user.earned_points -= points;
        await user.save();

        res.json({ success: true, message: 'Withdrawal request submitted' });

    } catch (error) {
        console.error('Withdrawal Submission Error:', error);
        res.status(500).json({ error: 'Failed to submit withdrawal request' });
    }
});

// --- Admin API Routes ---

// 4. Admin Stats
app.get('/api/admin/stats', async (req, res) => {
    // Basic authorization: Check if the request is from a known source or use a secret token later
    try {
        const total_users = await User.countDocuments();
        const total_points = (await User.aggregate([{ $group: { _id: null, total: { $sum: "$earned_points" } } }]))[0]?.total || 0;
        const pending_withdrawals = await Withdrawal.countDocuments({ status: 'Pending' });

        res.json({ total_users, total_points, pending_withdrawals });
    } catch (error) {
        console.error('Admin Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});

// 5. Admin Get Withdrawals by Status
app.get('/api/admin/withdrawals', async (req, res) => {
    const status = req.query.status || 'Pending'; // Default to Pending
    try {
        const withdrawals = await Withdrawal.find({ status }).sort({ createdAt: -1 });
        res.json(withdrawals);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch withdrawals' });
    }
});

// 6. Admin Update Withdrawal Status
app.post('/api/admin/update_withdrawal', async (req, res) => {
    const { requestId, status, adminId } = req.body;
    
    if (adminId !== TELEGRAM_ADMIN_ID) {
        return res.status(403).json({ error: 'Permission Denied' }); 
    }

    try {
        const withdrawal = await Withdrawal.findByIdAndUpdate(requestId, 
            { status: status, processed_by: adminId }, 
            { new: true }
        );

        if (status === 'Cancelled' && withdrawal) {
            // Refund the points if cancelled
            const user = await User.findOne({ userId: withdrawal.user_id });
            if (user) {
                user.earned_points += withdrawal.points;
                await user.save();
                bot.sendMessage(withdrawal.user_id, `❌ আপনার ${withdrawal.points} পয়েন্টের উত্তোলন রিকোয়েস্টটি ক্যানসেল করা হয়েছে এবং পয়েন্ট ফেরত দেওয়া হয়েছে।`);
            }
        }
        
        if (status === 'Completed' && withdrawal) {
             bot.sendMessage(withdrawal.user_id, `✅ আপনার ${withdrawal.points} পয়েন্টের উত্তোলন রিকোয়েস্টটি সম্পন্ন হয়েছে! পেমেন্ট করে দেওয়া হয়েছে।`);
        }

        res.json({ success: true, withdrawal });
    } catch (error) {
        console.error('Withdrawal Update Error:', error);
        res.status(500).json({ error: 'Failed to update withdrawal status' });
    }
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
