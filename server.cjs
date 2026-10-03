// Dependency-free local static server. Run `node server.cjs`, then open the printed URL.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8'};
http.createServer((req, res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {'Allow':'GET, HEAD'}); return res.end('Method not allowed'); }
  let relative;
  try { relative = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (relative.includes('\0')) { res.writeHead(400); return res.end('Bad request'); }
  const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')return res.end();
    const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  });
}).listen(port, '127.0.0.1', () => console.log(`SHOREBREAK · Vực Lặng: http://127.0.0.1:${port}/`));
