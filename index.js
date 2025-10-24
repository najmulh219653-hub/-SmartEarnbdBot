// --- index.js (Render Server Code) - FINAL & ADMIN READY ---
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors'); 

const app = express();
const port = process.env.PORT || 10000;

// --- কনস্ট্যান্টস ---
const POINTS_PER_TAKA = 250; 
const REFERRAL_BONUS_POINTS = 250; 

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
// ১. ইউজার রেজিস্ট্রেশন ও রেফারেল চেক করা (/api/register_or_check)
// ---------------------------------------------------------------------
app.post('/api/register_or_check', async (req, res) => {
    const { userId, refererId } = req.body; 
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Check if user exists
        const checkQuery = 'SELECT earned_points, referral_count, is_referrer_checked FROM users WHERE telegram_user_id = $1';
        let userResult = await client.query(checkQuery, [userId]);
        
        let userExists = userResult.rows.length > 0;
        
        if (!userExists) {
            // Insert new user
            await client.query('INSERT INTO users (telegram_user_id, is_referrer_checked) VALUES ($1, FALSE)', [userId]);
            userResult = await client.query(checkQuery, [userId]); 
            userExists = true;
        }

        const isReferrerChecked = userResult.rows[0].is_referrer_checked;
        
        let message = '';
        if (refererId && refererId !== userId && !isReferrerChecked) {
            // Convert points to Taka for DB storage (DECIMAL type)
            const bonusTaka = REFERRAL_BONUS_POINTS / POINTS_PER_TAKA; 
            
            // Update referrer's points and count
            const referrerUpdateQuery = `
                UPDATE users 
                SET earned_points = earned_points + $1, 
                    referral_count = referral_count + 1
                WHERE telegram_user_id = $2
            `;
            await client.query(referrerUpdateQuery, [bonusTaka, refererId]);

            // Flag the current user as checked
            const flagQuery = 'UPDATE users SET is_referrer_checked = TRUE WHERE telegram_user_id = $1';
            await client.query(flagQuery, [userId]);

            message = `Referral bonus of ${REFERRAL_BONUS_POINTS} points added to referrer ${refererId}.`;
        }
        
        await client.query('COMMIT'); 
        
        // Fetch the most recent data after potential updates
        const finalResult = await pool.query(checkQuery, [userId]);
        
        // Convert Taka (from DB) to Points (for UI)
        const finalTaka = parseFloat(finalResult.rows[0].earned_points || 0);
        const finalPoints = Math.round(finalTaka * POINTS_PER_TAKA);

        res.json({ 
            success: true, 
            earned_points: finalPoints, 
            referral_count: finalResult.rows[0].referral_count || 0,
            message: message 
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK'); 
        console.error('Error in /api/register_or_check:', error);
        res.status(500).json({ success: false, message: 'Server error during registration/check process. Check DB structure.' });
    } finally {
        if (client) client.release();
    }
});


// ---------------------------------------------------------------------
// ২. পয়েন্ট যোগ করা (/api/add_points)
// ---------------------------------------------------------------------
app.post('/api/add_points', async (req, res) => {
    const { userId, points } = req.body;
    
    // Convert points to Taka for DB storage
    const takaToAdd = points / POINTS_PER_TAKA;

    try {
        const query = 'UPDATE users SET earned_points = earned_points + $1 WHERE telegram_user_id = $2 RETURNING earned_points';
        const result = await pool.query(query, [takaToAdd, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Convert new Taka amount back to Points for response
        const newTaka = parseFloat(result.rows[0].earned_points);
        const newPoints = Math.round(newTaka * POINTS_PER_TAKA);

        res.json({ success: true, new_points: newPoints });

    } catch (error) {
        console.error('Error adding points:', error);
        res.status(500).json({ success: false, message: 'Server error adding points.' });
    }
});

// ---------------------------------------------------------------------
// ৩. উত্তোলন রিকোয়েস্ট জমা দেওয়া (/api/withdraw)
// ---------------------------------------------------------------------
app.post('/api/withdraw', async (req, res) => {
    const { userId, pointsToWithdraw, paymentMethod, paymentNumber } = req.body;
    let client;

    // Convert points to Taka for DB storage
    const takaToWithdraw = pointsToWithdraw / POINTS_PER_TAKA;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Check current balance
        const balanceQuery = 'SELECT earned_points FROM users WHERE telegram_user_id = $1 FOR UPDATE';
        const balanceResult = await client.query(balanceQuery, [userId]);

        if (balanceResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const currentTaka = parseFloat(balanceResult.rows[0].earned_points);

        if (currentTaka < takaToWithdraw) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Insufficient balance.' });
        }

        // 2. Insert withdrawal request
        const insertQuery = `
            INSERT INTO withdrawal_requests (telegram_user_id, amount_points, amount_taka, payment_method, payment_number)
            VALUES ($1, $2, $3, $4, $5)
        `;
        await client.query(insertQuery, [userId, pointsToWithdraw, takaToWithdraw, paymentMethod, paymentNumber]);

        // 3. Deduct points from user's balance
        const updateBalanceQuery = 'UPDATE users SET earned_points = earned_points - $1 WHERE telegram_user_id = $2 RETURNING earned_points';
        const updateResult = await client.query(updateBalanceQuery, [takaToWithdraw, userId]);

        await client.query('COMMIT');
        
        // Get new balance for response
        const newTaka = parseFloat(updateResult.rows[0].earned_points);
        const newPoints = Math.round(newTaka * POINTS_PER_TAKA);

        res.json({ success: true, new_points: newPoints });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error during withdrawal:', error);
        res.status(500).json({ success: false, message: 'Server error processing withdrawal.' });
    } finally {
        if (client) client.release();
    }
});


// ---------------------------------------------------------------------
// ৪. অ্যাডমিন: সকল পরিসংখ্যান লোড করা (/api/get_admin_stats)
// ---------------------------------------------------------------------
app.get('/api/get_admin_stats', async (req, res) => {
    try {
        const userCountResult = await pool.query('SELECT COUNT(*) AS total_users FROM users');
        const totalPointsResult = await pool.query('SELECT SUM(earned_points) AS total_taka FROM users');
        const pendingWithdrawalResult = await pool.query('SELECT COUNT(*) AS pending_count FROM withdrawal_requests WHERE status = \'Pending\'');
        const totalWithdrawalResult = await pool.query('SELECT COUNT(*) AS total_withdrawal_count FROM withdrawal_requests');

        const totalTaka = parseFloat(totalPointsResult.rows[0].total_taka || 0);
        const totalPoints = Math.round(totalTaka * POINTS_PER_TAKA);
        
        res.json({
            success: true,
            total_users: parseInt(userCountResult.rows[0].total_users || 0),
            total_points: totalPoints,
            pending_withdrawals: parseInt(pendingWithdrawalResult.rows[0].pending_count || 0),
            total_withdrawals: parseInt(totalWithdrawalResult.rows[0].total_withdrawal_count || 0)
        });

    } catch (error) {
        console.error('Error fetching admin stats:', error);
        // Table not found error code for PostgreSQL
        if (error.code === '42P01') { 
             return res.status(200).json({ 
                success: false, 
                message: 'Database tables not found. Run migrations.', 
                total_users: 0, 
                total_points: 0,
                pending_withdrawals: 0,
                total_withdrawals: 0
             });
        }
        res.status(500).json({ success: false, message: 'Server error fetching admin statistics.' });
    }
});


// ---------------------------------------------------------------------
// ৫. অ্যাডমিন: উইথড্রয়াল রিকোয়েস্ট লোড করা (/api/get_withdrawals)
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
        if (error.code === '42P01') { 
             return res.status(200).json([]);
        }
        res.status(500).json({ success: false, message: 'Server error fetching withdrawal requests.' });
    }
});


// ---------------------------------------------------------------------
// ৬. অ্যাডমিন: উইথড্রয়াল স্ট্যাটাস আপডেট করা (/api/update_withdrawal_status)
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
