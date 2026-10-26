// Local server that mirrors Vercel: static files from the repo root, /api/* from the api folder.
// Run: LLM_PROVIDER=gemini LLM_API_KEY=... node scripts/dev-server.mjs   (key optional)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };
const handlers = { '/api/insight': (await import('../api/insight.js')).default, '/api/health': (await import('../api/health.js')).default };

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (handlers[path]) return handlers[path](req, res);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || file.includes(`${root}api`) || file.includes('node_modules')) { res.statusCode = 404; return res.end('Not found'); }
  try {
    const body = await readFile(file);
    res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('Not found'); }
}).listen(process.env.PORT || 3000, () => console.log(`Portfolio Pulse on http://localhost:${process.env.PORT || 3000}`));
