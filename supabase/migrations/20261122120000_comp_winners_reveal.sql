-- "Reveal winners" switch for the prizes page. The admin page works out the
-- winners when the button is pressed and stores a snapshot here, so the public
-- prizes page only reads one row instead of every race, result and tip.
alter table public.comps
  add column if not exists winners_revealed boolean not null default false,
  add column if not exists revealed_winners jsonb;
