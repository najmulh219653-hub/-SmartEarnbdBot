// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database Setup (SQLite in file mode)
// Render/Cyclic এ এই ফাইলটি persistant storage এ থাকবে
const DB_FILE = 'earning_data.db';
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_user_id TEXT PRIMARY KEY,
                earned_points INTEGER DEFAULT 0,
                referral_count INTEGER DEFAULT 0,
                referer_id TEXT,
                referral_bonus_given INTEGER DEFAULT 0,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id TEXT,
                points INTEGER,
                payment_method TEXT,
                payment_number TEXT,
                status TEXT DEFAULT 'Pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
});

const REFERRAL_POINTS = 250;

// --- API Endpoints ---

// 1. Register or Check User (Referral System Included)
app.post('/api/register_or_check', (req, res) => {
    const { userId, refererId } = req.body;
    let message = 'User loaded successfully.';
    
    // Check if user exists
    db.get('SELECT * FROM users WHERE telegram_user_id = ?', [userId], (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error.', error: err.message });
        }

        if (row) {
            // User exists
            return res.json({ success: true, earned_points: row.earned_points, referral_count: row.referral_count, message });
        } else {
            // User does not exist, insert new user
            db.run('INSERT INTO users (telegram_user_id, referer_id) VALUES (?, ?)', [userId, refererId], function(err) {
                if (err) {
                    console.error('Insert error:', err.message);
                    return res.status(500).json({ success: false, message: 'Could not register user.' });
                }

                // New user registered, check for referral bonus
                if (refererId && refererId !== userId) {
                    db.get('SELECT referral_bonus_given FROM users WHERE telegram_user_id = ?', [refererId], (err, referer) => {
                        if (referer && referer.referral_bonus_given === 0) {
                            // Give referral points to the referrer and update their count/flag
                            db.run('UPDATE users SET earned_points = earned_points + ?, referral_count = referral_count + 1, referral_bonus_given = 1 WHERE telegram_user_id = ?', [REFERRAL_POINTS, refererId], (err) => {
                                if (!err) {
                                    message = `Referral bonus of ${REFERRAL_POINTS} points added to referrer ${refererId}'s account.`;
                                }
                            });
                        }
                    });
                }

                res.json({ success: true, earned_points: 0, referral_count: 0, message });
            });
        }
    });
});

// 2. Add Points (For Ads)
app.post('/api/add_points', (req, res) => {
    const { userId, points } = req.body;
    
    if (points <= 0) return res.status(400).json({ success: false, message: "Invalid points value." });

    db.run('UPDATE users SET earned_points = earned_points + ? WHERE telegram_user_id = ?', [points, userId], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error.', error: err.message });
        }
        
        // Fetch new balance to return
        db.get('SELECT earned_points FROM users WHERE telegram_user_id = ?', [userId], (err, row) => {
            if (err || !row) {
                 return res.status(500).json({ success: false, message: 'Could not fetch new balance.' });
            }
            res.json({ success: true, new_points: row.earned_points });
        });
    });
});

// 3. Withdraw Request
app.post('/api/withdraw', (req, res) => {
    const { userId, pointsToWithdraw, paymentMethod, paymentNumber } = req.body;
    
    if (pointsToWithdraw <= 0) return res.status(400).json({ success: false, message: "Invalid points value." });

    db.get('SELECT earned_points FROM users WHERE telegram_user_id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ success: false, message: 'User not found or database error.' });
        }

        if (user.earned_points < pointsToWithdraw) {
            return res.status(400).json({ success: false, message: 'Not enough points to withdraw.' });
        }

        // Deduct points and create withdrawal request in one transaction (Best Practice)
        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');
            
            // Deduct points
            db.run('UPDATE users SET earned_points = earned_points - ? WHERE telegram_user_id = ?', [pointsToWithdraw, userId], function(err) {
                if (err) {
                    db.run('ROLLBACK;');
                    return res.status(500).json({ success: false, message: 'Failed to deduct points.' });
                }

                // Insert withdrawal request
                db.run('INSERT INTO withdrawals (telegram_user_id, points, payment_method, payment_number) VALUES (?, ?, ?, ?)', 
                       [userId, pointsToWithdraw, paymentMethod, paymentNumber], function(err) {
                    if (err) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ success: false, message: 'Failed to record withdrawal request.' });
                    }
                    
                    db.run('COMMIT;', (commitErr) => {
                        if (commitErr) {
                             return res.status(500).json({ success: false, message: 'Transaction error.' });
                        }
                        
                        // Fetch the new balance after successful transaction
                        db.get('SELECT earned_points FROM users WHERE telegram_user_id = ?', [userId], (err, row) => {
                             res.json({ success: true, new_points: row ? row.earned_points : user.earned_points - pointsToWithdraw });
                        });
                    });
                });
            });
        });
    });
});

// 4. Admin - Get Stats
app.get('/api/get_admin_stats', (req, res) => {
    let stats = {};

    db.get('SELECT COUNT(*) AS total_users, SUM(earned_points) AS total_points FROM users', (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error (Users)' });
        stats.total_users = row.total_users || 0;
        stats.total_points = row.total_points || 0;

        db.get("SELECT COUNT(*) AS pending_withdrawals FROM withdrawals WHERE status = 'Pending'", (err, row) => {
            if (err) return res.status(500).json({ success: false, message: 'DB Error (Withdrawals)' });
            stats.pending_withdrawals = row.pending_withdrawals || 0;
            
            res.json({ success: true, ...stats });
        });
    });
});

// 5. Admin - Get Withdrawals by Status
app.get('/api/get_withdrawals', (req, res) => {
    const status = req.query.status || 'Pending';
    db.all('SELECT * FROM withdrawals WHERE status = ? ORDER BY created_at DESC', [status], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error.', error: err.message });
        }
        res.json(rows);
    });
});

// 6. Admin - Update Withdrawal Status
app.post('/api/update_withdrawal_status', (req, res) => {
    const { requestId, status } = req.body;
    
    if (!['Completed', 'Cancelled'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status provided.' });
    }

    db.run('UPDATE withdrawals SET status = ? WHERE id = ?', [status, requestId], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database update failed.', error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
        }

        // If cancelled, we need to refund the points to the user
        if (status === 'Cancelled') {
            db.get('SELECT telegram_user_id, points FROM withdrawals WHERE id = ?', [requestId], (err, request) => {
                if (request) {
                    db.run('UPDATE users SET earned_points = earned_points + ? WHERE telegram_user_id = ?', [request.points, request.telegram_user_id], (err) => {
                         if (err) console.error('Refund failed for request:', requestId, err.message);
                         res.json({ success: true, message: `Status updated to ${status}. Points refunded.` });
                    });
                } else {
                     res.json({ success: true, message: `Status updated to ${status}. No refund needed or user not found.` });
                }
            });
        } else {
            res.json({ success: true, message: `Status updated to ${status}.` });
        }
    });
});


// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
