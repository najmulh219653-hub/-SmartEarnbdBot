// Express সার্ভার এবং ডাটাবেস সংযোগের জন্য
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db'); // আমাদের ডাটাবেস মডিউল

const app = express();
const PORT = process.env.PORT || 3000;

// মিডলওয়্যার সেটআপ
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname))); // স্ট্যাটিক ফাইল পরিবেশনের জন্য

// সার্ভার শুরু করার আগে ডাটাবেস সেটআপ নিশ্চিত করা
db.setupDatabase().then(() => {
    // ডাটাবেস সেটআপ সফল হলে সার্ভার শুরু করা হবে
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to start server due to database setup error:', err);
});


// =======================================================
// API Endpoints
// =======================================================

// A. ইউজার ডেটা লোড করার API
// এই API কল করে ইউজার তার পয়েন্ট এবং অন্যান্য তথ্য লোড করবে।
// Fix: এখানে ভুল কলাম বা কোয়েরি সমস্যার সমাধান করা হয়েছে।
app.get('/api/user_data', async (req, res) => {
    // সাধারণত Telegram ID query parameter (যেমন ?id=123456) থেকে আসবে
    const telegramId = req.query.id; 

    if (!telegramId) {
        // যদি Telegram ID না থাকে, তবে frontend-কে জানাতে হবে
        console.error('Missing Telegram ID in request.');
        return res.status(400).json({ success: false, message: 'Telegram ID is required.' });
    }

    try {
        // 1. ইউজার ডেটা আনা
        const userResult = await db.query(
            `SELECT 
                u.telegram_id, 
                u.username, 
                u.total_points, 
                u.referrer_id
             FROM users u
             WHERE u.telegram_id = $1`, 
            [telegramId]
        );

        if (userResult.rows.length === 0) {
            // যদি ইউজার না থাকে, তবে তাকে রেজিস্টার করতে হবে (নতুন ইউজার)
            console.log(`User ${telegramId} not found. Registering.`);
            await db.query(
                `INSERT INTO users (telegram_id, username, total_points) 
                 VALUES ($1, $2, 0)
                 ON CONFLICT (telegram_id) DO NOTHING`,
                [telegramId, 'NewUser_' + telegramId] // একটি ডিফল্ট নাম ব্যবহার করা হলো
            );
            
            // ডেটা আবার নিয়ে আসা
            const newUserResult = await db.query(
                `SELECT telegram_id, username, total_points, referrer_id FROM users WHERE telegram_id = $1`, 
                [telegramId]
            );

            if (newUserResult.rows.length > 0) {
                 res.json({ success: true, user: newUserResult.rows[0], isNew: true });
            } else {
                 res.status(500).json({ success: false, message: 'User registration failed.' });
            }

        } else {
            // ইউজার থাকলে ডেটা পাঠানো
            const user = userResult.rows[0];
            
            // 2. রেফারাল সংখ্যা গণনা করা
            const referralCountResult = await db.query(
                'SELECT COUNT(*) FROM users WHERE referrer_id = $1',
                [telegramId]
            );

            user.referral_count = parseInt(referralCountResult.rows[0].count);

            res.json({ success: true, user });
        }

    } catch (error) {
        console.error('Error fetching user data:', error.stack);
        // ডাটাবেস ত্রুটির ক্ষেত্রে "Server error" পাঠানো
        res.status(500).json({ success: false, message: 'Server error while loading data.' });
    }
});

// B. পয়েন্ট যোগ করার API
// Fix: ad_logs টেবিলে user_telegram_id কলামের নাম ব্যবহার করে ঠিক করা হয়েছে।
app.post('/api/add_points', async (req, res) => {
    const { telegramId, points } = req.body; // telegramId এখন user_telegram_id হিসেবে ব্যবহৃত হবে
    const pointsToAdd = parseInt(points);

    if (!telegramId || isNaN(pointsToAdd) || pointsToAdd <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid input.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN'); // ট্রানজেকশন শুরু

        // 1. user এর total_points আপডেট করা
        const updateQuery = `
            UPDATE users 
            SET total_points = total_points + $1 
            WHERE telegram_id = $2 
            RETURNING total_points`;
            
        const updateResult = await client.query(updateQuery, [pointsToAdd, telegramId]);

        if (updateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // 2. ad_logs টেবিলে লগ যোগ করা
        // Fix: user_telegram_id কলামের নাম ব্যবহার করা হয়েছে
        const logQuery = `
            INSERT INTO ad_logs (user_telegram_id, points_awarded) 
            VALUES ($1, $2)`;
            
        await client.query(logQuery, [telegramId, pointsToAdd]); 

        await client.query('COMMIT'); // ট্রানজেকশন সফলভাবে শেষ করা

        res.json({ 
            success: true, 
            message: 'Points added successfully.',
            newPoints: updateResult.rows[0].total_points
        });
        
    } catch (error) {
        await client.query('ROLLBACK'); // কোনো ত্রুটি হলে ট্রানজেকশন বাতিল করা
        console.error('Error adding points and logging:', error.stack);
        // আপনার স্ক্রিনশটে থাকা "Server error while adding points." মেসেজটি ঠিক করা হলো
        res.status(500).json({ success: false, message: 'Server error while adding points. (Backend Error)' });
    } finally {
        client.release();
    }
});

// API ত্রুটি হ্যান্ডলিং (404 এরর)
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'Blogger_MiniApp_UI.html'));
});
