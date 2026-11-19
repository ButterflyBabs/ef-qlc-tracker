export const TASK_COLS = `id, workspace, project_id as "projectId", name, owner, status,
  start_date::text as start, due_date::text as due, notes, done_at::text as "doneAt", created_at as "createdAt"`;
export const PROJECT_COLS = `id, workspace, name, color, created_at as "createdAt"`;
// The storage path is never sent to the browser.
export const ATTACHMENT_COLS = `id, workspace, task_id as "taskId", project_id as "projectId", name,
  size::int as size, content_type as type, uploaded_by as "by", created_at as "at"`;
