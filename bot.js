// --- bot.js / main.js (Telegram Bot Code) ---

const SERVER_URL = 'https://smartearnbdbot.onrender.com'; // নিশ্চিত করুন এটি আপনার সঠিক Render URL

// *************** এই ফাংশনটি বটের মূল কোডের শুরুতে যুক্ত করুন ***************
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
                // নিশ্চিত করুন আইডিগুলি স্ট্রিং হিসেবে যাচ্ছে
                referrerId: String(referrerId), 
                newUserId: String(newUserId)
            })
        });
        // Response হ্যান্ডল করার লজিক এখানে যুক্ত করা যেতে পারে
    } catch (error) {
        console.error(`Failed to call add_referral API: ${error.message}`);
    }
}


// *************** আপনার বটের /start হ্যান্ডলারে এই ফাংশনটি কল করুন ***************
// (এখানে আপনার বটের লাইব্রেরি অনুযায়ী কোড ভিন্ন হবে)

// উদাহরণ: Telegraf লাইব্রেরি ব্যবহার করলে
/*
bot.start((ctx) => {
    const newUserId = ctx.from.id;
    const referrerId = ctx.startPayload; // /start এর পরের আইডি স্বয়ংক্রিয়ভাবে সংগ্রহ করে
    
    // রেফারেল লজিক কল
    if (referrerId) { 
        sendReferralToServer(referrerId, newUserId);
    }
    
    // এখানে ওয়েব অ্যাপ বা স্বাগতম বার্তা পাঠানোর কোড
});
*/
