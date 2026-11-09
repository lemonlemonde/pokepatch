-- Stamp when each order is dragged into To do. Priority and regular To-do
-- lanes sort independently by that time, so promoting a waiting order inserts
-- it where it would have sat if it had been priority from the start.
-- In progress still sorts by status_changed_at (append on drag-in).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS todo_entered_at timestamptz;

COMMENT ON COLUMN public.orders.todo_entered_at IS
  'When this order last entered To do (status=new). Priority and regular To-do lanes sort by this independently.';

CREATE INDEX IF NOT EXISTS orders_todo_queue_idx
  ON public.orders (
    is_priority,
    todo_entered_at ASC NULLS LAST,
    created_at ASC NULLS LAST,
    id ASC
  )
  WHERE status = 'new';

-- Existing To-do rows: status_changed_at is when they entered this column.
UPDATE public.orders
SET todo_entered_at = COALESCE(status_changed_at, created_at)
WHERE status = 'new'
  AND todo_entered_at IS NULL;

CREATE OR REPLACE FUNCTION public.orders_touch_status_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := COALESCE(NEW.status_changed_at, NEW.created_at, now());
    IF NEW.status = 'new' THEN
      NEW.todo_entered_at := COALESCE(
        NEW.todo_entered_at,
        NEW.status_changed_at,
        NEW.created_at,
        now()
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'new' THEN
      NEW.todo_entered_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Global To-do place: priority first, then todo_entered_at (same as admin To do).
CREATE OR REPLACE FUNCTION public.todo_queue_position(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT q.pos
  FROM (
    SELECT
      id,
      row_number() OVER (
        ORDER BY
          is_priority DESC,
          COALESCE(todo_entered_at, status_changed_at, created_at) ASC NULLS LAST,
          created_at ASC NULLS LAST,
          id ASC
      )::integer AS pos
    FROM public.orders
    WHERE status = 'new'
  ) q
  WHERE q.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public.todo_queue_position(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.todo_queue_position(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_queue()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH board AS (
    SELECT
      o.id,
      o.display_id,
      o.status,
      o.is_priority,
      o.created_at,
      o.status_changed_at,
      o.todo_entered_at,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'card_name', c.card_name,
              'set_name', c.set_name,
              'catalog_card_name', c.catalog_card_name,
              'catalog_set_name', c.catalog_set_name,
              'catalog_image_url', c.catalog_image_url,
              'tcg_card_id', c.tcg_card_id,
              'damage_tags', COALESCE(c.damage_tags, '{}'::text[]),
              'sort_order', c.sort_order
            )
            ORDER BY c.sort_order ASC NULLS LAST, c.id ASC
          )
          FROM public.cards c
          WHERE c.order_id = o.id
            AND c.status IS DISTINCT FROM 'canceled'
        ),
        '[]'::jsonb
      ) AS cards,
      (
        SELECT count(*)::integer
        FROM public.cards c
        WHERE c.order_id = o.id
          AND c.status IS DISTINCT FROM 'canceled'
      ) AS card_count
    FROM public.orders o
    WHERE o.status IN ('new', 'in_progress')
  ),
  priority_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY
          COALESCE(b.todo_entered_at, b.status_changed_at, b.created_at) ASC NULLS LAST,
          b.created_at ASC NULLS LAST,
          b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'new' AND b.is_priority = true
  ),
  regular_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY
          COALESCE(b.todo_entered_at, b.status_changed_at, b.created_at) ASC NULLS LAST,
          b.created_at ASC NULLS LAST,
          b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'new' AND b.is_priority = false
  ),
  in_progress_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY
          b.is_priority DESC,
          COALESCE(b.status_changed_at, b.created_at) ASC NULLS LAST,
          b.created_at ASC NULLS LAST,
          b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'in_progress'
  )
  SELECT jsonb_build_object(
    'in_progress',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'display_id', i.display_id,
            'lane_position', i.lane_position,
            'card_count', i.card_count,
            'is_priority', i.is_priority,
            'cards', i.cards
          )
          ORDER BY i.lane_position ASC
        )
        FROM in_progress_lane i
      ),
      '[]'::jsonb
    ),
    'priority',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'display_id', p.display_id,
            'lane_position', p.lane_position,
            'card_count', p.card_count,
            'is_priority', true,
            'cards', p.cards
          )
          ORDER BY p.lane_position ASC
        )
        FROM priority_lane p
      ),
      '[]'::jsonb
    ),
    'regular',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'display_id', r.display_id,
            'lane_position', r.lane_position,
            'card_count', r.card_count,
            'is_priority', false,
            'cards', r.cards
          )
          ORDER BY r.lane_position ASC
        )
        FROM regular_lane r
      ),
      '[]'::jsonb
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_orders jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'display_id', o.display_id,
      'created_at', o.created_at,
      'customer_name', o.customer_name,
      'delivery_method', o.delivery_method,
      'status', o.status,
      'pending_kind', o.pending_kind,
      'is_priority', o.is_priority,
      'completed_at', o.completed_at,
      'status_changed_at', o.status_changed_at,
      'todo_entered_at', o.todo_entered_at,
      'card_count', (
        select count(*)
        from public.cards c
        where c.order_id = o.id
      ),
      'queue_position', (
        case
          when o.status = 'new' then public.todo_queue_position(o.id)
          else null
        end
      ),
      'has_unread_messages', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'has_new_updates', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'has_admin_photos', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'preview_paths', (
        select coalesce(jsonb_agg(t.storage_path order by t.rn), '[]'::jsonb)
        from (
          select ci.storage_path,
                 row_number() over (order by c.sort_order, c.id, ci.id) as rn
          from public.cards c
          join public.card_images ci on ci.card_id = c.id
          where c.order_id = o.id and ci.image_type = 'customer'
        ) t
        where t.rn <= 4
      ),
      'image_count', (
        select count(*)
        from public.cards c
        join public.card_images ci on ci.card_id = c.id
        where c.order_id = o.id and ci.image_type = 'customer'
      )
    )
    order by o.created_at desc
  ) into v_orders
  from public.orders o
  where o.user_id = v_user_id;

  return coalesce(v_orders, '[]'::jsonb);
