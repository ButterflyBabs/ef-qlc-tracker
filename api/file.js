import { Readable } from 'node:stream';
import { get } from '@vercel/blob';
import { guard } from '../lib/auth.js';
import { query } from '../lib/db.js';
import { INLINE_TYPES, extOf } from '../lib/files.js';

// GET /api/file?id=<document id>[&dl=1]
// Only signed-in people can reach this. PDFs and common images open in the browser; everything
// else (and anything with dl=1) downloads.
export default async function handler(req, res) {
  const me = guard(req, res);
  if (!me) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Not allowed' });
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id || id.length > 64) return res.status(400).json({ error: 'Missing document.' });
  try {
    const rows = await query('select name, pathname from attachments where id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'That document no longer exists.' });
    const { name, pathname } = rows[0];
    const found = await get(pathname, { access: 'private' });
    if (!found || !found.stream) return res.status(404).json({ error: 'That document is missing from storage.' });

    const mime = INLINE_TYPES[extOf(name)];
    const inline = Boolean(mime) && req.query.dl !== '1';
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (found.blob && found.blob.size) res.setHeader('Content-Length', String(found.blob.size));
    res.status(200);
    Readable.fromWeb(found.stream).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'Could not open that document.' });
  }
}
