-- Backfill a new/incomplete customer_profiles name from the most recent
-- order placed under the same email, so an account created after (or without)
-- the localStorage pending-profile snapshot still gets a name.
CREATE OR REPLACE FUNCTION public.sync_profile_name_from_latest_order()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_customer_name text;
  v_existing_first_name text;
  v_existing_last_name text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  v_email := lower(trim(coalesce(auth.email(), '')));
  if v_email = '' then
    return jsonb_build_object('updated', false);
  end if;

  select first_name, last_name into v_existing_first_name, v_existing_last_name
  from public.customer_profiles
  where user_id = v_user_id;

  -- Never clobber a name the customer already has on their account.
  if coalesce(v_existing_first_name, '') <> '' or coalesce(v_existing_last_name, '') <> '' then
    return jsonb_build_object('updated', false);
  end if;

  select
    nullif(trim(coalesce(o.first_name, '')), ''),
    nullif(trim(coalesce(o.last_name, '')), ''),
    nullif(trim(coalesce(o.customer_name, '')), '')
  into v_first_name, v_last_name, v_customer_name
  from public.orders o
  where lower(o.customer_email) = v_email
    and (
      coalesce(o.first_name, '') <> ''
      or coalesce(o.last_name, '') <> ''
      or coalesce(o.customer_name, '') <> ''
    )
  order by o.created_at desc
  limit 1;

  -- Pre-split orders only stored customer_name; treat it as first name.
  if coalesce(v_first_name, '') = '' and coalesce(v_last_name, '') = '' then
    v_first_name := v_customer_name;
  end if;

  if coalesce(v_first_name, '') = '' and coalesce(v_last_name, '') = '' then
    return jsonb_build_object('updated', false);
  end if;

  insert into public.customer_profiles (user_id, first_name, last_name, updated_at)
  values (v_user_id, v_first_name, v_last_name, now())
  on conflict (user_id) do update
  set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    updated_at = now()
  where
    coalesce(public.customer_profiles.first_name, '') = ''
    and coalesce(public.customer_profiles.last_name, '') = '';

  return jsonb_build_object(
    'updated', true,
    'first_name', v_first_name,
    'last_name', v_last_name
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.sync_profile_name_from_latest_order() FROM public;
GRANT EXECUTE ON FUNCTION public.sync_profile_name_from_latest_order() TO authenticated;
