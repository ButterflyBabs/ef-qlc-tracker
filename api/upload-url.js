import crypto from 'node:crypto';
import { issueSignedToken, presignUrl } from '@vercel/blob';
import { guard } from '../lib/auth.js';
import { MAX_BYTES, PREFIX, safeFileName } from '../lib/files.js';

// POST /api/upload-url  { name, size }
// Returns a short-lived address the browser can send the file to directly (no size limit from the server).
export default async function handler(req, res) {
  const me = guard(req, res, { write: true });
  if (!me) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Not allowed' });
  const { name, size } = req.body && typeof req.body === 'object' ? req.body : {};
  if (!Number.isInteger(size) || size < 1) return res.status(400).json({ error: 'That file is empty.' });
  if (size > MAX_BYTES) return res.status(400).json({ error: 'Files can be up to 25 MB.' });
  try {
    const pathname = `${PREFIX}${crypto.randomUUID()}/${safeFileName(name)}`;
    const validUntil = Date.now() + 10 * 60 * 1000;
    const signed = await issueSignedToken({ pathname, operations: ['put'], validUntil, maximumSizeInBytes: MAX_BYTES });
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'put',
      pathname,
      access: 'private',
      validUntil,
      maximumSizeInBytes: MAX_BYTES,
      allowOverwrite: false,
    });
    res.status(200).json({ presignedUrl, pathname });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not start the upload.' });
  }
}
