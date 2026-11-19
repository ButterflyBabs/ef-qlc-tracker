export const TASK_COLS = `id, workspace, project_id as "projectId", name, owner, status,
  start_date::text as start, due_date::text as due, notes, done_at::text as "doneAt", created_at as "createdAt"`;
export const PROJECT_COLS = `id, workspace, name, color, created_at as "createdAt"`;
