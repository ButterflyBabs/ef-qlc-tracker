// Personal access links for two people. No passwords, no third-party sign-in.
//   /enter/<token>  sets a signed cookie; every API call checks that cookie.
// Environment: ACCESS_TOKEN_BABS, ACCESS_TOKEN_DAVID, SESSION_SECRET.
import crypto from 'node:crypto';

export const PEOPLE = ['babs', 'david'];
const COOKIE = 'trk';
const MAX_AGE_S = 60 * 60 * 24 * 90; // 90 days

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or too short');
  return s;
};

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

export function personForToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  let found = null;
  for (const p of PEOPLE) {
    const expected = process.env['ACCESS_TOKEN_' + p.toUpperCase()];
    if (expected && expected.length >= 20 && safeEqual(token, expected)) found = p;
  }
  return found;
}

function sign(person) {
  const payload = Buffer.from(JSON.stringify({ p: person, e: Date.now() + MAX_AGE_S * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verify(value) {
  if (typeof value !== 'string') return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const good = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!safeEqual(sig, good)) return null;
  try {
    const { p, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return PEOPLE.includes(p) && e > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const secureFlag = () => (process.env.VERCEL ? '; Secure' : '');

export function sessionCookie(person) {
  return `${COOKIE}=${encodeURIComponent(sign(person))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secureFlag()}`;
}
export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

export function currentUser(req) {
  return verify(readCookie(req, COOKIE));
}

// Same-origin check for anything that changes data.
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Returns the signed-in person, or sends an error and returns null.
export function guard(req, res, { write = false } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  const me = currentUser(req);
  if (!me) {
    res.status(401).json({ error: 'Not signed in', code: 'auth' });
    return null;
  }
  if (write && !sameOrigin(req)) {
    res.status(403).json({ error: 'Blocked', code: 'origin' });
    return null;
  }
  return me;
}
