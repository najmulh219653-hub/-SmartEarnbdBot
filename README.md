# 💰 EarnQuick Official - Telegram Mini App Backend

এই রিপোজিটরিটি EarnQuick Official Telegram Mini App-এর ব্যাকএন্ড সার্ভার কোড হোস্ট করে, যা Node.js (Express) এবং PostgreSQL (Neon DB) ব্যবহার করে তৈরি। এই সার্ভারটি ইউজার রেজিস্ট্রেশন, পয়েন্ট যোগ, রেফারেল ট্র্যাকিং এবং উইথড্রয়াল রিকোয়েস্টের মতো কাজগুলো পরিচালনা করে।

---

## 🛠️ টেকনোলজি স্ট্যাক

* **ব্যাকএন্ড:** Node.js, Express.js
* **ডেটাবেস:** PostgreSQL (Neon.tech)
* **হোস্টিং:** Render
* **ফ্রন্টএন্ড:** HTML/JavaScript (Blogger/Telegram Web App)

---

## 🚀 লোকাল সেটআপ ও ডিপ্লয়মেন্ট গাইড

প্রজেক্টটি শুরু করার জন্য নিচের ধাপগুলো অনুসরণ করুন।

### ১. ডেটাবেস কনফিগারেশন

এই প্রজেক্টটি PostgreSQL ব্যবহার করে। আমরা [Neon.tech](https://neon.tech/) ব্যবহার করার পরামর্শ দিই।

1.  Neon-এ একটি নতুন ডেটাবেস তৈরি করুন।
2.  আপনার **Connection String** সংগ্রহ করুন।

### ২. এনভায়রনমেন্ট ভেরিয়েবল সেটআপ

আপনার সার্ভারকে ডেটাবেসের সাথে সংযুক্ত করতে, আপনাকে `DATABASE_URL` এনভায়রনমেন্ট ভেরিয়েবল সেট করতে হবে।

* **Render-এ ডিপ্লয়মেন্টের জন্য:** Render ড্যাশবোর্ডে গিয়ে Environment Variables সেকশনে আপনার Neon **Connection String**-কে `DATABASE_URL` নামে যুক্ত করুন।
* **লোকাল টেস্টিং-এর জন্য:** প্রজেক্ট রুটে একটি `.env` ফাইল তৈরি করুন এবং নিম্নলিখিতভাবে ভ্যালু দিন (এই ফাইলটি `.gitignore`-এ যুক্ত করা আছে):
    ```env
    # Neon/PostgreSQL Connection String
    DATABASE_URL="postgres://[user]:[password]@[host]/[database]" 
    ```

### ৩. প্রজেক্ট সেটআপ

```bash
# ১. রিপোজিটরি ক্লোন করুন
git clone [আপনার_রিপোজিটরি_URL]
cd earnquick-backend # আপনার ফোল্ডারের নাম

# ২. সকল Node.js প্যাকেজ ইনস্টল করুন
npm install

# ৩. লোকাল ডেভেলপমেন্টের জন্য রান করুন (যদি আপনি লোকালি টেস্ট করতে চান)
npm start 
# অথবা 
# node server.js
# -SmartEarnbdBot
