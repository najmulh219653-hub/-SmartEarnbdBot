const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(bodyParser.json());

// 🟢 চূড়ান্ত ফিক্স: রুট ডিরেক্টরি থেকে index.html সার্ভ করার জন্য
app.use(express.static(path.join(__dirname)));

// API Route for fetching user data and handling referrals
app.get('/api/user_data', async (req, res) => {
    const { id, username, start } = req.query;

    if (!id) {
        return res.status(400).json({ success: false, message: 'Telegram ID is required.' });
    }

    try {
        const user = await db.findOrCreateUser(id, username, start);
        const referralCount = await db.getReferralCount(id);

        // Check if the user is the Admin (using environment variable ADMIN_TELEGRAM_ID)
        const isAdmin = (process.env.ADMIN_TELEGRAM_ID === id.toString());

        res.json({
            success: true,
            user: {
                ...user,
                referral_count: referralCount,
                is_admin: isAdmin
            }
        });

    } catch (error) {
        console.error('API Error: get /api/user_data:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching user data.' });
    }
});

// API Route for adding points (after viewing an ad)
app.post('/api/add_points', async (req, res) => {
    const { telegramId, points } = req.body;

    if (!telegramId || typeof points !== 'number' || points <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid input.' });
    }

    try {
        await db.addPoints(telegramId, points);
        // Logging the ad view action (optional but good practice)
        await db.logAdView(telegramId, points); 

        res.json({ success: true, message: `${points} points added.` });
    } catch (error) {
        console.error('API Error: post /api/add_points:', error);
        res.status(500).json({ success: false, message: 'Server error while adding points.' });
    }
});

// API Route for submitting a withdraw request
app.post('/api/request_withdraw', async (req, res) => {
    const { telegramId, points, account } = req.body;

    if (!telegramId || typeof points !== 'number' || points <= 0 || !account) {
        return res.status(400).json({ success: false, message: 'Invalid input for withdrawal.' });
    }

    try {
        const result = await db.requestWithdraw(telegramId, points, account);
        if (result.success) {
            res.json({ success: true, message: result.message });
        } else {
            res.status(400).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('API Error: post /api/request_withdraw:', error);
        res.status(500).json({ success: false, message: 'Server error while processing withdrawal request.' });
    }
});

// Serve index.html as the default route for the Mini App
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server ONLY after the database is set up
db.setupDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server is running successfully on port ${PORT}`);
        });
    })
    .catch(err => {
        // 🛑 চূড়ান্ত ফিক্স: ডাটাবেস সেটআপ ব্যর্থ হলে CRITICAL error দেখানো
        console.error('CRITICAL: Database setup failed. Server will start but API calls will fail:', err);
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT} with CRITICAL DB error.`);
        });
    });
