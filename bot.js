// --- bot.js / main.js (Telegram Bot Code) ---

const SERVER_URL = 'https://smartearnbdbot.onrender.com'; // আপনার Render URL

// ★★★ এই ফাংশনটি বটের মূল কোডের শুরুতে যুক্ত করুন ★★★
async function sendReferralToServer(referrerId, newUserId) {
    if (referrerId === newUserId) {
        console.log(`Self-referral attempt blocked.`);
        return;
    }
    
    try {
        await fetch(`${SERVER_URL}/api/add_referral`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                referrerId: String(referrerId), 
                newUserId: String(newUserId)
            })
        });
    } catch (error) {
        console.error(`Failed to call add_referral API: ${error.message}`);
    }
}


// ★★★ আপনার বটের /start হ্যান্ডলারে এই ফাংশনটি কল করুন ★★★
/*
bot.start((ctx) => {
    const newUserId = ctx.from.id;
    const referrerId = ctx.startPayload; // এটি রেফারেল আইডি হওয়া উচিত
    
    if (referrerId) { 
        sendReferralToServer(referrerId, newUserId);
    }
    //...
});
*/
