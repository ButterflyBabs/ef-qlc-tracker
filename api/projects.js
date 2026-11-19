import { guard } from '../lib/auth.js';
import { query } from '../lib/db.js';
import { PROJECT_COLS } from '../lib/cols.js';
import { cleanProject } from '../lib/validate.js';

// POST /api/projects         create
// PATCH /api/projects?id=    rename
// DELETE /api/projects?id=   delete (its tasks stay, with no project)
export default async function handler(req, res) {
  const me = guard(req, res, { write: true });
  if (!me) return;
  try {
    if (req.method === 'POST') {
      const { data, error } = cleanProject(req.body, { create: true });
      if (error) return res.status(400).json({ error });
      const rows = await query(
        `insert into projects (workspace, name, color) values ($1, $2, $3) returning ${PROJECT_COLS}`,
        [data.workspace, data.name, data.color]
      );
      return res.status(201).json(rows[0]);
    }

    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id || id.length > 64) return res.status(400).json({ error: 'Missing project.' });

    if (req.method === 'PATCH') {
      const { data, error } = cleanProject(req.body, { create: false });
      if (error) return res.status(400).json({ error });
      const rows = await query(`update projects set name = $1 where id = $2 returning ${PROJECT_COLS}`, [data.name, id]);
      if (!rows.length) return res.status(404).json({ error: 'That project no longer exists.' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      await query('delete from projects where id = $1', [id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Not allowed' });
  } catch (e) {
    if (e && (e.code === '23505' || /projects_workspace_name/.test(String(e.message)))) {
      return res.status(409).json({ error: 'A project with that name already exists.' });
    }
    console.error(e);
    res.status(500).json({ error: 'That did not save.' });
  }
}
