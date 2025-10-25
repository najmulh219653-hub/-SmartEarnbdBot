# EarnQuick Bot - Telegram Mini App Backend

এটি EarnQuick Telegram Mini App-এর Node.js এবং Express ভিত্তিক ব্যাকএন্ড সার্ভিস। এটি টেলিগ্রাম বট (Telegraf) এবং PostgreSQL (Render/Neon) ডেটাবেস ব্যবহার করে ইউজার রেজিস্ট্রেশন, রেফারেল এবং পয়েন্ট ম্যানেজমেন্টের কাজ করে।

## 🚀 ফিচারসমূহ (Features)

* **Telegram Webhook:** Render-এ Webhook-এর মাধ্যমে টেলিগ্রাম আপডেট রিসিভ করা।
* **User Management:** PostgreSQL-এ ইউজার ডেটা সংরক্ষণ, পয়েন্ট ট্র্যাকিং।
* **Referral System:** `/start r_code` ব্যবহার করে ইউজার রেফারেল ট্র্যাকিং ও ইনস্ট্যান্ট বোনাস প্রদান।
* **Monetag Callback API:** মনিটেগ S2S (Server-to-Server) কলব্যাক রিসিভ করা এবং ইউজারদের অ্যাকাউন্টে পয়েন্ট যোগ করা।
* **Secure Withdraw API:** নির্দিষ্ট সময় ও লিমিট মেনে উইথড্র রিকোয়েস্ট হ্যান্ডেল করা।

## ⚙️ প্রজেক্ট সেটআপ (Local Setup)

লোকাল কম্পিউটারে প্রজেক্টটি চালু করার জন্য নিচের ধাপগুলি অনুসরণ করুন:

১.  **প্রয়োজনীয়তা:** Node.js, PostgreSQL/Neon ইনস্টল করুন।
২.  **নির্ভরতা ইনস্টল:**
    ```bash
    npm install
    ```
৩.  **এনভায়রনমেন্ট ভ্যারিয়েবল সেটআপ:** `.env` নামে একটি ফাইল তৈরি করুন (যা `.gitignore`-এ আছে) এবং নিচের ভ্যারিয়েবলগুলি যোগ করুন:

    ```env
    PORT=3000
    BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
    DATABASE_URL=postgres://user:password@host:port/dbname
    ADMIN_ID=8145444675
    MINI_APP_URL=http://localhost:8080/ (অথবা আপনার ফ্রন্টএন্ড URL)
    ```

৪.  **ডেটাবেস মাইগ্রেশন:** `users`, `ad_view_logs`, এবং `withdraw_requests` টেবিলগুলি তৈরি করুন (SQL স্ক্রিপ্ট ব্যবহার করে)।
৫.  **সার্ভার চালু:**
    ```bash
    npm start
    ```

## 🌐 ডিপ্লয়মেন্ট (Deployment)

এই প্রজেক্টটি Render প্ল্যাটফর্মে ডিপ্লয় করার জন্য তৈরি করা হয়েছে।

1.  **Render Web Service:** আপনার GitHub রিপোজিটরি ব্যবহার করে একটি Node.js **Web Service** তৈরি করুন।
2.  **Render PostgreSQL:** একটি PostgreSQL ডেটাবেস তৈরি করুন এবং এর **Internal Connection URL** টি `DATABASE_URL` ভ্যারিয়েবল হিসেবে Web Service-এ যুক্ত করুন।
3.  **Webhook সেট:** ডিপ্লয়মেন্টের পর Render স্বয়ংক্রিয়ভাবে Webhook সেট করবে।

## 🔗 এন্ডপয়েন্টস (API Endpoints)

এই ব্যাকএন্ডে ব্যবহৃত গুরুত্বপূর্ণ API রুটগুলি:

| মেথড | রুট | বিবরণ |
| :--- | :--- | :--- |
| `POST` | `/api/monetag-callback` | মনিটেগ থেকে অ্যাড ভিউয়ের ডেটা রিসিভ করার জন্য S2S কলব্যাক রুট। |
| `POST` | `/api/withdraw` | Telegram Mini App থেকে উইথড্র রিকোয়েস্ট জমা নেওয়ার জন্য রুট। |
| `GET` | `/` | সার্ভার হেলথ চেক (সার্ভার চালু আছে কিনা তা দেখায়)। |

## 👥 অবদান (Contribution)

যদি আপনি এই প্রজেক্টে কোনো অবদান রাখতে চান, তাহলে একটি Pull Request তৈরি করতে পারেন।

---

**বিকাশকারী:** [নাজমুল হক ফরহাদ]
