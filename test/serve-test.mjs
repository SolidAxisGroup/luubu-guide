import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.resolve('..');
http.createServer((req,res)=>{
  const u = new URL(req.url,'http://x');
  if (u.pathname.startsWith('/v2/location/')) { res.setHeader('content-type','text/html'); return res.end(fs.readFileSync('mock.html')); }
  const f = path.join(root, u.pathname);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader('content-type', f.endsWith('.js')?'text/javascript':'application/json'); return res.end(fs.readFileSync(f)); }
  res.statusCode=404; res.end('nf');
}).listen(8765,()=>console.log('up'));
