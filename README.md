# Task Tracker (Babs + David)

One tracker with two sections: **Embraced:Fully** and **Quick Lift Cards LLC**. Each section has projects and tasks, shown as List, Board or Gantt. Quick Lift Cards is blue, Embraced:Fully is green.

## How it works
- `public/` is the page (plain HTML, CSS, JavaScript).
- `api/` holds the Vercel functions: `data`, `tasks`, `projects`, `enter`, `signout`.
- `lib/` holds the database, sign-in and input checks. `lib/schema.sql` creates the tables.
- Data lives in a Neon Postgres database.

## Deploying
The repository is connected to Vercel. Pushing to `main` deploys to https://ef-qlc-tracker.vercel.app automatically.

## Signing in
There are no passwords. Babs and David each have a personal link, `/enter/<token>`, that sets a cookie for 90 days.
To replace a link, change that person's token in the Vercel environment variables and redeploy. To sign everyone out, change `SESSION_SECRET`.

## Environment variables (Vercel)
| Name | What it is |
| --- | --- |
| `DATABASE_URL` | Neon connection string (added by the Neon integration) |
| `ACCESS_TOKEN_BABS` | Babs's personal link token (long random string) |
| `ACCESS_TOKEN_DAVID` | David's personal link token |
| `SESSION_SECRET` | At least 32 random characters; signs the cookie |

## Running it on a Mac
```
npm install
npm run migrate   # creates the tables (embedded test database unless DATABASE_URL is set)
npm run dev       # http://localhost:3412
```
Put test values for the three secrets in `.env.local` (ignored by git).
