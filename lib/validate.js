// Input checks. Only these fields, only these values, ever reach the database.
export const WORKSPACES = ['ef', 'qlc'];
export const OWNERS = ['babs', 'david', 'both', 'none'];
export const STATUSES = ['todo', 'progress', 'done'];

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null);

// Returns { data } with database column values, or { error }.
export function cleanTask(body, { create }) {
  const b = body && typeof body === 'object' ? body : {};
  const d = {};
  if ('name' in b || create) {
    const n = str(b.name, 200);
    if (!n) return { error: 'Give the task a name.' };
    d.name = n;
  }
  if ('workspace' in b || create) {
    if (!WORKSPACES.includes(b.workspace)) return { error: 'Choose a section.' };
    d.workspace = b.workspace;
  }
  if ('owner' in b) {
    if (!OWNERS.includes(b.owner)) return { error: 'Unknown person.' };
    d.owner = b.owner;
  }
  if ('status' in b) {
    if (!STATUSES.includes(b.status)) return { error: 'Unknown status.' };
    d.status = b.status;
  }
  for (const [k, col] of [['start', 'start_date'], ['due', 'due_date']]) {
    if (k in b) {
      if (b[k] === '' || b[k] === null) d[col] = null;
      else if (isDate(b[k])) d[col] = b[k];
      else return { error: 'That date is not valid.' };
    }
  }
  if ('notes' in b) {
    const n = typeof b.notes === 'string' ? b.notes.slice(0, 5000) : null;
    if (n === null) return { error: 'Notes must be text.' };
    d.notes = n;
  }
  if ('projectId' in b) {
    if (b.projectId === '' || b.projectId === null) d.project_id = null;
    else if (typeof b.projectId === 'string' && b.projectId.length <= 64) d.project_id = b.projectId;
    else return { error: 'Unknown project.' };
  }
  return { data: d };
}

export function cleanProject(body, { create }) {
  const b = body && typeof body === 'object' ? body : {};
  const d = {};
  const n = str(b.name, 100);
  if (!n) return { error: 'Give the project a name.' };
  d.name = n;
  if (create) {
    if (!WORKSPACES.includes(b.workspace)) return { error: 'Choose a section.' };
    d.workspace = b.workspace;
    const c = Number.isInteger(b.color) ? b.color : 0;
    d.color = ((c % 8) + 8) % 8;
  }
  return { data: d };
}
