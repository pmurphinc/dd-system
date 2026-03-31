## Bot Environment Notes

Tournament website webhook sync uses:

- `TOURNAMENT_WEBHOOK_URL` (expected endpoint path: `/api/webhooks/tournament`)
- `TOURNAMENT_WEBHOOK_SECRET` (sent as `X-Webhook-Secret`)

If `TOURNAMENT_WEBHOOK_URL` still points to `/api/tournament/update`, the bot will normalize it to `/api/webhooks/tournament` at runtime and log a warning once.
