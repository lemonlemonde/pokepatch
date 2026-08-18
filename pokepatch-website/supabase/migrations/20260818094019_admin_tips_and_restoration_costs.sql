-- Admin-only tip / restoration-spend ledger on orders.
-- Not part of the customer quote; used for admin order page + earned totals.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS admin_tips jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS restoration_costs jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.orders.admin_tips IS
  'Admin-only tips after restoration (not on customer quote). Array of {id, description, amount_dollars}.';

COMMENT ON COLUMN public.orders.restoration_costs IS
  'Admin-only money spent during restoration (not on customer quote). Array of {id, description, amount_dollars}.';

-- Customers can SELECT their orders; keep these columns admin/service only.
REVOKE SELECT (admin_tips, restoration_costs) ON public.orders FROM anon;
REVOKE SELECT (admin_tips, restoration_costs) ON public.orders FROM authenticated;
