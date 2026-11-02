-- Drop unused queue / public-queue RPCs. Admin no longer reorders via these;
-- public queue UI only calls get_public_queue. Status moves go through update_order.

DROP FUNCTION IF EXISTS public.list_queue_orders();
DROP FUNCTION IF EXISTS public.reorder_queue_orders(uuid[]);
DROP FUNCTION IF EXISTS public.reorder_status_orders(text, uuid[]);
DROP FUNCTION IF EXISTS public.move_order_in_status(uuid, text, integer);
DROP FUNCTION IF EXISTS public.get_public_queue_order(bigint);
