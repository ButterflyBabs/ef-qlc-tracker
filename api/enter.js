import { personForToken, sessionCookie } from '../lib/auth.js';

// GET /enter/<token>  (rewritten to /api/enter?token=<token>)
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const person = personForToken(req.query.token);
  if (!person) {
    res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('This link is not valid. Ask Babs for a new one.');
    return;
  }
  res.setHeader('Set-Cookie', sessionCookie(person));
  res.redirect(302, '/');
}
