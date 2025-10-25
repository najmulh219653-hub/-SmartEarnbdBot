// db.js
const { Pool } = require('pg');

// গুরুত্বপূর্ণ: এখানে সরাসরি সংযোগ URL ব্যবহার করা হচ্ছে
// Render এ ডিপ্লয়মেন্টের সময় এটি 'DATABASE_URL' এনভায়রনমেন্ট ভ্যারিয়বল থেকে আসবে
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, 
  ssl: {
    rejectUnauthorized: false // Render-এ সংযোগের জন্য সাধারণত এটি প্রয়োজন হয়
  }
});

// পুল কানেকশন সফল হয়েছে কিনা তা একবার পরীক্ষা করুন
pool.on('connect', () => {
  console.log('PostgreSQL connected to Pool.');
});

module.exports = {
  // এই ফাংশনটি server.js বা অন্যান্য ফাইলে query করার জন্য ব্যবহার করা হবে
  query: (text, params) => pool.query(text, params),
};
