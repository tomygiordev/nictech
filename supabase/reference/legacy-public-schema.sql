-- Fuente: A:/nictech-backup/20261116-final/schema.sql (2026-11-16).
-- SOLO REFERENCIA: no es una migración y no debe aplicarse a ningún entorno.
-- Extracción literal de bloques del esquema public, sin datos de tablas.
-- Tablas: brands, capacities, carousel_settings, categories, colors, dollar_settings, hero_banners, inventory_movements, models, orders, payment_audit_log, posts, product_clicks, product_variants, products, repair_logs, repair_statuses, repairs.
-- Funciones: count_repairs_by_status(text), decrement_stock(uuid, integer), get_product_click_counts(), get_repair_by_tracking_code(text), get_repair_tracking(text), process_approved_order(text, text, numeric, jsonb, jsonb, text, text, text, text), register_repair_private_media(text, integer, text, text, bigint, text), respond_repair_quote(text, text, text), restore_expired_promos(), update_updated_at_column().
-- Incluye el tipo public.repair_status y los índices, constraints, políticas RLS,
-- triggers, permisos y privilegios por defecto de esos objetos. Las referencias
-- a auth, erp, extensions y roles gestionados requieren el entorno Supabase.

SET check_function_bodies = false;
SET search_path = '';

--
-- Name: repair_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.repair_status AS ENUM (
    'Recibido',
    'Diagnóstico',
    'Repuestos',
    'Reparación',
    'Finalizado'
);


ALTER TYPE public.repair_status OWNER TO postgres;

