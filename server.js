// ローカル開発用サーバー: node server.js → http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const searchHandler = require('./api/search');
const translateHandler = require('./api/translate');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

http
  .createServer((req, res) => {
    if (req.url.startsWith('/api/search')) return searchHandler(req, res);
    if (req.url.startsWith('/api/translate')) return translateHandler(req, res);
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(PUBLIC, path.normalize(p));
    if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  })
  .listen(PORT, () => console.log(`World Hub: http://localhost:${PORT}`));
