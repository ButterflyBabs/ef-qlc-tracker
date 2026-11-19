import { head } from '@vercel/blob';
import { guard } from '../lib/auth.js';
import { query } from '../lib/db.js';
import { ATTACHMENT_COLS } from '../lib/cols.js';
import { WORKSPACES } from '../lib/validate.js';
import { MAX_BYTES, PREFIX, cleanDisplayName, deleteBlobs } from '../lib/files.js';

// POST /api/attachments        record a file that was just uploaded
//   body: { name, pathname, taskId | projectId | workspace }
//   attach to a task, or to a project, or (neither) to a whole section
// DELETE /api/attachments?id=  remove the file and its record
export default async function handler(req, res) {
  const me = guard(req, res, { write: true });
  if (!me) return;
  try {
    if (req.method === 'POST') {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const name = cleanDisplayName(b.name);
      if (!name) return res.status(400).json({ error: 'The file needs a name.' });
      const pathname = typeof b.pathname === 'string' ? b.pathname : '';
      if (!pathname.startsWith(PREFIX) || pathname.length > 400 || pathname.includes('..')) return res.status(400).json({ error: 'Unknown file.' });

      let workspace = null, taskId = null, projectId = null;
      if (b.taskId) {
        const r = await query('select id, workspace from tasks where id = $1', [String(b.taskId).slice(0, 64)]);
        if (!r.length) return res.status(404).json({ error: 'That task no longer exists.' });
        taskId = r[0].id; workspace = r[0].workspace;
      } else if (b.projectId) {
        const r = await query('select id, workspace from projects where id = $1', [String(b.projectId).slice(0, 64)]);
        if (!r.length) return res.status(404).json({ error: 'That project no longer exists.' });
        projectId = r[0].id; workspace = r[0].workspace;
      } else {
        if (!WORKSPACES.includes(b.workspace)) return res.status(400).json({ error: 'Choose a section.' });
        workspace = b.workspace;
      }

      // Trust the storage service, not the browser, for the real size and type.
      let meta;
      try {
        meta = await head(pathname);
      } catch {
        return res.status(400).json({ error: 'The upload did not finish. Try again.' });
      }
      if (meta.size > MAX_BYTES) {
        await deleteBlobs([pathname]);
        return res.status(400).json({ error: 'Files can be up to 25 MB.' });
      }
      const rows = await query(
        `insert into attachments (workspace, task_id, project_id, name, pathname, size, content_type, uploaded_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${ATTACHMENT_COLS}`,
        [workspace, taskId, projectId, name, pathname, meta.size, String(meta.contentType || 'application/octet-stream').slice(0, 200), me]
      );
      return res.status(201).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id || id.length > 64) return res.status(400).json({ error: 'Missing document.' });
      const rows = await query('delete from attachments where id = $1 returning pathname', [id]);
      await deleteBlobs(rows.map((r) => r.pathname));
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Not allowed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'That did not save.' });
  }
}
