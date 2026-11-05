# Supabase Edge Function: `notify-order-status`

Emails the customer when **`orders.status` or `orders.pending_kind`** changes.

Per-card status flips do **not** notify. Discord is not posted here — `notify` still handles new-order INSERT only.

## When it fires

Postgres trigger `orders_status_notify_customer` (`AFTER UPDATE OF status, pending_kind`) POSTs `{ record, old_record }` via `pg_net`.

Typical sources:

- First before photo → order `in_progress`
- Last after photo / all cards completed → order `ready`
- Admin editor save (including auto-advance from card statuses)
- Discord quoting flipping pending quote → pending drop-off

Skipped:

- Owner portfolio (`display_id = -1`)
- No customer email
- Unchanged customer-facing label
- `pending` → `canceled` (cron: `cancel-stale-quotes`; admin editor save still notifies)
- Kanban drag (`update_order_kanban`) — Move only is silent; Move & notify is the optional email
- The same from → to status email already sent in the last 10 minutes (wooper / admin-api backups)

## Local

`scripts/retarget-local-notify-triggers.sh` points this trigger at the local function URL, same as `orders` INSERT → `notify`.