end;
$function$;

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
      'images', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ci.id,
            'image_type', ci.image_type,
            'storage_path', ci.storage_path
          )
          ORDER BY ci.id
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
    'status', v_order.status,
    'pending_kind', v_order.pending_kind,
    'queue_position', v_queue_position,
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.split_mixed_priority_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source public.orders%rowtype;
  v_new public.orders%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_has_priority boolean;
  v_has_non_priority boolean;
  v_reconcile_priority boolean;
  v_moved_ids uuid[];
  v_contact public.contacts%rowtype;
  v_bulk jsonb;
  v_adjustments jsonb;
  v_without_priority jsonb;
  v_card_hv jsonb;
  v_stay_hv jsonb;
  v_move_hv jsonb;
  v_stay_bulk jsonb;
  v_move_bulk jsonb;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order id is required';
  END IF;

  SELECT * INTO v_source
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.cards c
      WHERE c.order_id = p_order_id AND c.is_priority = true
    ),
    EXISTS (
      SELECT 1 FROM public.cards c
      WHERE c.order_id = p_order_id AND c.is_priority = false
    )
  INTO v_has_priority, v_has_non_priority;

  IF NOT (v_has_priority AND v_has_non_priority) THEN
    -- Homogeneous (or empty — empty should not happen): reconcile order flag.
    SELECT EXISTS (
      SELECT 1
      FROM public.cards c
      WHERE c.order_id = p_order_id
        AND c.is_priority = true
        AND c.status IS DISTINCT FROM 'canceled'
    )
    INTO v_reconcile_priority;

    UPDATE public.orders
    SET is_priority = v_reconcile_priority
    WHERE id = p_order_id
      AND is_priority IS DISTINCT FROM v_reconcile_priority;

    PERFORM public.sync_order_priority_quote_adjustment(p_order_id);

    RETURN jsonb_build_object(
      'split', false,
      'id', p_order_id
    );
  END IF;

  -- Mixed: create sibling priority order and move priority cards onto it.
  -- Copy todo_entered_at / status_changed_at so the new priority order keeps
  -- the original To-do wait time instead of appending at the end of that lane.
  INSERT INTO public.orders (
    id,
    user_id,
    first_name,
    last_name,
    customer_name,
    customer_email,
    delivery_method,
    general_notes,
    heard_about_source,
    preferred_contact_type,
    preferred_contact_value,
    status,
    pending_kind,
    photos_drive_url,
    quote_override_label,
    quote_override_amount,
    after_completion_amounts,
    restoration_costs,
    status_changed_at,
    todo_entered_at,
    is_priority,
    quote_bulk_counts
  )
  SELECT
    v_new_id,
    s.user_id,
    s.first_name,
    s.last_name,
    s.customer_name,
    s.customer_email,
    s.delivery_method,
    s.general_notes,
    s.heard_about_source,
    s.preferred_contact_type,
    s.preferred_contact_value,
    s.status,
    s.pending_kind,
    s.photos_drive_url,
    s.quote_override_label,
    s.quote_override_amount,
    s.after_completion_amounts,
    s.restoration_costs,
    s.status_changed_at,
    s.todo_entered_at,
    true,
    null
  FROM public.orders s
  WHERE s.id = p_order_id
  RETURNING * INTO v_new;

  INSERT INTO public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name, delivery_method, general_notes
  )
  VALUES (
    v_new.id,
    v_new.display_id,
    v_new.created_at,
    v_new.first_name,
    v_new.last_name,
    v_new.customer_name,
    v_new.delivery_method,
    v_new.general_notes
  );

  -- Duplicate live contacts onto the new order (skip contacts_original).
  FOR v_contact IN
    SELECT * FROM public.contacts WHERE order_id = p_order_id
  LOOP
    INSERT INTO public.contacts (order_id, contact_type, value)
    VALUES (v_new_id, v_contact.contact_type, v_contact.value);
  END LOOP;

  SELECT coalesce(array_agg(c.id), '{}'::uuid[])
  INTO v_moved_ids
  FROM public.cards c
  WHERE c.order_id = p_order_id
    AND c.is_priority = true;

  IF coalesce(array_length(v_moved_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'mixed priority split found no priority cards';
  END IF;

  -- Remainder must keep at least one card (mix implies non-priority exist).
  IF NOT EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.order_id = p_order_id
      AND c.is_priority = false
  ) THEN
    RAISE EXCEPTION 'mixed priority split would leave original order empty';
  END IF;

  UPDATE public.cards
  SET order_id = v_new_id
  WHERE id = ANY (v_moved_ids);

  UPDATE public.cards_original
  SET order_id = v_new_id
  WHERE id = ANY (v_moved_ids);

  -- Move quote lines for moved cards (prefer card_id; name/set for legacy nulls).
  UPDATE public.order_quote_items qi
  SET order_id = v_new_id
  WHERE qi.order_id = p_order_id
    AND (
      qi.card_id = ANY (v_moved_ids)
      OR (
        qi.card_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.cards c
          WHERE c.id = ANY (v_moved_ids)
            AND lower(trim(c.card_name)) = lower(trim(qi.card_name))
            AND lower(trim(coalesce(c.set_name, ''))) = lower(trim(coalesce(qi.set_name, '')))
        )
      )
    );

  -- Partition quote_bulk_counts.card_hv; strip Priority service (rebuild via sync).
  v_bulk := v_source.quote_bulk_counts;

  IF v_bulk IS NULL OR jsonb_typeof(v_bulk) <> 'object' THEN
    v_adjustments := '[]'::jsonb;
    v_card_hv := '[]'::jsonb;
  ELSE
    v_adjustments := coalesce(v_bulk -> 'adjustments', '[]'::jsonb);
    IF jsonb_typeof(v_adjustments) <> 'array' THEN
      v_adjustments := '[]'::jsonb;
    END IF;
    IF jsonb_typeof(v_bulk -> 'card_hv') = 'array' THEN
      v_card_hv := v_bulk -> 'card_hv';
    ELSE
      v_card_hv := '[]'::jsonb;
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_without_priority
  FROM jsonb_array_elements(v_adjustments) elem
  WHERE lower(trim(coalesce(elem ->> 'description', '')))
        IS DISTINCT FROM 'priority service';

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_stay_hv
  FROM jsonb_array_elements(v_card_hv) elem
  WHERE nullif(trim(coalesce(elem ->> 'card_id', '')), '') IS NOT NULL
    AND NOT (elem ->> 'card_id' = ANY (SELECT mid::text FROM unnest(v_moved_ids) mid));

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_move_hv
  FROM jsonb_array_elements(v_card_hv) elem
  WHERE nullif(trim(coalesce(elem ->> 'card_id', '')), '') IS NOT NULL
    AND elem ->> 'card_id' = ANY (SELECT mid::text FROM unnest(v_moved_ids) mid);

  -- Other adjustments stay on the original; new order gets moved HV only.
  IF jsonb_array_length(v_without_priority) = 0
     AND jsonb_array_length(v_stay_hv) = 0 THEN
    v_stay_bulk := null;
  ELSE
    v_stay_bulk := jsonb_build_object('version', 2);
    IF jsonb_array_length(v_without_priority) > 0 THEN
      v_stay_bulk := jsonb_set(v_stay_bulk, '{adjustments}', v_without_priority, true);
    END IF;
    IF jsonb_array_length(v_stay_hv) > 0 THEN
      v_stay_bulk := jsonb_set(v_stay_bulk, '{card_hv}', v_stay_hv, true);
    END IF;
  END IF;

  IF jsonb_array_length(v_move_hv) = 0 THEN
    v_move_bulk := null;
  ELSE
    v_move_bulk := jsonb_build_object(
      'version', 2,
      'card_hv', v_move_hv
    );
  END IF;

  UPDATE public.orders
  SET
    is_priority = false,
    quote_bulk_counts = v_stay_bulk
  WHERE id = p_order_id;

  UPDATE public.orders
  SET
    is_priority = true,
    quote_bulk_counts = v_move_bulk
  WHERE id = v_new_id;

  PERFORM public.sync_order_priority_quote_adjustment(p_order_id);
  PERFORM public.sync_order_priority_quote_adjustment(v_new_id);

  SELECT * INTO v_source FROM public.orders WHERE id = p_order_id;
  SELECT * INTO v_new FROM public.orders WHERE id = v_new_id;

  RETURN jsonb_build_object(
    'split', true,
    'id', v_source.id,
    'display_id', v_source.display_id,
    'new_order_id', v_new.id,
    'new_display_id', v_new.display_id
  );
END;
$function$;
