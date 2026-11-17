DO $$
BEGIN
  IF to_regprocedure('public.get_repair_by_tracking_code(text)') IS NULL THEN
    RAISE NOTICE 'Legacy tracking function absent; skipping';
    RETURN;
  END IF;

  IF to_regclass('erp.cutover_function_backups') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM erp.cutover_function_backups
      WHERE function_identity = 'public.get_repair_by_tracking_code(text)'
        AND restored_at IS NULL
    ) THEN
      RAISE NOTICE 'Stage 6 tracking cutover active; skipping';
      RETURN;
    END IF;
  END IF;

  EXECUTE $f$
CREATE OR REPLACE FUNCTION public.get_repair_by_tracking_code(search_code text) RETURNS TABLE(id uuid, tracking_code text, client_name text, client_dni text, device_brand text, device_model text, status public.repair_status, locality text, notes text, problem_description text, created_at timestamp with time zone, repair_logs json)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $body$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.tracking_code,
    r.client_name,
    r.client_dni,
    r.device_brand,
    r.device_model,
    r.status::public.repair_status,
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
$body$;
  $f$;
  GRANT ALL ON FUNCTION public.get_repair_by_tracking_code(text) TO anon, authenticated, service_role;
END;
$$;
