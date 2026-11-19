import { clearCookie, sameOrigin } from '../lib/auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || !sameOrigin(req)) return res.status(405).json({ error: 'Not allowed' });
  res.setHeader('Set-Cookie', clearCookie());
  res.status(200).json({ ok: true });
}
