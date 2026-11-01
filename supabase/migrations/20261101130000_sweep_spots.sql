-- Free sweeps: refuse the entry once every unscratched horse already has an entrant.
-- (Paid sweeps are capped the same way in the create-checkout edge function.)
CREATE OR REPLACE FUNCTION public.sweep_has_spot(p_sweep uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
AS $$
  SELECT (SELECT count(*) FROM public.sweep_horses h WHERE h.sweep_id = p_sweep AND NOT h.scratched) = 0
      OR (SELECT count(*) FROM public.sweep_entries e WHERE e.sweep_id = p_sweep)
       < (SELECT count(*) FROM public.sweep_horses h WHERE h.sweep_id = p_sweep AND NOT h.scratched);
$$;

DROP POLICY IF EXISTS sweep_entries_join_free ON public.sweep_entries;
CREATE POLICY sweep_entries_join_free ON public.sweep_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.is_sweep_viewer()
    AND user_id = auth.uid()::text
    AND horse_id IS NULL
    AND EXISTS (SELECT 1 FROM public.sweeps s WHERE s.id = sweep_id AND s.status = 'open' AND s.entry_fee = 0)
    AND public.sweep_has_spot(sweep_id)
  );
