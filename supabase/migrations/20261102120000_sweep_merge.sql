-- Merge one sweep's entrants into another, before any horses are drawn.
-- Nothing is deleted: entries are moved (not copied), the source sweep is kept
-- (hidden and marked merged), and every move is snapshotted so it can be undone
-- or audited. Both operations are single transactions: they fully apply or not at all.

ALTER TABLE public.sweep_entries
  ADD COLUMN IF NOT EXISTS fee_paid numeric,                                   -- what this person actually paid
  ADD COLUMN IF NOT EXISTS merged_from_sweep uuid REFERENCES public.sweeps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

ALTER TABLE public.sweeps
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.sweeps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

-- Existing paid entries paid their sweep's fee at the time.
UPDATE public.sweep_entries e
   SET fee_paid = s.entry_fee
  FROM public.sweeps s
 WHERE s.id = e.sweep_id AND e.paid AND e.fee_paid IS NULL;

-- Audit trail. No foreign keys on purpose: the log must survive any later deletes.
CREATE TABLE IF NOT EXISTS public.sweep_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('merge', 'undo')),
  source_id uuid NOT NULL,
  source_name text,
  target_id uuid NOT NULL,
  target_name text,
  entries jsonb NOT NULL,               -- full copy of every entry row that moved, as it was before the move
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sweep_merge_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sweep_merge_log_admin ON public.sweep_merge_log;
CREATE POLICY sweep_merge_log_admin ON public.sweep_merge_log FOR ALL TO authenticated
  USING (public.is_sweep_admin()) WITH CHECK (public.is_sweep_admin());

CREATE OR REPLACE FUNCTION public.merge_sweeps(p_source uuid, p_target uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  src public.sweeps;
  tgt public.sweeps;
  clash text;
  live int;
  total int;
  moved int;
  snap jsonb;
BEGIN
  IF NOT public.is_sweep_admin() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF p_source = p_target THEN RAISE EXCEPTION 'Pick two different sweeps'; END IF;

  -- Lock both rows (in id order, so two admins can never deadlock) for the whole transaction.
  PERFORM 1 FROM public.sweeps WHERE id IN (p_source, p_target) ORDER BY id FOR UPDATE;
  SELECT * INTO src FROM public.sweeps WHERE id = p_source;
  SELECT * INTO tgt FROM public.sweeps WHERE id = p_target;
  IF src.id IS NULL OR tgt.id IS NULL THEN RAISE EXCEPTION 'Sweep not found'; END IF;

  IF src.merged_into IS NOT NULL THEN RAISE EXCEPTION '"%" has already been merged', src.name; END IF;
  IF src.status <> 'open' OR tgt.status <> 'open' THEN
    RAISE EXCEPTION 'Both sweeps must be open (not drawn or completed) to merge';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sweep_entries WHERE sweep_id IN (p_source, p_target) AND horse_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Horses are already assigned in one of these sweeps. Clear the draw first';
  END IF;
  -- Keep the undo trail unambiguous: a sweep that has itself absorbed a merge cannot be merged away.
  IF EXISTS (SELECT 1 FROM public.sweep_entries WHERE sweep_id = p_source AND merged_from_sweep IS NOT NULL) THEN
    RAISE EXCEPTION '"%" already received entrants from a merge. Undo that merge first, or use it as the target', src.name;
  END IF;

  -- One entry per person per sweep. If someone is in both, they paid twice: never drop either.
  SELECT string_agg(DISTINCT a.display_name, ', ') INTO clash
    FROM public.sweep_entries a
    JOIN public.sweep_entries b ON b.user_id = a.user_id
   WHERE a.sweep_id = p_source AND b.sweep_id = p_target AND a.user_id IS NOT NULL;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'In both sweeps: %. Sort these out first (for example remove the duplicate and refund it in Stripe) so nobody loses an entry', clash;
  END IF;

  -- Everyone must still get a runner.
  SELECT count(*) INTO live FROM public.sweep_horses WHERE sweep_id = p_target AND NOT scratched;
  SELECT count(*) INTO total FROM public.sweep_entries WHERE sweep_id IN (p_source, p_target);
  IF live > 0 AND total > live THEN
    RAISE EXCEPTION 'Not enough runners: % entrants would share % running horses in "%"', total, live, tgt.name;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb) INTO snap
    FROM public.sweep_entries e WHERE e.sweep_id = p_source;

  UPDATE public.sweep_entries e
     SET sweep_id = p_target,
         merged_from_sweep = p_source,
         merged_at = now(),
         fee_paid = CASE WHEN e.paid THEN COALESCE(e.fee_paid, src.entry_fee) ELSE e.fee_paid END
   WHERE e.sweep_id = p_source;
  GET DIAGNOSTICS moved = ROW_COUNT;

  -- Keep the source: hidden, closed to new entries (checkout and free-join both require status = open).
  UPDATE public.sweeps
     SET merged_into = p_target, merged_at = now(), is_active = false, status = 'completed'
   WHERE id = p_source;

  INSERT INTO public.sweep_merge_log (action, source_id, source_name, target_id, target_name, entries, created_by)
  VALUES ('merge', p_source, src.name, p_target, tgt.name, snap, auth.uid()::text);

  RETURN moved;
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_sweep_merge(p_source uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  src public.sweeps;
  tgt public.sweeps;
  moved int;
  snap jsonb;
BEGIN
  IF NOT public.is_sweep_admin() THEN RAISE EXCEPTION 'Not authorised'; END IF;

  SELECT * INTO src FROM public.sweeps WHERE id = p_source FOR UPDATE;
  IF src.id IS NULL OR src.merged_into IS NULL THEN RAISE EXCEPTION 'That sweep has not been merged'; END IF;
  SELECT * INTO tgt FROM public.sweeps WHERE id = src.merged_into FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.sweep_entries WHERE merged_from_sweep = p_source AND horse_id IS NOT NULL) THEN
    RAISE EXCEPTION 'The draw has already run for these entrants, so the merge can no longer be undone';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb) INTO snap
    FROM public.sweep_entries e WHERE e.merged_from_sweep = p_source;

  UPDATE public.sweep_entries
     SET sweep_id = p_source, merged_from_sweep = NULL, merged_at = NULL
   WHERE merged_from_sweep = p_source;
  GET DIAGNOSTICS moved = ROW_COUNT;

  UPDATE public.sweeps SET merged_into = NULL, merged_at = NULL, status = 'open' WHERE id = p_source;

  INSERT INTO public.sweep_merge_log (action, source_id, source_name, target_id, target_name, entries, created_by)
  VALUES ('undo', p_source, src.name, src.merged_into, tgt.name, snap, auth.uid()::text);

  RETURN moved;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_sweeps(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_sweep_merge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_sweeps(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_sweep_merge(uuid) TO authenticated;
