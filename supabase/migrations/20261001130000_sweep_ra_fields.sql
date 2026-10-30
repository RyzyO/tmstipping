-- Racing Australia field data for sweeps (jockey, silks etc), same shape as tipping races.
ALTER TABLE public.sweep_horses
  ADD COLUMN IF NOT EXISTS jockey text,
  ADD COLUMN IF NOT EXISTS trainer text,
  ADD COLUMN IF NOT EXISTS barrier int,
  ADD COLUMN IF NOT EXISTS weight text,
  ADD COLUMN IF NOT EXISTS silks_id text,
  ADD COLUMN IF NOT EXISTS last10 text,
  ADD COLUMN IF NOT EXISTS prizemoney text,
  ADD COLUMN IF NOT EXISTS form_history jsonb;

ALTER TABLE public.sweeps
  ADD COLUMN IF NOT EXISTS race_name text,
  ADD COLUMN IF NOT EXISTS venue text,
  ADD COLUMN IF NOT EXISTS race_date text,
  ADD COLUMN IF NOT EXISTS race_time text,
  ADD COLUMN IF NOT EXISTS distance text,
  ADD COLUMN IF NOT EXISTS ra_source_url text;
