import { guard } from '../lib/auth.js';
import { query } from '../lib/db.js';
import { TASK_COLS, PROJECT_COLS } from '../lib/cols.js';

// GET /api/data -> everything the page needs: who is signed in, projects, tasks.
export default async function handler(req, res) {
  const me = guard(req, res);
  if (!me) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Not allowed' });
  try {
    const [projects, tasks, seen] = await Promise.all([
      query(`select ${PROJECT_COLS} from projects order by lower(name)`),
      query(`select ${TASK_COLS} from tasks order by created_at`),
      query(`select person, extract(epoch from now() - last_seen)::int as ago from presence`),
    ]);
    const presence = Object.fromEntries(seen.map((r) => [r.person, r.ago]));
    res.status(200).json({ me, projects, tasks, presence });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load the list.' });
  }
}
