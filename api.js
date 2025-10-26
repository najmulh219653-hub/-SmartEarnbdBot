// api.js (পরিবর্তিত অংশ: শেষে নতুন রুট যুক্ত করা হয়েছে)

// ... (পূর্বের /user-data রুটটি অক্ষত থাকবে) ...

// --- ৪. পয়েন্ট যোগ করার নতুন API রুট (Add Points) ---
router.post('/add-points', async (req, res) => {
    const { telegramId, points } = req.body;
    const pointsToAdd = points || 5; // ডিফল্ট ৫ পয়েন্ট
    
    if (!telegramId) {
        return res.status(400).json({ success: false, message: "Telegram ID অনুপস্থিত।" });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET total_points = total_points + $1 WHERE telegram_id = $2 RETURNING total_points',
            [pointsToAdd, telegramId]
        );

        if (result.rowCount === 0) {
            // যদি ইউজার ডাটাবেসে না থাকে,
            return res.status(404).json({ success: false, message: "ইউজার খুঁজে পাওয়া যায়নি।" });
        }

        return res.status(200).json({ 
            success: true, 
            message: `✅ আপনি সফলভাবে ${pointsToAdd} পয়েন্ট অর্জন করেছেন!`, 
            new_points: result.rows[0].total_points
        });

    } catch (error) {
        console.error("পয়েন্ট যোগ করার ত্রুটি:", error);
        res.status(500).json({ success: false, message: "অভ্যন্তরীণ সার্ভার ত্রুটি।" });
    }
});

module.exports = router; // নিশ্চিত করুন যে এটি ফাইলের শেষে আছে
