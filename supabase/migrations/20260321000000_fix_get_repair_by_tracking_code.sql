-- Fix get_repair_by_tracking_code RPC:
-- 1. Adds search by client_dni (not only tracking_code)
-- 2. Returns repair_logs (public only) embedded in each row
-- 3. Returns client_dni field
-- 4. Ensures SECURITY DEFINER so anon role can execute safely
-- 5. Grants EXECUTE to anon and authenticated roles

CREATE OR REPLACE FUNCTION public.get_repair_by_tracking_code(search_code text)
RETURNS TABLE (
  id           uuid,
  tracking_code text,
  client_name  text,
  client_dni   text,
  device_brand text,
  device_model text,
  status       repair_status,
  locality     text,
  notes        text,
  problem_description text,
  created_at   timestamptz,
  repair_logs  json
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- Search by tracking code (case-insensitive)
    UPPER(r.tracking_code) = UPPER(search_code)
    -- Or search by DNI, stripping dots/spaces/dashes from the input
    OR r.client_dni = regexp_replace(search_code, '[.\s\-]', '', 'g')
  ORDER BY r.created_at DESC
  LIMIT 5;
END;
$$;

-- Allow unauthenticated (public storefront) and authenticated (admin) users to call this function
GRANT EXECUTE ON FUNCTION public.get_repair_by_tracking_code(text) TO anon, authenticated;
