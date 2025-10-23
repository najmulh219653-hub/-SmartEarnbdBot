// --- index.js (Render Server Code) - Final Fix ---
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors'); 

const app = express();
const port = process.env.PORT || 10000;

// --- কনস্ট্যান্টস ---
const POINTS_PER_AD = 5; 
const REFERRAL_BONUS_POINTS = 250; 
const POINTS_PER_TAKA = 250; // ২৫০ পয়েন্টে ১ টাকা

// মিডলওয়্যার
app.use(cors({
    origin: [
        'https://earnquickofficial.netlify.app', 
        'https://earnquickofficial.blogspot.com', 
        'http://localhost:3000'
    ], 
    methods: ['GET', 'POST'],
    credentials: true,
}));
app.use(bodyParser.json());

// PostgreSQL কানেকশন পুল সেটআপ
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// ডেটাবেস কানেকশন টেস্ট
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log("Connected to PostgreSQL database!");
    release();
});

// ---------------------------------------------------------------------
// ★★★ ১. ইউজার রেজিস্ট্রেশন ও রেফারেল চেক করা (/api/register_or_check) ★★★
// এই EndPoint টি মিনি অ্যাপের প্রথম লোড বাটন ক্লিক থেকে কল হবে।
// এটি ইউজারকে ডেটাবেসে যোগ করবে এবং রেফারেল থাকলে বোনাস দেবে।
// ---------------------------------------------------------------------
app.post('/api/register_or_check', async (req, res) => {
    const { userId, refererId } = req.body; 
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // ক. ইউজার ডেটাবেসে আছে কিনা চেক করা (এবং is_referrer_checked কলামটিও)
        const checkQuery = 'SELECT earned_points, referral_count, is_referrer_checked FROM users WHERE telegram_user_id = $1';
        let userResult = await client.query(checkQuery, [userId]);
        
        let userExists = userResult.rows.length > 0;
        
        // খ. যদি নতুন ইউজার হয়, তবে তাকে যোগ করা
        if (!userExists) {
            // নতুন ইউজার যোগ করা হচ্ছে
            await client.query('INSERT INTO users (telegram_user_id) VALUES ($1)', [userId]);
            userResult = await client.query(checkQuery, [userId]); // নতুন করে ডেটা লোড
            userExists = true;
        }

        const isReferrerChecked = userResult.rows.length > 0 ? userResult.rows[0].is_referrer_checked : false;
        
        // গ. রেফারেল প্রসেস: রেফারার থাকলে এবং চেক না করা হলে
        if (refererId && refererId !== userId && !isReferrerChecked) {
            
            // i. রেফারারকে বোনাস পয়েন্ট এবং কাউন্ট যোগ করা
            const bonusTaka = REFERRAL_BONUS_POINTS / POINTS_PER_TAKA; 
            const referrerUpdateQuery = `
                UPDATE users 
                SET earned_points = earned_points + $1, 
                    referral_count = referral_count + 1
                WHERE telegram_user_id = $2
            `;
            await client.query(referrerUpdateQuery, [bonusTaka, refererId]);

            // ii. নতুন ইউজারকে ফ্ল্যাগ করা যে তার রেফারার চেক করা হয়ে গেছে
            const flagQuery = 'UPDATE users SET is_referrer_checked = TRUE WHERE telegram_user_id = $1';
            await client.query(flagQuery, [userId]);

            await client.query('COMMIT');
            
            // সর্বশেষ ডেটা আবার লোড করা
            const finalResult = await pool.query(checkQuery, [userId]);
            const finalTaka = parseFloat(finalResult.rows[0].earned_points || 0);
            const finalPoints = Math.round(finalTaka * POINTS_PER_TAKA);
            
            return res.json({ 
                success: true, 
                earned_points: finalPoints, 
                referral_count: finalResult.rows[0].referral_count,
                message: `User registered. Referral bonus of ${REFERRAL_BONUS_POINTS} points added to referrer ${refererId}.`
            });
        }
        
        await client.query('COMMIT'); 
        
        // যদি শুধু ইউজার চেক বা সাধারণ লোড হয়
        const finalResult = await pool.query(checkQuery, [userId]);
        const finalTaka = parseFloat(finalResult.rows[0].earned_points || 0);
        const finalPoints = Math.round(finalTaka * POINTS_PER_TAKA);

        res.json({ 
            success: true, 
            earned_points: finalPoints, 
            referral_count: finalResult.rows[0].referral_count || 0
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK'); 
        console.error('Error in /api/register_or_check:', error);
        res.status(500).json({ success: false, message: 'Server error during registration/check process.' });
    } finally {
        if (client) client.release();
    }
});


// ---------------------------------------------------------------------
// --- ২. পয়েন্ট যোগ করা (/api/add_points) ---
// ---------------------------------------------------------------------
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body;
    if (!userId || !points) {
        return res.status(400).json({ success: false, message: 'Missing userId or points.' });
    }

    const takaEquivalent = points / POINTS_PER_TAKA;

    try {
        const query = 'UPDATE users SET earned_points = earned_points + $1 WHERE telegram_user_id = $2 RETURNING earned_points';
        const result = await pool.query(query, [takaEquivalent, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        
        const newEarnedTaka = parseFloat(result.rows[0].earned_points);
        const newEarnedPoints = Math.round(newEarnedTaka * POINTS_PER_TAKA);

        res.json({ 
            success: true, 
            new_points: newEarnedPoints, 
            taka_added: takaEquivalent 
        });

    } catch (error) {
        console.error('Error adding points:', error);
        res.status(500).json({ success: false, message: 'Server error adding points.' });
    }
});


// ---------------------------------------------------------------------
// --- ৩. উত্তোলন রিকোয়েস্ট (/api/withdraw) ---
// ---------------------------------------------------------------------
app.post('/api/withdraw', async (req, res) => {
    const { userId, pointsToWithdraw, paymentMethod, paymentNumber } = req.body;
    
    if (!userId || !pointsToWithdraw || !paymentMethod || !paymentNumber) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    
    const takaEquivalent = pointsToWithdraw / POINTS_PER_TAKA;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // ক. ইউজারের বর্তমান ব্যালেন্স চেক করা
        const userResult = await client.query('SELECT earned_points FROM users WHERE telegram_user_id = $1 FOR UPDATE', [userId]);
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        
        const currentTaka = parseFloat(userResult.rows[0].earned_points);
        if (currentTaka < takaEquivalent) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Insufficient balance for withdrawal.' });
        }

        // খ. ব্যালেন্স আপডেট করা
        const updateQuery = 'UPDATE users SET earned_points = earned_points - $1 WHERE telegram_user_id = $2 RETURNING earned_points';
        const updateResult = await client.query(updateQuery, [takaEquivalent, userId]);

        // গ. উত্তোলনের অনুরোধ রেকর্ড করা (যদি আপনার কাছে withdrawals_requests টেবিল থাকে, এটি আনকমেন্ট করবেন)
        // const withdrawQuery = 'INSERT INTO withdrawals_requests (user_id, amount_points, amount_taka, method, number) VALUES ($1, $2, $3, $4, $5)';
        // await client.query(withdrawQuery, [userId, pointsToWithdraw, takaEquivalent.toFixed(2), paymentMethod, paymentNumber]);

        await client.query('COMMIT');

        const newEarnedTaka = parseFloat(updateResult.rows[0].earned_points);
        const newEarnedPoints = Math.round(newEarnedTaka * POINTS_PER_TAKA);

        res.json({ success: true, new_points: newEarnedPoints });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in /api/withdraw:', error);
        res.status(500).json({ success: false, message: 'Server error during withdrawal process.' });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------
// --- ৪. অ্যাডমিন ডেটা লোড করা (/api/admin/all_users) ---
// ---------------------------------------------------------------------
app.get('/api/admin/all_users', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users');
        
        const users = result.rows.map(row => {
            const earnedTaka = parseFloat(row.earned_points || 0);
            const earnedPoints = Math.round(earnedTaka * POINTS_PER_TAKA);
            
            return {
                id: row.telegram_user_id,
                points: earnedPoints,
                taka: earnedTaka.toFixed(2), 
                referrals: row.referral_count || 0,
                withdraw_requests: row.withdraw_requests_count || 0,
                joined: row.created_at ? new Date(row.created_at).toLocaleDateString() : 'N/A'
            };
        });

        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching admin data:', error);
        res.status(500).json({ success: false, message: 'Server error fetching admin data.' });
    }
});

// সার্ভার চালু
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
