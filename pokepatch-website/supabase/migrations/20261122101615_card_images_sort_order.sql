-- Display order for card photos. Values are 0-based within each card + group
-- (customer / before / after). Legacy progress/final types share before/after.

ALTER TABLE public.card_images
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        card_id,
        CASE
          WHEN image_type IN ('before', 'progress_front', 'progress_back') THEN 'before'
          WHEN image_type IN ('after', 'final_front', 'final_back') THEN 'after'
          ELSE 'customer'
        END
      ORDER BY id
    ) - 1 AS rn
  FROM public.card_images
)
UPDATE public.card_images AS ci
SET sort_order = ranked.rn
FROM ranked
WHERE ci.id = ranked.id;

CREATE INDEX IF NOT EXISTS card_images_card_sort_order_idx
  ON public.card_images (card_id, sort_order, id);

CREATE OR REPLACE FUNCTION public.get_my_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_contacts jsonb;
  v_cards jsonb;
  v_quote_items jsonb;
  v_queue_position integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found or access denied';
  END IF;

  IF v_order.status = 'new' THEN
    v_queue_position := public.todo_queue_position(v_order.id);
  ELSE
    v_queue_position := null;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'contact_type', c.contact_type,
      'value', c.value
    )
    ORDER BY c.id
  ) INTO v_contacts
  FROM public.contacts c
  WHERE c.order_id = v_order.id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', card.id,
      'card_name', card.card_name,
      'set_name', card.set_name,
      'description', card.description,
      'damage_tags', coalesce(card.damage_tags, '{}'::text[]),
      'admin_note', card.admin_note,
      'status', card.status,
      'is_priority', card.is_priority,
      'queue_speed', card.queue_speed,
      'images', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ci.id,
            'image_type', ci.image_type,
            'storage_path', ci.storage_path,
            'sort_order', ci.sort_order
          )
          ORDER BY ci.sort_order ASC NULLS LAST, ci.id
        )
        FROM public.card_images ci
        WHERE ci.card_id = card.id
      )
    )
    ORDER BY card.sort_order, card.id
  ) INTO v_cards
  FROM public.cards card
  WHERE card.order_id = v_order.id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', qi.id,
      'sort_order', qi.sort_order,
      'card_id', qi.card_id,
      'card_name', qi.card_name,
      'set_name', qi.set_name,
      'service_key', qi.service_key,
      'service_label', qi.service_label,
      'quote_base_amount', qi.quote_base_amount,
      'high_value_surcharge', qi.high_value_surcharge
    )
    ORDER BY qi.sort_order, qi.id
  ) INTO v_quote_items
  FROM public.order_quote_items qi
  WHERE qi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'customer_email', v_order.customer_email,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes,
    'photos_drive_url', v_order.photos_drive_url,
    'preferred_contact_type', v_order.preferred_contact_type,
    'preferred_contact_value', v_order.preferred_contact_value,
    'quote_bulk_counts', v_order.quote_bulk_counts,
    'quote_override_label', v_order.quote_override_label,
    'quote_override_amount', v_order.quote_override_amount,
    'is_priority', v_order.is_priority,
    'queue_speed', v_order.queue_speed,
    'status', v_order.status,
    'pending_kind', v_order.pending_kind,
    'queue_position', v_queue_position,
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
END;
$function$;
