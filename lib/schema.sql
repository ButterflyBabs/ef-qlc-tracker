create table if not exists projects (
  id text primary key default gen_random_uuid()::text,
  workspace text not null check (workspace in ('ef', 'qlc')),
  name text not null check (char_length(name) between 1 and 100),
  color int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists projects_workspace_name on projects (workspace, lower(name));
create table if not exists tasks (
  id text primary key default gen_random_uuid()::text,
  workspace text not null check (workspace in ('ef', 'qlc')),
  project_id text references projects (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  owner text not null default 'none' check (owner in ('babs', 'david', 'both', 'none')),
  status text not null default 'todo' check (status in ('todo', 'progress', 'done')),
  start_date date,
  due_date date,
  notes text not null default '',
  done_at date,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_dates_in_order check (start_date is null or due_date is null or due_date >= start_date)
);
create index if not exists tasks_workspace on tasks (workspace);
create index if not exists tasks_project on tasks (project_id);
