-- Melbourne Cup sweep. Independent of tipping comps: own tables, own admin page.
-- Run in the Supabase SQL editor (or `supabase db push`).

CREATE TABLE IF NOT EXISTS public.sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'drawn', 'completed')),
  entry_fee numeric NOT NULL DEFAULT 0,
  prize_info text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sweep_horses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_id uuid NOT NULL REFERENCES public.sweeps(id) ON DELETE CASCADE,
  number int NOT NULL,
  name text NOT NULL,
  scratched boolean NOT NULL DEFAULT false,
  position int CHECK (position BETWEEN 1 AND 3),
  UNIQUE (sweep_id, number)
);

CREATE TABLE IF NOT EXISTS public.sweep_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_id uuid NOT NULL REFERENCES public.sweeps(id) ON DELETE CASCADE,
  user_id text,                       -- null for entrants added by name only
  display_name text NOT NULL,
  horse_id uuid REFERENCES public.sweep_horses(id) ON DELETE SET NULL,
  paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sweep_id, user_id)
);

ALTER TABLE public.sweeps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sweep_horses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sweep_entries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_sweep_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id::text = auth.uid()::text AND u.admin = true);
$$;

-- Everyone signed in can read the sweep.
CREATE POLICY sweeps_read ON public.sweeps FOR SELECT TO authenticated USING (true);
CREATE POLICY sweep_horses_read ON public.sweep_horses FOR SELECT TO authenticated USING (true);
CREATE POLICY sweep_entries_read ON public.sweep_entries FOR SELECT TO authenticated USING (true);

-- Admin can do everything.
CREATE POLICY sweeps_admin ON public.sweeps FOR ALL TO authenticated
  USING (public.is_sweep_admin()) WITH CHECK (public.is_sweep_admin());
CREATE POLICY sweep_horses_admin ON public.sweep_horses FOR ALL TO authenticated
  USING (public.is_sweep_admin()) WITH CHECK (public.is_sweep_admin());
CREATE POLICY sweep_entries_admin ON public.sweep_entries FOR ALL TO authenticated
  USING (public.is_sweep_admin()) WITH CHECK (public.is_sweep_admin());

-- Paid sweeps: entries are created by the stripe-webhook (service role) after payment.
-- Users can only insert their own entry directly when the sweep is free and open.
CREATE POLICY sweep_entries_join_free ON public.sweep_entries FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()::text
    AND horse_id IS NULL
    AND EXISTS (SELECT 1 FROM public.sweeps s WHERE s.id = sweep_id AND s.status = 'open' AND s.entry_fee = 0)
  );
