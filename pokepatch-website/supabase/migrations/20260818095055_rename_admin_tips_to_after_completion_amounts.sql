-- Rename admin_tips → after_completion_amounts (post-complete price changes:
-- tip, rounding, etc. — not customer-quote adjustments).

ALTER TABLE public.orders
  RENAME COLUMN admin_tips TO after_completion_amounts;

COMMENT ON COLUMN public.orders.after_completion_amounts IS
  'Admin-only price changes after the order is complete (tip, rounding, etc.; not on customer quote). Array of {id, description, amount_dollars}.';

-- Re-assert column-level deny for customer roles (rename keeps privileges, but keep explicit).
REVOKE SELECT (after_completion_amounts) ON public.orders FROM anon;
REVOKE SELECT (after_completion_amounts) ON public.orders FROM authenticated;
