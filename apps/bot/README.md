## Bot Environment Notes

Tournament website webhook sync uses:

- `TOURNAMENT_WEBHOOK_URL` (expected endpoint path: `/api/webhooks/tournament`)
- `TOURNAMENT_WEBHOOK_SECRET` (sent as `X-Webhook-Secret`)

If `TOURNAMENT_WEBHOOK_URL` still points to `/api/tournament/update`, the bot will normalize it to `/api/webhooks/tournament` at runtime and log a warning once.

## Prisma setup for panel lifecycle models

Before starting the bot on a fresh environment or after pulling schema changes:

1. `npm run prisma:migrate:deploy`
2. `npm run prisma:generate`

Or run both with:

- `npm run prisma:setup`
