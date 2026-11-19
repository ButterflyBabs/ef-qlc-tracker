// Local test server: serves public/ and runs the api/ handlers the way Vercel does.
// Reads .env.local if present. Uses the embedded test database unless DATABASE_URL is set.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env.local'))) {
  for (const line of (await readFile(path.join(root, '.env.local'), 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const PORT = Number(process.env.PORT || 3412);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); };
  res.redirect = (n, to) => { res.statusCode = n; res.setHeader('Location', to); res.end(); };

  let name = null;
  req.query = Object.fromEntries(url.searchParams);
  const enter = url.pathname.match(/^\/enter\/([^/]+)$/);
  if (enter) { name = 'enter'; req.query.token = decodeURIComponent(enter[1]); }
  else if (url.pathname.startsWith('/api/')) name = url.pathname.slice(5);

  if (name) {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString();
      req.body = raw && (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : raw || undefined;
      const mod = await import(pathToFileURL(path.join(root, 'api', name + '.js')).href);
      await mod.default(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
    return;
  }

  const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(root, 'public')) || !existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.end(await readFile(file));
}).listen(PORT, () => console.log('Tracker running at http://localhost:' + PORT));
