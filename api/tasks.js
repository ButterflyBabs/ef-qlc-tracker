import { guard } from '../lib/auth.js';
import { query } from '../lib/db.js';
import { TASK_COLS } from '../lib/cols.js';
import { cleanTask } from '../lib/validate.js';

const COLUMNS = ['name', 'workspace', 'owner', 'status', 'start_date', 'due_date', 'notes', 'project_id'];

// A task may only sit in a project from its own section.
async function projectMatches(projectId, workspace) {
  if (!projectId) return true;
  const rows = await query('select workspace from projects where id = $1', [projectId]);
  return rows.length === 1 && rows[0].workspace === workspace;
}

// POST /api/tasks        create
// PATCH /api/tasks?id=   change some fields
// DELETE /api/tasks?id=  delete
export default async function handler(req, res) {
  const me = guard(req, res, { write: true });
  if (!me) return;
  try {
    if (req.method === 'POST') {
      const { data, error } = cleanTask(req.body, { create: true });
      if (error) return res.status(400).json({ error });
      if (!(await projectMatches(data.project_id, data.workspace))) return res.status(400).json({ error: 'That project is in the other section.' });
      const cols = COLUMNS.filter((c) => c in data);
      const vals = cols.map((c) => data[c]);
      const sql = `insert into tasks (${cols.join(', ')}, created_by, updated_by)
        values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}, $${cols.length + 1}, $${cols.length + 1})
        returning ${TASK_COLS}`;
      const rows = await query(sql, [...vals, me]);
      return res.status(201).json(rows[0]);
    }

    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id || id.length > 64) return res.status(400).json({ error: 'Missing task.' });

    if (req.method === 'PATCH') {
      const { data, error } = cleanTask(req.body, { create: false });
      if (error) return res.status(400).json({ error });
      delete data.workspace; // a task stays in its section
      const existing = await query('select workspace from tasks where id = $1', [id]);
      if (!existing.length) return res.status(404).json({ error: 'That task no longer exists.' });
      if ('project_id' in data && !(await projectMatches(data.project_id, existing[0].workspace))) {
        return res.status(400).json({ error: 'That project is in the other section.' });
      }
      const cols = COLUMNS.filter((c) => c in data);
      const sets = cols.map((c, i) => `${c} = $${i + 1}`);
      const vals = cols.map((c) => data[c]);
      if ('status' in data) sets.push(data.status === 'done' ? 'done_at = coalesce(done_at, current_date)' : 'done_at = null');
      sets.push(`updated_by = $${vals.length + 1}`, 'updated_at = now()');
      const rows = await query(`update tasks set ${sets.join(', ')} where id = $${vals.length + 2} returning ${TASK_COLS}`, [...vals, me, id]);
      if (!rows.length) return res.status(404).json({ error: 'That task no longer exists.' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      await query('delete from tasks where id = $1', [id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Not allowed' });
  } catch (e) {
    if (e && (e.code === '23514' || /tasks_dates_in_order/.test(String(e.message)))) {
      return res.status(400).json({ error: 'The deadline is before the start date.' });
    }
    console.error(e);
    res.status(500).json({ error: 'That did not save.' });
  }
}
