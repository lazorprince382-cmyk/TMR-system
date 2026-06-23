const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' && !url.searchParams.has('preview')) {
    res.writeHead(302, { Location: '/?preview=actions' });
    return res.end();
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const requested = path.join(PUBLIC_DIR, safePath === path.sep ? 'index.html' : safePath);
  const filePath = requested.startsWith(PUBLIC_DIR) ? requested : path.join(PUBLIC_DIR, 'index.html');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (!path.extname(url.pathname)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (indexErr, indexData) => {
          if (indexErr) return send(res, 500, 'Could not load preview app.');
          send(res, 200, indexData, types['.html']);
        });
      }
      return send(res, 404, 'Not found');
    }

    send(res, 200, data, types[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log(`Harmoniq preview running at http://localhost:${PORT}/?preview=actions`);
  console.log('This preview uses demo data and does not need npm install or PostgreSQL.');
});
