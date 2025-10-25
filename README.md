EarnQuick Bot - Telegram Mini App Backend
​এটি EarnQuick Telegram Mini App-এর Node.js এবং Express ভিত্তিক ব্যাকএন্ড সার্ভিস। এটি টেলিগ্রাম বট (Telegraf) এবং PostgreSQL ডেটাবেস ব্যবহার করে ইউজার রেজিস্ট্রেশন, রেফারেল এবং পয়েন্ট ম্যানেজমেন্টের কাজ করে।
​🚀 ফিচারসমূহ (Features)
​Telegram Webhook: Webhook-এর মাধ্যমে টেলিগ্রাম আপডেট রিসিভ করা।
​User Management: PostgreSQL-এ ইউজার ডেটা সংরক্ষণ, পয়েন্ট ট্র্যাকিং।
​Referral System: /start r_code ব্যবহার করে ইউজার রেফারেল ট্র্যাকিং ও ইনস্ট্যান্ট বোনাস প্রদান।
​Monetag Callback API: মনিটেগ S2S (Server-to-Server) কলব্যাক রিসিভ করা এবং ইউজারদের অ্যাকাউন্টে পয়েন্ট যোগ করা।
​Secure Withdraw API: নির্দিষ্ট সময় ও লিমিট মেনে উইথড্র রিকোয়েস্ট হ্যান্ডেল করা।
​⚙️ প্রজেক্ট সেটআপ (Project Setup)
​১. ডেটাবেস সেটআপ
​PostgreSQL এ নিচের টেবিলগুলি তৈরি করুন (Render-এর PSQL কমান্ড ব্যবহার করে):
