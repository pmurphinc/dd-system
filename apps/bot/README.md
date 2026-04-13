## Bot Environment Notes

Tournament website webhook sync uses:

- `TOURNAMENT_WEBHOOK_URL` (expected endpoint path: `/api/webhooks/tournament`)
- `TOURNAMENT_WEBHOOK_SECRET` (sent as `X-Webhook-Secret`)

If `TOURNAMENT_WEBHOOK_URL` still points to `/api/tournament/update`, the bot will normalize it to `/api/webhooks/tournament` at runtime and log a warning once.

## Prisma setup for panel lifecycle models

### Why Prisma `P3005` happens in this repo

`prisma migrate deploy` expects migration history in `_prisma_migrations`.

In this repo, many local bot databases were created before migration history was introduced (for example via older `prisma db push` usage). Those SQLite files already contain application tables, so Prisma sees a non-empty schema with no applied migration history and throws `P3005` (`The database schema is not empty`).

### Migration layout in this repo

- `prisma/migrations/20260413_000000_baseline` is the baseline snapshot of the pre-panel schema.
- `prisma/migrations/20260413_panel_lifecycle` adds:
  - `ActivePanelMessage`
  - `SavedPanelContext`

### Safe baseline + migrate workflow (existing SQLite DB)

Run from repository root in **Windows PowerShell**:

1. (Optional but recommended) inspect current DB target and tables:

   ```powershell
   $env:DATABASE_URL = "file:./dev.db"
   node -e "const Database=require('better-sqlite3');const db=new Database('dev.db');const rows=db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all();console.table(rows);"
   ```

2. Mark the baseline migration as already applied for this existing DB (no data changes):

   ```powershell
   npm run prisma:baseline
   ```

3. Apply pending migrations (this creates panel lifecycle tables if missing):

   ```powershell
   npm run prisma:migrate:deploy
   ```

4. Regenerate Prisma client:

   ```powershell
   npm run prisma:generate
   ```

Or run step 3 and 4 together:

```powershell
npm run prisma:migrate:local
```

### New/fresh database workflow

For a brand new SQLite file (empty DB), just run:

```powershell
npm run prisma:migrate:local
```

Prisma will execute the baseline migration SQL, then `20260413_panel_lifecycle`, and generate the client.

### Applying future migrations safely

1. Create migration in development (`prisma migrate dev ...`).
2. Commit the new migration directory.
3. On existing environments, apply with `npm run prisma:migrate:deploy` (baseline only once per legacy DB).
4. Regenerate client with `npm run prisma:generate`.

### Database path resolution

- The bot and Prisma CLI resolve SQLite `DATABASE_URL` values relative to the repository root.
- If `DATABASE_URL` is unset, both use: `file:<repo-root>/dev.db`.
- On startup the bot logs the resolved datasource path under `[db] Prisma datasource resolved` so you can confirm the exact file.
