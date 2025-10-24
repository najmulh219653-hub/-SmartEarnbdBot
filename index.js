// --- index.js (Render Server Code) - FINAL & ADMIN READY ---
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors'); 

const app = express();
const port = process.env.PORT || 10000;

// --- কনস্ট্যান্টস ---
const POINTS_PER_TAKA = 250; 
const REFERRAL_BONUS_POINTS = 250; // রেফারেল বোনাস 250 পয়েন্ট

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
    // Render-এর সাথে সংযোগের জন্য SSL আবশ্যক
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
// ---------------------------------------------------------------------
app.post('/api/register_or_check', async (req, res) => {
    const { userId, refererId } = req.body; 
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // is_referrer_checked কলামটি সহ ইউজার ডেটা চেক করা হচ্ছে
        const checkQuery = 'SELECT earned_points, referral_count, is_referrer_checked FROM users WHERE telegram_user_id = $1';
        let userResult = await client.query(checkQuery, [userId]);
        
        let userExists = userResult.rows.length > 0;
        
        if (!userExists) {
            // নতুন ইউজার হলে ইনিশিয়াল ভ্যালু দিয়ে তৈরি করা
            await client.query('INSERT INTO users (telegram_user_id, is_referrer_checked) VALUES ($1, FALSE)', [userId]);
            userResult = await client.query(checkQuery, [userId]); // নতুন ডেটা লোড
            userExists = true;
        }

        const isReferrerChecked = userResult.rows[0].is_referrer_checked;
        
        // রেফারেল প্রসেস: রেফারার থাকলে, নিজে রেফারার না হলে এবং রেফারেল চেক না করা হলে
        if (refererId && refererId !== userId && !isReferrerChecked) {
            const bonusTaka = REFERRAL_BONUS_POINTS / POINTS_PER_TAKA; 
            
            // রেফারারের পয়েন্ট এবং কাউন্ট আপডেট
            const referrerUpdateQuery = `
                UPDATE users 
                SET earned_points = earned_points + $1, 
                    referral_count = referral_count + 1
                WHERE telegram_user_id = $2
            `;
            await client.query(referrerUpdateQuery, [bonusTaka, refererId]);

            // নতুন ইউজারের is_referrer_checked স্ট্যাটাস TRUE করা
            const flagQuery = 'UPDATE users SET is_referrer_checked = TRUE WHERE telegram_user_id = $1';
            await client.query(flagQuery, [userId]);

            await client.query('COMMIT');
            
            // রেফারেল বোনাস যোগ হওয়ার পর চূড়ান্ত ডেটা লোড
            const finalResult = await pool.query(checkQuery, [userId]);
            const finalTaka = parseFloat(finalResult.rows[0].earned_points || 0);
            const finalPoints = Math.round(finalTaka * POINTS_PER_TAKA);
            
            return res.json({ 
                success: true, 
                earned_points: finalPoints, 
                referral_count: finalResult.rows[0].referral_count,
                // Mini App-কে দেখানোর জন্য মেসেজ
                message: `Referral bonus of ${REFERRAL_BONUS_POINTS} points added to referrer ${refererId}.`
            });
        }
        
        await client.query('COMMIT'); 
        
        // রেফারেল না হলে বা ইতোমধ্যে চেক করা হয়ে থাকলে সাধারণ ডেটা লোড
        const finalTaka = parseFloat(userResult.rows[0].earned_points || 0);
        const finalPoints = Math.round(finalTaka * POINTS_PER_TAKA);

        res.json({ 
            success: true, 
            earned_points: finalPoints, 
            referral_count: userResult.rows[0].referral_count || 0
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK'); 
        console.error('Error in /api/register_or_check:', error);
        res.status(500).json({ success: false, message: 'Server error during registration/check process. Check DB logs.' });
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

        res.json({ success: true, new_points: newEarnedPoints });

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

        // গ. উত্তোলনের অনুরোধ রেকর্ড করা
        const withdrawQuery = `
            INSERT INTO withdrawal_requests 
            (telegram_user_id, amount_points, amount_taka, payment_method, payment_number, status) 
            VALUES ($1, $2, $3, $4, $5, 'Pending')`;
        await client.query(withdrawQuery, [userId, pointsToWithdraw, takaEquivalent.toFixed(2), paymentMethod, paymentNumber]);

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
// ★★★ ৪. অ্যাডমিন: উইথড্রয়াল রিকোয়েস্ট লোড করা (/api/get_withdrawals) ★★★
// ---------------------------------------------------------------------
app.get('/api/get_withdrawals', async (req, res) => {
    const { status } = req.query; 

    let query;
    let values = [];

    if (status && ['Pending', 'Completed', 'Cancelled'].includes(status)) {
        query = 'SELECT id, telegram_user_id, amount_points, amount_taka, payment_method, payment_number, status, created_at FROM withdrawal_requests WHERE status = $1 ORDER BY created_at DESC';
        values = [status];
    } else {
        query = 'SELECT id, telegram_user_id, amount_points, amount_taka, payment_method, payment_number, status, created_at FROM withdrawal_requests ORDER BY created_at DESC';
    }

    try {
        const result = await pool.query(query, values);
        
        const requests = result.rows.map(row => ({
            id: row.id,
            telegram_user_id: row.telegram_user_id,
            points: row.amount_points,
            payment_method: row.payment_method,
            payment_number: row.payment_number,
            status: row.status,
            created_at: row.created_at 
        }));

        res.json(requests);
    } catch (error) {
        console.error('Error fetching admin data:', error);
        // টেবিল না থাকলে
        if (error.code === '42P01') { 
             return res.status(200).json([]);
        }
        res.status(500).json({ success: false, message: 'Server error fetching withdrawal requests.' });
    }
});


// ---------------------------------------------------------------------
// ★★★ ৫. অ্যাডমিন: উইথড্রয়াল স্ট্যাটাস আপডেট করা (/api/update_withdrawal_status) ★★★
// ---------------------------------------------------------------------
app.post('/api/update_withdrawal_status', async (req, res) => {
    const { requestId, status } = req.body;

    if (!requestId || !status || !['Pending', 'Completed', 'Cancelled'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid request data.' });
    }

    try {
        const query = 'UPDATE withdrawal_requests SET status = $1 WHERE id = $2 RETURNING *';
        const result = await pool.query(query, [status, requestId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
        }

        res.json({ success: true, updated_request: result.rows[0] });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ success: false, message: 'Server error updating withdrawal status.' });
    }
});


// সার্ভার চালু
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
