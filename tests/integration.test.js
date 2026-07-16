import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { calculateCompPoints } from '../scoring.js';

const SUPABASE_URL = 'https://dgcccgititqkbkhtwyxe.supabase.co/';
const SUPABASE_ANON_KEY = 'sb_publishable_KfRDIxkyeMIw3LkLYemwCA_Uw24wxjG';

describe('Integration Tests — Supabase', () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // calculateCompPoints is a pure function, so these exercise it directly with
  // fixture data rather than round-tripping through Supabase: RLS intentionally
  // blocks anon writes to comps/races/tips/results/users (see tests/smoke.js
  // "Anon cannot write to users"), so a beforeAll insert-then-score flow can
  // never populate real rows here and silently produces empty result sets.
  const testUserId = 'test-user';

  it('scores a winning tip correctly', () => {
    const races = [{ id: 'race-1', horses: { h1: { name: 'Winner', scratched: false } } }];
    const tips = [{ user_id: testUserId, race_id: 'race-1', horse_id: 'h1', joker: false }];
    const results = [{ race_id: 'race-1', winning_horse_id: 'h1', points: 10 }];

    const { userPoints } = calculateCompPoints(races, tips, results);
    expect(userPoints[testUserId]).toBe(10);
  });

  it('scores a place tip correctly', () => {
    const races = [{ id: 'race-1', horses: { h1: { name: 'Winner' }, h2: { name: 'Second' } } }];
    const tips = [{ user_id: testUserId, race_id: 'race-1', horse_id: 'h2', joker: false }];
    const results = [{ race_id: 'race-1', winning_horse_id: 'h1', points: 10, place1_horse_id: 'h2', place1_points: 5 }];

    const { userPoints } = calculateCompPoints(races, tips, results);
    expect(userPoints[testUserId]).toBe(5);
  });

  it('applies joker multiplier', () => {
    const races = [{ id: 'race-1', horses: { h1: { name: 'Winner' } } }];
    const tips = [{ user_id: testUserId, race_id: 'race-1', horse_id: 'h1', joker: true }];
    const results = [{ race_id: 'race-1', winning_horse_id: 'h1', points: 10 }];

    const { userPoints } = calculateCompPoints(races, tips, results);
    // Joker on a winner should be 10 * 2 = 20
    expect(userPoints[testUserId]).toBe(20);
  });

  it('fetches real data from Supabase without error', async () => {
    const { data, error } = await supabase.from('comps').select('*').limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
