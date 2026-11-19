// Database access. Production uses Neon over HTTPS (DATABASE_URL).
// Local testing with no DATABASE_URL uses an embedded Postgres (PGlite) in .local-db/.
let run;

async function init() {
  if (run) return run;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    run = (text, params = []) => sql.query(text, params);
  } else {
    if (process.env.VERCEL) throw new Error('DATABASE_URL is not set');
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(process.env.LOCAL_DB_DIR || new URL('../.local-db', import.meta.url).pathname);
    run = async (text, params = []) => (await db.query(text, params)).rows;
  }
  return run;
}

export async function query(text, params = []) {
  const q = await init();
  return q(text, params);
}

// Runs several statements separated by a semicolon at the end of a line (used by the migrate script).
export async function exec(sqlText) {
  const parts = sqlText.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) await query(p);
}
