// server.js (চূড়ান্ত কোড)
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 10000; 

app.set('trust proxy', true); 
app.use(bodyParser.json());

// index.html এবং অন্যান্য স্ট্যাটিক ফাইল main directory (__dirname) থেকে লোড করবে
app.use(express.static(path.join(__dirname))); 

// সার্ভার স্টার্ট করুন
db.setupDatabase().then(() => {
    console.log('Database setup complete and successful.');
}).catch(err => {
    console.error('Warning: Database setup failed. Server will start but API calls may fail:', err);
});

app.listen(PORT, () => {
    console.log(`Server is running successfully on port ${PORT}`);
});


// =======================================================
// API Endpoints
// =======================================================

// 1. ইউজার ডেটা লোড এবং রেজিস্ট্রেশন (রেফারেল সহ)
app.get('/api/user_data', async (req, res) => {
    const telegramId = req.query.id; 
    const username = req.query.username || 'GuestUser'; 
    const referrerIdFromUrl = req.query.start; 

    if (!telegramId) {
        return res.status(400).json({ success: false, message: 'Telegram ID is required.' });
    }

    const client = await db.pool.connect();
    try {
        // ... (API লজিক - রেজিস্ট্রেশন, রেফারেল, এবং ডেটা লোড) ...
        await client.query('BEGIN');
        
        // বিদ্যমান ইউজার চেক 
        const existingUserResult = await client.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
        
        let referralRewardGiven = false;

        if (existingUserResult.rows.length === 0) {
            let referrerId = null;
            let referrerExists = false;

            if (referrerIdFromUrl && referrerIdFromUrl !== telegramId) {
                const referrerCheck = await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [referrerIdFromUrl]);
                if (referrerCheck.rows.length > 0) {
                    referrerId = referrerIdFromUrl;
                    referrerExists = true;
                }
            }
            
            await client.query(
                `INSERT INTO users (telegram_id, username, referrer_id) 
                 VALUES ($1, $2, $3)`,
                [telegramId, username, referrerId]
            );

            // রেফারেল বোনাস প্রদান
            if (referrerExists) {
                const configResult = await client.query('SELECT config_key, config_value FROM ads_config WHERE config_key IN ($1, $2)', ['referral_bonus_new_user', 'referral_bonus_referrer']);
                const config = configResult.rows.reduce((acc, row) => {
                    acc[row.config_key] = parseInt(row.config_value) || 0;
                    return acc;
                }, {});

                const newUserBonus = config.referral_bonus_new_user || 50;
                const referrerBonus = config.referral_bonus_referrer || 100;
                
                await client.query('UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2', [newUserBonus, telegramId]);
                await client.query('UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2', [referrerBonus, referrerId]);
                
                referralRewardGiven = true;
            }
        } else {
             // বিদ্যমান ব্যবহারকারীর জন্য ইউজারনেম আপডেট করা
             await client.query('UPDATE users SET username = $1 WHERE telegram_id = $2', [username, telegramId]);
        }

        // চূড়ান্ত ইউজার ডেটা লোড
        const userResult = await client.query(
            'SELECT telegram_id, username, total_points, referrer_id, is_admin FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        const user = userResult.rows[0];

        const referralCountResult = await client.query(
            'SELECT COUNT(*) FROM users WHERE referrer_id = $1',
            [telegramId]
        );

        user.referral_count = parseInt(referralCountResult.rows[0].count) || 0;

        await client.query('COMMIT');
        
        res.json({ success: true, user, referralRewardGiven });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error fetching user data/registration:', error.stack);
        // 🛑 ডেটাবেস ত্রুটি হলে এটি ফ্রন্টএন্ডে যাবে এবং 'অফলাইন' দেখাবে
        res.status(500).json({ success: false, message: 'Server error during user data load.' });
    } finally {
        client.release();
    }
});


// 2. পয়েন্ট যোগ করার API
app.post('/api/add_points', async (req, res) => {
    const { telegramId, points } = req.body; 
    const pointsToAdd = parseInt(points);
    // ... (Add Points লজিক) ...
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN'); 
        
        const updateQuery = `
            UPDATE users 
            SET total_points = total_points + $1 
            WHERE telegram_id = $2 
            RETURNING total_points`;
            
        const updateResult = await client.query(updateQuery, [pointsToAdd, telegramId]);
        
        const logQuery = `
            INSERT INTO ad_logs (user_telegram_id, points_awarded) 
            VALUES ($1, $2)`;
            
        await client.query(logQuery, [telegramId, pointsToAdd]); 

        await client.query('COMMIT'); 

        res.json({ success: true, newPoints: updateResult.rows[0].total_points });
        
    } catch (error) {
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, message: 'Server error while adding points.' });
    } finally {
        client.release();
    }
});

// 3. উইথড্র রিকোয়েস্ট করার API
app.post('/api/request_withdraw', async (req, res) => {
    // ... (Withdraw Request লজিক) ...
    const { telegramId, points, account } = req.body;
    const pointsRequested = parseInt(points);
    const MIN_WITHDRAW_POINTS = 5000; 
    
    // ... (Error checks) ...
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const userCheckResult = await client.query(
            'SELECT total_points FROM users WHERE telegram_id = $1 FOR UPDATE', 
            [telegramId]
        );
        
        // ... (Point check) ...
        const updatePointsResult = await client.query(
            'UPDATE users SET total_points = total_points - $1 WHERE telegram_id = $2 RETURNING total_points',
            [pointsRequested, telegramId]
        );

        const logWithdrawalQuery = `
            INSERT INTO withdraw_requests (user_telegram_id, points_requested, payment_details)
            VALUES ($1, $2, $3)`;
            
        await client.query(logWithdrawalQuery, [telegramId, pointsRequested, JSON.stringify({ account })]);

        await client.query('COMMIT');

        res.json({ success: true, newPoints: updatePointsResult.rows[0].total_points });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: 'Server error while processing withdrawal.' });
    } finally {
        client.release();
    }
});


// রুট এবং 404 হ্যান্ডলার
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
        next(); 
    } else {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});
