// --- নতুন EndPoint: ইউজার রেজিস্ট্রেশন ও রেফারেল চেক করা (/api/register_or_check) ---
app.post('/api/register_or_check', async (req, res) => {
    const { userId, refererId } = req.body; // Mini App থেকে ইউজার আইডি এবং রেফারার আইডি আসবে
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // ক. ইউজার ডেটাবেসে আছে কিনা চেক করা
        const checkQuery = 'SELECT earned_points, referral_count, is_referrer_checked FROM users WHERE telegram_user_id = $1';
        const userResult = await client.query(checkQuery, [userId]);
        
        let userExists = userResult.rows.length > 0;
        let isReferrerChecked = userExists ? userResult.rows[0].is_referrer_checked : false;
        
        // খ. যদি নতুন ইউজার হয়, তবে তাকে যোগ করা
        if (!userExists) {
            const insertQuery = 'INSERT INTO users (telegram_user_id) VALUES ($1) RETURNING *';
            const insertResult = await client.query(insertQuery, [userId]);
            userExists = true; // এখন ইউজার আছে
        }
        
        // গ. রেফারেল প্রসেস: রেফারার থাকলে এবং চেক না করা হলে
        if (refererId && refererId !== userId && !isReferrerChecked) {
            
            // i. রেফারারকে বোনাস এবং কাউন্ট যোগ করা
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
            const finalResult = await client.query(checkQuery, [userId]);
            const finalTaka = parseFloat(finalResult.rows[0].earned_points);
            const finalPoints = Math.round(finalTaka * POINTS_PER_TAKA);
            
            return res.json({ 
                success: true, 
                earned_points: finalPoints, 
                referral_count: finalResult.rows[0].referral_count,
                message: `User registered. ${REFERRAL_BONUS_POINTS} points added to referrer ${refererId}.`
            });
            
        }

        await client.query('COMMIT'); 
        
        // যদি শুধু ইউজার চেক বা সাধারণ লোড হয়
        const finalResult = await client.query(checkQuery, [userId]);
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
