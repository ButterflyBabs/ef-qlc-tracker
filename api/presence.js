import { guard } from '../lib/auth.js';
import { query } from '../lib/db.js';

// POST /api/presence  "I am here now" heartbeat; returns how long ago each person was last here.
// GET  /api/presence  same answer without updating.
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Not allowed' });
  const me = guard(req, res, { write: req.method === 'POST' });
  if (!me) return;
  try {
    if (req.method === 'POST') {
      await query(
        `insert into presence (person, last_seen) values ($1, now())
         on conflict (person) do update set last_seen = now()`,
        [me]
      );
    }
    const rows = await query(`select person, extract(epoch from now() - last_seen)::int as ago from presence`);
    res.status(200).json({ presence: Object.fromEntries(rows.map((r) => [r.person, r.ago])) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update.' });
  }
}
