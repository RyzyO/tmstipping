-- Sweep is private: only users listed in sweep_viewers (plus sweep admins) can see
-- or enter it. Seeded with the leaderboard's verified-tick and developer-icon accounts.
CREATE TABLE IF NOT EXISTS public.sweep_viewers (
  user_id text PRIMARY KEY
);
ALTER TABLE public.sweep_viewers ENABLE ROW LEVEL SECURITY;

CREATE POLICY sweep_viewers_read_own ON public.sweep_viewers FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text OR public.is_sweep_admin());
CREATE POLICY sweep_viewers_admin ON public.sweep_viewers FOR ALL TO authenticated
  USING (public.is_sweep_admin()) WITH CHECK (public.is_sweep_admin());

INSERT INTO public.sweep_viewers (user_id)
SELECT u.id::text FROM public.users u
WHERE u.team_name IN ('The Mock Cashy', 'The Mock Nick', 'RyzyO')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_sweep_viewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
AS $$
  SELECT public.is_sweep_admin()
    OR EXISTS (SELECT 1 FROM public.sweep_viewers v WHERE v.user_id = auth.uid()::text);
$$;

DROP POLICY IF EXISTS sweeps_read ON public.sweeps;
DROP POLICY IF EXISTS sweep_horses_read ON public.sweep_horses;
DROP POLICY IF EXISTS sweep_entries_read ON public.sweep_entries;
CREATE POLICY sweeps_read ON public.sweeps FOR SELECT TO authenticated USING (public.is_sweep_viewer());
CREATE POLICY sweep_horses_read ON public.sweep_horses FOR SELECT TO authenticated USING (public.is_sweep_viewer());
CREATE POLICY sweep_entries_read ON public.sweep_entries FOR SELECT TO authenticated USING (public.is_sweep_viewer());

DROP POLICY IF EXISTS sweep_entries_join_free ON public.sweep_entries;
CREATE POLICY sweep_entries_join_free ON public.sweep_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.is_sweep_viewer()
    AND user_id = auth.uid()::text
    AND horse_id IS NULL
    AND EXISTS (SELECT 1 FROM public.sweeps s WHERE s.id = sweep_id AND s.status = 'open' AND s.entry_fee = 0)
  );
