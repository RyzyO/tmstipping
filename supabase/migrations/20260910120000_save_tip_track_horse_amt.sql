-- save_tip stopped updating races.horses[].amt after the Firebase -> Supabase
-- migration (commit 9354a394): the old client-side transaction used to
-- increment/decrement the picked horse's amt counter, which tipdark.html
-- uses to compute "% of users who tipped this horse". That counter has been
-- frozen since the migration. This restores it inside the RPC so it stays
-- accurate on every tip submission (including horse changes and re-submits).
CREATE OR REPLACE FUNCTION public.save_tip(p_user_id text, p_race_id text, p_horse_id text, p_joker boolean, p_comp_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_existing_joker boolean;
  v_existing_horse_id text;
  v_jokers_remaining integer;
BEGIN
  SELECT joker, horse_id INTO v_existing_joker, v_existing_horse_id
  FROM tips
  WHERE user_id = p_user_id AND race_id = p_race_id
  LIMIT 1;

  v_existing_joker := COALESCE(v_existing_joker, false);

  IF p_joker AND NOT v_existing_joker THEN
    SELECT jokers_remaining INTO v_jokers_remaining
    FROM user_comp_joinings
    WHERE user_id = p_user_id AND comp_id = p_comp_id;

    IF v_jokers_remaining IS NULL OR v_jokers_remaining <= 0 THEN
      RETURN jsonb_build_object('error', 'No jokers remaining');
    END IF;

    UPDATE user_comp_joinings
    SET jokers_remaining = jokers_remaining - 1
    WHERE user_id = p_user_id AND comp_id = p_comp_id;
  END IF;

  IF NOT p_joker AND v_existing_joker THEN
    UPDATE user_comp_joinings
    SET jokers_remaining = jokers_remaining + 1
    WHERE user_id = p_user_id AND comp_id = p_comp_id;
  END IF;

  INSERT INTO tips (id, user_id, race_id, horse_id, joker, comp_id, "timestamp", updated_at)
  VALUES (p_user_id || '_' || p_race_id, p_user_id, p_race_id, p_horse_id, p_joker, p_comp_id, (extract(epoch from now())*1000)::bigint, now())
  ON CONFLICT (user_id, race_id) DO UPDATE
  SET horse_id = EXCLUDED.horse_id,
      joker = EXCLUDED.joker,
      comp_id = EXCLUDED.comp_id,
      "timestamp" = EXCLUDED."timestamp",
      updated_at = EXCLUDED.updated_at;

  IF v_existing_horse_id IS DISTINCT FROM p_horse_id THEN
    IF v_existing_horse_id IS NOT NULL THEN
      UPDATE races
      SET horses = jsonb_set(
        horses,
        ARRAY[v_existing_horse_id, 'amt'],
        to_jsonb(GREATEST(0, COALESCE((horses->v_existing_horse_id->>'amt')::int, 0) - 1))
      )
      WHERE id = p_race_id AND horses ? v_existing_horse_id;
    END IF;

    UPDATE races
    SET horses = jsonb_set(
      horses,
      ARRAY[p_horse_id, 'amt'],
      to_jsonb(GREATEST(0, COALESCE((horses->p_horse_id->>'amt')::int, 0) + 1))
    )
    WHERE id = p_race_id AND horses ? p_horse_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;
