// ClassNoteAI · H18 Deep design preview server
//
// Standalone Node http server — serves the design files in this folder.
// 從 docs/design/h18-deep/ 跑：
//   node server.js
//   → http://127.0.0.1:5173/

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.jsx':  'text/babel; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/Home H18 Deep.html';

    const filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); return res.end('Forbidden');
    }

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        console.log('404', urlPath);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404: ' + urlPath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500); res.end('500: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ClassNoteAI H18 Deep preview at http://127.0.0.1:${PORT}/`);
  console.log(`Serving: ${ROOT}`);
});