--
-- Name: count_repairs_by_status(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.count_repairs_by_status(status_name text) RETURNS bigint
    LANGUAGE sql STABLE
    AS $$
  SELECT COUNT(*) FROM public.repairs WHERE status = status_name;
$$;


ALTER FUNCTION public.count_repairs_by_status(status_name text) OWNER TO postgres;

--
-- Name: decrement_stock(uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decrement_stock(row_id uuid, qty integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.products
  SET stock = GREATEST(stock - qty, 0)
  WHERE id = row_id;
END;
$$;


ALTER FUNCTION public.decrement_stock(row_id uuid, qty integer) OWNER TO postgres;

--
-- Name: get_product_click_counts(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_product_click_counts() RETURNS TABLE(product_id uuid, click_count bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT product_id, COUNT(*) as click_count
  FROM public.product_clicks
  WHERE clicked_at > now() - interval '30 days'
  GROUP BY product_id
  ORDER BY click_count DESC;
$$;


ALTER FUNCTION public.get_product_click_counts() OWNER TO postgres;

--
-- Name: get_repair_by_tracking_code(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_repair_by_tracking_code(search_code text) RETURNS TABLE(id uuid, tracking_code text, client_name text, client_dni text, device_brand text, device_model text, status public.repair_status, locality text, notes text, problem_description text, created_at timestamp with time zone, repair_logs json)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.tracking_code,
    r.client_name,
    r.client_dni,
    r.device_brand,
    r.device_model,
    r.status,
    r.locality,
    r.notes,
    r.problem_description,
    r.created_at,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'id',         rl.id,
            'created_at', rl.created_at,
            'content',    rl.content,
            'is_public',  rl.is_public
          )
          ORDER BY rl.created_at ASC
        )
        FROM repair_logs rl
        WHERE rl.repair_id = r.id
          AND rl.is_public = true
      ),
      '[]'::json
    ) AS repair_logs
  FROM repairs r
  WHERE
    -- Ensure it's not deleted (or null)
    (r.is_deleted IS NULL OR r.is_deleted = false)
    AND (
      -- Search by tracking code (case-insensitive)
      UPPER(r.tracking_code) = UPPER(search_code)
      -- Or search by DNI, stripping dots/spaces/dashes from the input
      OR r.client_dni = regexp_replace(search_code, '[.\s\-]', '', 'g')
    )
  ORDER BY r.created_at DESC
  LIMIT 5;
END;
$$;


ALTER FUNCTION public.get_repair_by_tracking_code(search_code text) OWNER TO postgres;

--
-- Name: get_repair_tracking(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_repair_tracking(tracking_token text) RETURNS TABLE(order_code text, status_code text, status_name text, public_message text, status_at timestamp with time zone, opened_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'erp', 'extensions'
    AS $_$
begin
  if tracking_token is null or tracking_token!~'^[0-9a-f]{64}$' then raise exception using errcode='invalid_parameter_value',message='tracking token must be exactly 64 lowercase hexadecimal characters'; end if;
  return query select o.order_code,s.code,s.name,s.public_message,date_trunc('hour',e.occurred_at),date_trunc('day',o.opened_at)
  from erp.repair_tracking_tokens token join erp.repair_orders o on o.id=token.repair_order_id and o.organization_id=token.organization_id and o.branch_id=token.branch_id
  join lateral (select x.* from erp.repair_state_events x where x.repair_order_id=o.id and x.organization_id=o.organization_id order by x.event_sequence desc limit 1) e on true
  join erp.repair_statuses s on s.id=e.status_id and s.organization_id=e.organization_id
  where token.token_digest=encode(extensions.digest(convert_to(tracking_token,'UTF8'),'sha256'),'hex') and token.revoked_at is null and token.expires_at>now();
end;
$_$;


ALTER FUNCTION public.get_repair_tracking(tracking_token text) OWNER TO postgres;

--
-- Name: process_approved_order(text, text, numeric, jsonb, jsonb, text, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.process_approved_order(p_payment_id text, p_status text, p_total numeric, p_items jsonb, p_payer jsonb, p_payment_method_id text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_device_fingerprint text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_quantity INT;
  v_order_id UUID;
  v_previous_status TEXT;
  v_result JSONB := '{"success": true}'::JSONB;
BEGIN
  -- Check if order already exists to get previous status
  SELECT id, status INTO v_order_id, v_previous_status
  FROM orders WHERE payment_id = p_payment_id;

  -- 1. Upsert the order (atomic)
  INSERT INTO orders (payment_id, status, total, items, payer, payment_method_id, ip_address, user_agent, device_fingerprint, updated_at)
  VALUES (p_payment_id, p_status, p_total, p_items, p_payer, p_payment_method_id, p_ip_address, p_user_agent, p_device_fingerprint, NOW())
  ON CONFLICT (payment_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    total = EXCLUDED.total,
    items = EXCLUDED.items,
    payer = EXCLUDED.payer,
    payment_method_id = EXCLUDED.payment_method_id,
    ip_address = COALESCE(EXCLUDED.ip_address, orders.ip_address),
    user_agent = COALESCE(EXCLUDED.user_agent, orders.user_agent),
    device_fingerprint = COALESCE(EXCLUDED.device_fingerprint, orders.device_fingerprint),
    updated_at = NOW()
  RETURNING id INTO v_order_id;

  -- 2. Log to audit table (state change history)
  INSERT INTO payment_audit_log (order_id, payment_id, previous_status, new_status, source, ip_address, raw_data)
  VALUES (v_order_id, p_payment_id, v_previous_status, p_status, 'webhook', p_ip_address,
    jsonb_build_object('total', p_total, 'payment_method', p_payment_method_id, 'payer', p_payer)
  );

  -- 3. Only decrement stock if status is 'approved' AND previous status was NOT 'approved'
  -- This prevents double stock decrement if webhook fires twice
  IF p_status = 'approved' AND (v_previous_status IS NULL OR v_previous_status != 'approved') THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'id')::UUID;
      v_quantity := COALESCE((v_item->>'quantity')::INT, 1);

      IF v_product_id IS NOT NULL THEN
        UPDATE products
        SET stock = stock - v_quantity,
            updated_at = NOW()
        WHERE id = v_product_id;

        IF NOT FOUND THEN
          RAISE WARNING 'Product % not found, skipping stock update', v_product_id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;

EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'Stock insuficiente para completar la orden. Transaccion cancelada.';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error procesando orden: %', SQLERRM;
END;
$$;


ALTER FUNCTION public.process_approved_order(p_payment_id text, p_status text, p_total numeric, p_items jsonb, p_payer jsonb, p_payment_method_id text, p_ip_address text, p_user_agent text, p_device_fingerprint text) OWNER TO postgres;

--
-- Name: register_repair_private_media(text, integer, text, text, bigint, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.register_repair_private_media(upload_token text, file_slot integer, client_filename text, mime_type text, byte_size bigint, sha256_digest text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'erp', 'extensions'
    AS $_$
declare token_row erp.repair_media_upload_tokens%rowtype; declare media_id uuid; declare used_count bigint; declare used_bytes numeric; declare canonical_path text; declare extension text;
begin
  if upload_token is null or upload_token!~'^[0-9a-f]{64}$' or file_slot is null or file_slot not between 1 and 100
    or nullif(btrim(client_filename),'') is null or length(client_filename)>255 or mime_type is null or mime_type not in('image/jpeg','image/png','image/webp','video/mp4')
    or byte_size is null or byte_size<=0 or byte_size>1073741824 or sha256_digest is null or sha256_digest!~'^[0-9a-f]{64}$' then raise exception using errcode='invalid_parameter_value',message='bounded media metadata and a 256-bit token are required'; end if;
  select * into token_row from erp.repair_media_upload_tokens where token_digest=encode(extensions.digest(convert_to(upload_token,'UTF8'),'sha256'),'hex') for update;
  if token_row.id is null or token_row.revoked_at is not null or token_row.expires_at<=now() or mime_type<>all(token_row.allowed_mime_types) then raise exception using errcode='object_not_in_prerequisite_state',message='upload token or file metadata is invalid'; end if;
  select count(*),coalesce(sum(m.byte_size),0) into used_count,used_bytes
  from erp.repair_private_media m join erp.repair_media_upload_tokens family_token
    on family_token.id=m.upload_token_id and family_token.organization_id=m.organization_id
  where family_token.organization_id=token_row.organization_id and family_token.token_family_id=token_row.token_family_id;
  if used_count+1>token_row.max_file_count or used_bytes+byte_size>token_row.max_total_bytes then raise exception using errcode='check_violation',message='upload token limits exceeded'; end if;
  extension:=case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' when 'video/mp4' then '.mp4' end;
  canonical_path:=format('repair-private/%s/%s/%s/%s%s',token_row.organization_id,token_row.repair_order_id,token_row.id,lpad(file_slot::text,3,'0'),extension);
  insert into erp.repair_private_media(organization_id,branch_id,repair_order_id,upload_token_id,file_slot,object_path,client_filename,mime_type,byte_size,sha256_digest) values(token_row.organization_id,token_row.branch_id,token_row.repair_order_id,token_row.id,file_slot,canonical_path,btrim(client_filename),mime_type,byte_size,sha256_digest) returning id into media_id; return media_id;
end; $_$;


ALTER FUNCTION public.register_repair_private_media(upload_token text, file_slot integer, client_filename text, mime_type text, byte_size bigint, sha256_digest text) OWNER TO postgres;

--
-- Name: respond_repair_quote(text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.respond_repair_quote(response_token text, decision text, customer_message text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'erp', 'extensions'
    AS $_$
declare token_row erp.repair_quote_response_tokens%rowtype; declare quote_row erp.repair_quotes%rowtype; declare event_id uuid;
begin
  if response_token is null or response_token!~'^[0-9a-f]{64}$' or decision is null or decision not in('approved','rejected') or length(coalesce(customer_message,''))>2000 then raise exception using errcode='invalid_parameter_value',message='valid quote response is required'; end if;
  select * into token_row from erp.repair_quote_response_tokens where token_digest=encode(extensions.digest(convert_to(response_token,'UTF8'),'sha256'),'hex');
  if token_row.id is null or token_row.used_at is not null or token_row.revoked_at is not null or token_row.expires_at<=now() then raise exception using errcode='object_not_in_prerequisite_state',message='quote response token is unavailable'; end if;
  select * into quote_row from erp.repair_quotes where id=token_row.quote_id and organization_id=token_row.organization_id;
  perform 1 from erp.repair_orders where id=quote_row.repair_order_id and organization_id=quote_row.organization_id for update;
  select * into token_row from erp.repair_quote_response_tokens where id=token_row.id for update;
  if token_row.used_at is not null or token_row.revoked_at is not null or token_row.expires_at<=now()
    or quote_row.issued_at is null or quote_row.expires_at<=now()
    or quote_row.id<>(select q.id from erp.repair_quotes q where q.repair_order_id=quote_row.repair_order_id order by q.version desc limit 1)
    or exists(select 1 from erp.repair_quote_response_events where repair_order_id=quote_row.repair_order_id) then raise exception using errcode='object_not_in_prerequisite_state',message='quote response token is unavailable'; end if;
  update erp.repair_quote_response_tokens set used_at=clock_timestamp() where id=token_row.id;
  insert into erp.repair_quote_response_events(organization_id,branch_id,repair_order_id,quote_id,token_id,decision,customer_message) values(token_row.organization_id,token_row.branch_id,quote_row.repair_order_id,token_row.quote_id,token_row.id,decision::erp.repair_quote_decision,nullif(btrim(customer_message),'')) returning id into event_id; return event_id;
end; $_$;


ALTER FUNCTION public.respond_repair_quote(response_token text, decision text, customer_message text) OWNER TO postgres;

--
-- Name: restore_expired_promos(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.restore_expired_promos() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.products
  SET
    price        = original_price,
    original_price   = NULL,
    sale_expires_at  = NULL
  WHERE
    original_price IS NOT NULL
    AND sale_expires_at IS NOT NULL
    AND sale_expires_at < now();
END;
$$;


ALTER FUNCTION public.restore_expired_promos() OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

--
-- Name: brands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


ALTER TABLE public.brands OWNER TO postgres;

--
-- Name: capacities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.capacities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.capacities OWNER TO postgres;

--
-- Name: carousel_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.carousel_settings (
    id integer DEFAULT 1 NOT NULL,
    interval_seconds numeric(5,1) DEFAULT 5 NOT NULL,
    enabled boolean DEFAULT true,
    CONSTRAINT single_row CHECK ((id = 1))
);


ALTER TABLE public.carousel_settings OWNER TO postgres;

--
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- Name: colors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.colors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    hex_color text
);


ALTER TABLE public.colors OWNER TO postgres;

--
-- Name: dollar_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dollar_settings (
    id integer DEFAULT 1 NOT NULL,
    rate numeric(10,2) DEFAULT 1000 NOT NULL,
    dollar_type text DEFAULT 'blue'::text NOT NULL,
    last_updated timestamp with time zone DEFAULT now(),
    CONSTRAINT single_row CHECK ((id = 1))
);


ALTER TABLE public.dollar_settings OWNER TO postgres;

--
-- Name: hero_banners; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hero_banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    image_url text NOT NULL,
    link_url text,
    alt_text text DEFAULT ''::text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.hero_banners OWNER TO postgres;

--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    variant_id uuid,
    type text NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric,
    channel text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_movements_type_check CHECK ((type = ANY (ARRAY['restock'::text, 'sale'::text])))
);


ALTER TABLE public.inventory_movements OWNER TO postgres;

--
-- Name: models; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


ALTER TABLE public.models OWNER TO postgres;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    total numeric(10,2) NOT NULL,
    items jsonb,
    payer jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address text,
    user_agent text,
    device_fingerprint text,
    payment_method_id text,
    stock_decremented boolean DEFAULT false,
    email_sent boolean DEFAULT false
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: payment_audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    payment_id text,
    previous_status text,
    new_status text NOT NULL,
    source text DEFAULT 'webhook'::text NOT NULL,
    raw_data jsonb,
    ip_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.payment_audit_log OWNER TO postgres;

--
-- Name: posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    title text NOT NULL,
    excerpt text NOT NULL,
    content text NOT NULL,
    image_url text NOT NULL,
    category text NOT NULL,
    read_time text DEFAULT '5 min'::text NOT NULL,
    author text DEFAULT 'Nictech'::text NOT NULL,
    is_published boolean DEFAULT true
);


ALTER TABLE public.posts OWNER TO postgres;

--
-- Name: product_clicks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_clicks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    clicked_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.product_clicks OWNER TO postgres;

--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    color text NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    image_url text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    is_active boolean DEFAULT true
);


ALTER TABLE public.product_variants OWNER TO postgres;

--
-- Name: products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    price numeric(10,2) NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    image_url text,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    category_id uuid,
    additional_images text[] DEFAULT '{}'::text[],
    tags text[] DEFAULT '{}'::text[],
    brand_id uuid,
    model_id uuid,
    color text,
    capacity text,
    condition text,
    is_active boolean DEFAULT true,
    original_price numeric,
    sale_expires_at timestamp with time zone,
    price_usd numeric(12,2),
    CONSTRAINT products_condition_check CHECK ((condition = ANY (ARRAY['Nuevo'::text, 'Usado'::text, 'Reacondicionado'::text]))),
    CONSTRAINT products_stock_non_negative CHECK ((stock >= 0))
);


ALTER TABLE public.products OWNER TO postgres;

--
-- Name: repair_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.repair_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    repair_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    is_public boolean DEFAULT true
);


ALTER TABLE public.repair_logs OWNER TO postgres;

--
-- Name: repair_statuses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.repair_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    icon text DEFAULT 'Circle'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.repair_statuses OWNER TO postgres;

--
-- Name: repairs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.repairs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tracking_code text NOT NULL,
    client_dni text NOT NULL,
    client_name text,
    client_phone text,
    device_brand text,
    device_model text NOT NULL,
    status text DEFAULT 'Recibido'::public.repair_status,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    problem_description text,
    locality text DEFAULT 'Urdinarrain'::text,
    is_deleted boolean DEFAULT false,
    quoted_price numeric
);


ALTER TABLE public.repairs OWNER TO postgres;

--
-- Name: brands brands_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_name_key UNIQUE (name);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: capacities capacities_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.capacities
    ADD CONSTRAINT capacities_name_key UNIQUE (name);


--
-- Name: capacities capacities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.capacities
    ADD CONSTRAINT capacities_pkey PRIMARY KEY (id);


--
-- Name: carousel_settings carousel_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.carousel_settings
    ADD CONSTRAINT carousel_settings_pkey PRIMARY KEY (id);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: colors colors_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.colors
    ADD CONSTRAINT colors_name_key UNIQUE (name);


--
-- Name: colors colors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.colors
    ADD CONSTRAINT colors_pkey PRIMARY KEY (id);


--
-- Name: dollar_settings dollar_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dollar_settings
    ADD CONSTRAINT dollar_settings_pkey PRIMARY KEY (id);


--
-- Name: hero_banners hero_banners_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hero_banners
    ADD CONSTRAINT hero_banners_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: models models_brand_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_brand_id_name_key UNIQUE (brand_id, name);


--
-- Name: models models_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_pkey PRIMARY KEY (id);


--
-- Name: orders orders_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_payment_id_key UNIQUE (payment_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_audit_log payment_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_audit_log
    ADD CONSTRAINT payment_audit_log_pkey PRIMARY KEY (id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: product_clicks product_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_clicks
    ADD CONSTRAINT product_clicks_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: repair_logs repair_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.repair_logs
    ADD CONSTRAINT repair_logs_pkey PRIMARY KEY (id);


--
-- Name: repair_statuses repair_statuses_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.repair_statuses
    ADD CONSTRAINT repair_statuses_name_key UNIQUE (name);


--
-- Name: repair_statuses repair_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.repair_statuses
    ADD CONSTRAINT repair_statuses_pkey PRIMARY KEY (id);


--
-- Name: repairs repairs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.repairs
    ADD CONSTRAINT repairs_pkey PRIMARY KEY (id);


--
-- Name: repairs repairs_tracking_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.repairs
    ADD CONSTRAINT repairs_tracking_code_key UNIQUE (tracking_code);


--
-- Name: idx_inv_movements_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_movements_product ON public.inventory_movements USING btree (product_id, created_at DESC);


--
-- Name: idx_inv_movements_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_movements_type ON public.inventory_movements USING btree (type, created_at DESC);


--
-- Name: idx_inv_movements_variant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_movements_variant ON public.inventory_movements USING btree (variant_id);


--
-- Name: idx_payment_audit_log_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_audit_log_order_id ON public.payment_audit_log USING btree (order_id);


--
-- Name: idx_product_clicks_clicked_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_product_clicks_clicked_at ON public.product_clicks USING btree (clicked_at);


--
-- Name: idx_product_clicks_product_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_product_clicks_product_id ON public.product_clicks USING btree (product_id);


--
-- Name: idx_product_variants_product_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_product_variants_product_id ON public.product_variants USING btree (product_id);


--
-- Name: idx_products_brand_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_brand_id ON public.products USING btree (brand_id);


--
-- Name: idx_products_category_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);


--
-- Name: idx_products_model_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_model_id ON public.products USING btree (model_id);


--
-- Name: idx_repair_logs_repair_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_repair_logs_repair_id ON public.repair_logs USING btree (repair_id);


--
-- Name: product_variants a_storefront_catalog_sync; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER a_storefront_catalog_sync AFTER INSERT OR DELETE OR UPDATE OF color, image_url, is_active ON public.product_variants FOR EACH ROW EXECUTE FUNCTION erp.sync_storefront_variant_to_erp();


--
-- Name: products a_storefront_catalog_sync; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER a_storefront_catalog_sync AFTER INSERT OR DELETE OR UPDATE OF name, description, price, image_url, is_active, category_id, brand_id, model_id ON public.products FOR EACH ROW EXECUTE FUNCTION erp.sync_storefront_product_to_erp();


--
-- Name: brands a_storefront_reference_sync; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER a_storefront_reference_sync AFTER INSERT OR DELETE OR UPDATE OF name ON public.brands FOR EACH ROW EXECUTE FUNCTION erp.sync_storefront_reference_to_erp();


--
-- Name: categories a_storefront_reference_sync; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER a_storefront_reference_sync AFTER INSERT OR DELETE OR UPDATE OF name ON public.categories FOR EACH ROW EXECUTE FUNCTION erp.sync_storefront_reference_to_erp();


--
-- Name: models a_storefront_reference_sync; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER a_storefront_reference_sync AFTER INSERT OR DELETE OR UPDATE OF name, brand_id ON public.models FOR EACH ROW EXECUTE FUNCTION erp.sync_storefront_reference_to_erp();


--
-- Name: orders update_orders_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: product_variants z_storefront_stock_capture; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER z_storefront_stock_capture AFTER INSERT OR UPDATE OF stock, product_id ON public.product_variants FOR EACH ROW EXECUTE FUNCTION erp.capture_storefront_stock_row();


--
-- Name: products z_storefront_stock_capture; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER z_storefront_stock_capture AFTER INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION erp.capture_storefront_stock_row();


--
-- Name: products fk_products_model; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_products_model FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: models models_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;


--
-- Name: payment_audit_log payment_audit_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_audit_log
    ADD CONSTRAINT payment_audit_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: product_clicks product_clicks_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_clicks
    ADD CONSTRAINT product_clicks_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id);


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: repair_logs repair_logs_repair_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.repair_logs
    ADD CONSTRAINT repair_logs_repair_id_fkey FOREIGN KEY (repair_id) REFERENCES public.repairs(id) ON DELETE CASCADE;


--
-- Name: brands Admin all brands; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin all brands" ON public.brands TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: categories Admin all categories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin all categories" ON public.categories TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: colors Admin all colors; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin all colors" ON public.colors TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: models Admin all models; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin all models" ON public.models TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: products Admin all products; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin all products" ON public.products TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: repair_logs Admin all repair logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin all repair logs" ON public.repair_logs TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: capacities Admin delete capacities; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin delete capacities" ON public.capacities FOR DELETE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: orders Admin delete orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin delete orders" ON public.orders FOR DELETE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: posts Admin delete posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin delete posts" ON public.posts FOR DELETE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: product_variants Admin delete product_variants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin delete product_variants" ON public.product_variants FOR DELETE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: repairs Admin delete repairs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin delete repairs" ON public.repairs FOR DELETE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: capacities Admin insert capacities; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin insert capacities" ON public.capacities FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: posts Admin insert posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin insert posts" ON public.posts FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: product_variants Admin insert product_variants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin insert product_variants" ON public.product_variants FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: repairs Admin insert repairs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin insert repairs" ON public.repairs FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: payment_audit_log Admin select audit; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin select audit" ON public.payment_audit_log FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: orders Admin select orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin select orders" ON public.orders FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: repairs Admin select repairs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin select repairs" ON public.repairs FOR SELECT TO authenticated USING (( SELECT (auth.role() = 'authenticated'::text)));


--
-- Name: orders Admin update orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin update orders" ON public.orders FOR UPDATE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: posts Admin update posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin update posts" ON public.posts FOR UPDATE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: product_variants Admin update product_variants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin update product_variants" ON public.product_variants FOR UPDATE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: repairs Admin update repairs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin update repairs" ON public.repairs FOR UPDATE TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: capacities Allow public read access on capacities; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow public read access on capacities" ON public.capacities FOR SELECT USING (true);


--
-- Name: product_clicks Anyone can insert clicks; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can insert clicks" ON public.product_clicks FOR INSERT WITH CHECK (true);


--
-- Name: hero_banners Anyone can view active banners; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view active banners" ON public.hero_banners FOR SELECT USING (true);


--
-- Name: carousel_settings Anyone can view carousel settings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view carousel settings" ON public.carousel_settings FOR SELECT USING (true);


--
-- Name: product_clicks Anyone can view clicks; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view clicks" ON public.product_clicks FOR SELECT USING (true);


--
-- Name: dollar_settings Anyone can view dollar settings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view dollar settings" ON public.dollar_settings FOR SELECT USING (true);


--
-- Name: repair_statuses Anyone can view repair statuses; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view repair statuses" ON public.repair_statuses FOR SELECT USING (true);


--
-- Name: inventory_movements Authenticated all inventory_movements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated all inventory_movements" ON public.inventory_movements TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));


--
-- Name: carousel_settings Authenticated can update carousel settings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can update carousel settings" ON public.carousel_settings USING ((auth.role() = 'authenticated'::text));


--
-- Name: dollar_settings Authenticated can update dollar settings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can update dollar settings" ON public.dollar_settings USING ((auth.role() = 'authenticated'::text));


--
-- Name: hero_banners Authenticated users can manage banners; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated users can manage banners" ON public.hero_banners USING ((auth.role() = 'authenticated'::text));


--
-- Name: repair_statuses Authenticated users can manage repair statuses; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated users can manage repair statuses" ON public.repair_statuses USING ((auth.role() = 'authenticated'::text));


--
-- Name: brands Enable read access for all users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable read access for all users" ON public.brands FOR SELECT USING (true);


--
-- Name: colors Enable read access for all users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable read access for all users" ON public.colors FOR SELECT USING (true);


--
-- Name: models Enable read access for all users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable read access for all users" ON public.models FOR SELECT USING (true);


--
-- Name: product_variants Enable read access for all users; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Enable read access for all users" ON public.product_variants FOR SELECT USING (true);


--
-- Name: categories Public Read Categories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public Read Categories" ON public.categories FOR SELECT USING (true);


--
-- Name: products Public Read Products; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public Read Products" ON public.products FOR SELECT USING (true);


--
-- Name: posts Public posts are viewable by everyone; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public posts are viewable by everyone" ON public.posts FOR SELECT USING (true);


--
-- Name: products Public read products; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read products" ON public.products FOR SELECT USING (true);


--
-- Name: payment_audit_log Service insert audit; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service insert audit" ON public.payment_audit_log FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: orders Service insert orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service insert orders" ON public.orders FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: brands; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

--
-- Name: capacities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.capacities ENABLE ROW LEVEL SECURITY;

--
-- Name: carousel_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.carousel_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: colors; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.colors ENABLE ROW LEVEL SECURITY;

--
-- Name: dollar_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.dollar_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: hero_banners; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.hero_banners ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: models; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_audit_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

--
-- Name: product_clicks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.product_clicks ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.repair_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_statuses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.repair_statuses ENABLE ROW LEVEL SECURITY;

--
-- Name: repairs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.repairs ENABLE ROW LEVEL SECURITY;

--
-- Name: FUNCTION count_repairs_by_status(status_name text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.count_repairs_by_status(status_name text) TO anon;
GRANT ALL ON FUNCTION public.count_repairs_by_status(status_name text) TO authenticated;
GRANT ALL ON FUNCTION public.count_repairs_by_status(status_name text) TO service_role;


--
-- Name: FUNCTION decrement_stock(row_id uuid, qty integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.decrement_stock(row_id uuid, qty integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decrement_stock(row_id uuid, qty integer) TO service_role;


--
-- Name: FUNCTION get_product_click_counts(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_product_click_counts() TO anon;
GRANT ALL ON FUNCTION public.get_product_click_counts() TO authenticated;
GRANT ALL ON FUNCTION public.get_product_click_counts() TO service_role;


--
-- Name: FUNCTION get_repair_by_tracking_code(search_code text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_repair_by_tracking_code(search_code text) TO anon;
GRANT ALL ON FUNCTION public.get_repair_by_tracking_code(search_code text) TO authenticated;
GRANT ALL ON FUNCTION public.get_repair_by_tracking_code(search_code text) TO service_role;


--
-- Name: FUNCTION get_repair_tracking(tracking_token text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_repair_tracking(tracking_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_repair_tracking(tracking_token text) TO anon;
GRANT ALL ON FUNCTION public.get_repair_tracking(tracking_token text) TO authenticated;


--
-- Name: FUNCTION process_approved_order(p_payment_id text, p_status text, p_total numeric, p_items jsonb, p_payer jsonb, p_payment_method_id text, p_ip_address text, p_user_agent text, p_device_fingerprint text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.process_approved_order(p_payment_id text, p_status text, p_total numeric, p_items jsonb, p_payer jsonb, p_payment_method_id text, p_ip_address text, p_user_agent text, p_device_fingerprint text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_approved_order(p_payment_id text, p_status text, p_total numeric, p_items jsonb, p_payer jsonb, p_payment_method_id text, p_ip_address text, p_user_agent text, p_device_fingerprint text) TO service_role;


--
-- Name: FUNCTION register_repair_private_media(upload_token text, file_slot integer, client_filename text, mime_type text, byte_size bigint, sha256_digest text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.register_repair_private_media(upload_token text, file_slot integer, client_filename text, mime_type text, byte_size bigint, sha256_digest text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_repair_private_media(upload_token text, file_slot integer, client_filename text, mime_type text, byte_size bigint, sha256_digest text) TO anon;
GRANT ALL ON FUNCTION public.register_repair_private_media(upload_token text, file_slot integer, client_filename text, mime_type text, byte_size bigint, sha256_digest text) TO authenticated;


--
-- Name: FUNCTION respond_repair_quote(response_token text, decision text, customer_message text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.respond_repair_quote(response_token text, decision text, customer_message text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.respond_repair_quote(response_token text, decision text, customer_message text) TO anon;
GRANT ALL ON FUNCTION public.respond_repair_quote(response_token text, decision text, customer_message text) TO authenticated;


--
-- Name: FUNCTION restore_expired_promos(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.restore_expired_promos() TO anon;
GRANT ALL ON FUNCTION public.restore_expired_promos() TO authenticated;
GRANT ALL ON FUNCTION public.restore_expired_promos() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: TABLE brands; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.brands TO anon;
GRANT ALL ON TABLE public.brands TO authenticated;
GRANT ALL ON TABLE public.brands TO service_role;


--
-- Name: TABLE capacities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.capacities TO anon;
GRANT ALL ON TABLE public.capacities TO authenticated;
GRANT ALL ON TABLE public.capacities TO service_role;


--
-- Name: TABLE carousel_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.carousel_settings TO anon;
GRANT ALL ON TABLE public.carousel_settings TO authenticated;
GRANT ALL ON TABLE public.carousel_settings TO service_role;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.categories TO anon;
GRANT ALL ON TABLE public.categories TO authenticated;
GRANT ALL ON TABLE public.categories TO service_role;


--
-- Name: TABLE colors; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.colors TO anon;
GRANT ALL ON TABLE public.colors TO authenticated;
GRANT ALL ON TABLE public.colors TO service_role;


--
-- Name: TABLE dollar_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.dollar_settings TO anon;
GRANT ALL ON TABLE public.dollar_settings TO authenticated;
GRANT ALL ON TABLE public.dollar_settings TO service_role;


--
-- Name: TABLE hero_banners; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.hero_banners TO anon;
GRANT ALL ON TABLE public.hero_banners TO authenticated;
GRANT ALL ON TABLE public.hero_banners TO service_role;


--
-- Name: TABLE inventory_movements; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.inventory_movements TO anon;
GRANT ALL ON TABLE public.inventory_movements TO authenticated;
GRANT ALL ON TABLE public.inventory_movements TO service_role;


--
-- Name: TABLE models; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.models TO anon;
GRANT ALL ON TABLE public.models TO authenticated;
GRANT ALL ON TABLE public.models TO service_role;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- Name: TABLE payment_audit_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.payment_audit_log TO anon;
GRANT ALL ON TABLE public.payment_audit_log TO authenticated;
GRANT ALL ON TABLE public.payment_audit_log TO service_role;


--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.posts TO anon;
GRANT ALL ON TABLE public.posts TO authenticated;
GRANT ALL ON TABLE public.posts TO service_role;


--
-- Name: TABLE product_clicks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.product_clicks TO anon;
GRANT ALL ON TABLE public.product_clicks TO authenticated;
GRANT ALL ON TABLE public.product_clicks TO service_role;


--
-- Name: TABLE product_variants; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.product_variants TO anon;
GRANT ALL ON TABLE public.product_variants TO authenticated;
GRANT ALL ON TABLE public.product_variants TO service_role;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;


--
-- Name: TABLE repair_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.repair_logs TO anon;
GRANT ALL ON TABLE public.repair_logs TO authenticated;
GRANT ALL ON TABLE public.repair_logs TO service_role;


--
-- Name: TABLE repair_statuses; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.repair_statuses TO anon;
GRANT ALL ON TABLE public.repair_statuses TO authenticated;
GRANT ALL ON TABLE public.repair_statuses TO service_role;


--
-- Name: TABLE repairs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.repairs TO anon;
GRANT ALL ON TABLE public.repairs TO authenticated;
GRANT ALL ON TABLE public.repairs TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


