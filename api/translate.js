// POST /api/translate  {"texts": ["..."], "to": "ja"}  →  {"texts": ["..."]}
const { translateMany } = require('../lib/sources');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('{"error":"POST only"}');
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 200000) break;
  }
  try {
    const { texts = [], to = 'ja' } = JSON.parse(body || '{}');
    const out = await translateMany(texts.slice(0, 60), String(to).slice(0, 8));
    res.end(JSON.stringify({ texts: out }));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
};
