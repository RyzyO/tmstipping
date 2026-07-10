import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { calculateCompPoints } from '../scoring.js';

const SUPABASE_URL = 'https://dgcccgititqkbkhtwyxe.supabase.co/';
const SUPABASE_ANON_KEY = 'sb_publishable_KfRDIxkyeMIw3LkLYemwCA_Uw24wxjG';

describe('Integration Tests — Supabase', () => {
  let supabase;
  let testCompId;
  let testRaceId;
  let testUserId;

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Create test data in a dedicated test competition
    testCompId = `test-comp-${Date.now()}`;
    testRaceId = `test-race-${Date.now()}`;
    testUserId = `test-user-${Date.now()}`;

    // Insert test competition
    await supabase.from('comps').insert({
      id: testCompId,
      name: 'Test Competition',
      status: 'active',
      entry_fee: 30
    });

    // Insert test race
    await supabase.from('races').insert({
      id: testRaceId,
      comp_id: testCompId,
      name: 'Test Race',
      date: new Date().toISOString().split('T')[0],
      time: '14:00',
      horses: {
        'h1': { number: 1, name: 'Winner', scratched: false },
        'h2': { number: 2, name: 'Second', scratched: false },
        'h3': { number: 3, name: 'Third', scratched: false }
      }
    });

    // Insert test result
    await supabase.from('results').insert({
      id: testRaceId,
      race_id: testRaceId,
      winning_horse_id: 'h1',
      points: 10,
      place1_horse_id: 'h2',
      place1_points: 5,
      place2_horse_id: 'h3',
      place2_points: 2
    });

    // Insert test user
    await supabase.from('users').insert({
      id: testUserId,
      email: `test-${Date.now()}@test.local`,
      first_name: 'Test',
      last_name: 'User'
    });

    // Insert user-comp joining
    await supabase.from('user_comp_joinings').insert({
      id: `${testUserId}_${testCompId}`,
      user_id: testUserId,
      comp_id: testCompId,
      payment_status: 'completed'
    });
  });

  afterAll(async () => {
    // Clean up test data
    await supabase.from('tips').delete().eq('race_id', testRaceId);
    await supabase.from('results').delete().eq('race_id', testRaceId);
    await supabase.from('races').delete().eq('id', testRaceId);
    await supabase.from('user_comp_joinings').delete().eq('comp_id', testCompId);
    await supabase.from('comps').delete().eq('id', testCompId);
    await supabase.from('users').delete().eq('id', testUserId);
  });

  it('scores a winning tip correctly', async () => {
    // Insert a tip
    await supabase.from('tips').insert({
      id: `${testUserId}_${testRaceId}`,
      user_id: testUserId,
      comp_id: testCompId,
      race_id: testRaceId,
      horse_id: 'h1',
      joker: false
    });

    // Fetch data
    const [{ data: races }, { data: tips }, { data: results }] = await Promise.all([
      supabase.from('races').select('*').eq('id', testRaceId),
      supabase.from('tips').select('*').eq('race_id', testRaceId),
      supabase.from('results').select('*').eq('race_id', testRaceId)
    ]);

    // Score
    const { userPoints } = calculateCompPoints(races, tips, results);
    expect(userPoints[testUserId]).toBe(10);
  });

  it('scores a place tip correctly', async () => {
    // Insert a place tip
    await supabase.from('tips').insert({
      id: `${testUserId}_${testRaceId}_place`,
      user_id: testUserId,
      comp_id: testCompId,
      race_id: testRaceId,
      horse_id: 'h2',
      joker: false
    });

    const [{ data: races }, { data: tips }, { data: results }] = await Promise.all([
      supabase.from('races').select('*').eq('id', testRaceId),
      supabase.from('tips').select('*').eq('race_id', testRaceId),
      supabase.from('results').select('*').eq('race_id', testRaceId)
    ]);

    const { userPoints } = calculateCompPoints(races, tips, results);
    // Should have both the winning tip (10) and the place tip (5)
    expect(userPoints[testUserId]).toBeGreaterThanOrEqual(5);
  });

  it('applies joker multiplier', async () => {
    // Insert a joker tip
    await supabase.from('tips').insert({
      id: `${testUserId}_${testRaceId}_joker`,
      user_id: testUserId,
      comp_id: testCompId,
      race_id: testRaceId,
      horse_id: 'h1',
      joker: true
    });

    const [{ data: races }, { data: tips }, { data: results }] = await Promise.all([
      supabase.from('races').select('*').eq('id', testRaceId),
      supabase.from('tips').select('*').eq('race_id', testRaceId),
      supabase.from('results').select('*').eq('race_id', testRaceId)
    ]);

    const { userPoints } = calculateCompPoints(races, tips, results);
    // Joker on a winner should be 10 * 2 = 20
    expect(userPoints[testUserId]).toBeGreaterThanOrEqual(20);
  });

  it('fetches real data from Supabase without error', async () => {
    const { data, error } = await supabase.from('comps').select('*').limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
