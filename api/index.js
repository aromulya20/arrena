// Entry point untuk Vercel Serverless Function.
// server.js meng-export instance Express (bukan manggil .listen di sini),
// jadi Vercel yang handle siklus request/response-nya.
module.exports = require('../server');
