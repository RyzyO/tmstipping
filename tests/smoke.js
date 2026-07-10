#!/usr/bin/env node
/**
 * Pre-race-day smoke test — validates critical systems before go-live.
 * Run: node tests/smoke.js
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://dgcccgititqkbkhtwyxe.supabase.co/';
const SUPABASE_ANON_KEY = 'sb_publishable_KfRDIxkyeMIw3LkLYemwCA_Uw24wxjG';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(status, message) {
  const icon = status === '✓' ? colors.green : status === '✗' ? colors.red : colors.blue;
  console.log(`${icon}${status}${colors.reset} ${message}`);
}

async function testSupabaseConnection() {
  console.log(`\n${colors.blue}Testing Supabase Connection${colors.reset}`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    const { error } = await supabase.from('comps').select('id').limit(1);
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 is expected empty result
    log('✓', 'Supabase reachable');
    return supabase;
  } catch (err) {
    log('✗', `Supabase connection failed: ${err.message}`);
    process.exit(1);
  }
}

async function testCoreTables(supabase) {
  console.log(`\n${colors.blue}Testing Core Tables${colors.reset}`);
  const tables = ['races', 'tips', 'results', 'comps', 'user_comp_joinings', 'users', 'notifications'];

  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).select('*').limit(0);
      if (error && error.code !== 'PGRST116') throw error;
      log('✓', `${table} exists`);
    } catch (err) {
      log('✗', `${table} query failed: ${err.message}`);
      return false;
    }
  }
  return true;
}

async function testScoringLogic() {
  console.log(`\n${colors.blue}Testing Scoring Logic${colors.reset}`);
  try {
    const { calculateTipPoints, resolveScoredHorseId } = await import('../scoring.js');

    const race = {
      horses: {
        'h1': { name: 'Winner', scratched: false },
        'h2': { name: 'Substitute', scratched: false, substitute: true },
        'h3': { name: 'Scratched', scratched: true }
      }
    };

    const result = {
      winning_horse_id: 'h1',
      points: 10,
      place1_horse_id: 'h2',
      place1_points: 5
    };

    // Test normal scoring
    const pts = calculateTipPoints(race, result, 'h1', false);
    if (pts !== 10) throw new Error(`Expected 10 points, got ${pts}`);
    log('✓', 'Normal scoring works (10 points for win)');

    // Test joker multiplier
    const ptsJoker = calculateTipPoints(race, result, 'h1', true);
    if (ptsJoker !== 20) throw new Error(`Expected 20 points (joker), got ${ptsJoker}`);
    log('✓', 'Joker multiplier works (20 points for joker win)');

    // Test substitute resolution
    const substitute = resolveScoredHorseId(race, 'h3');
    if (substitute !== 'h2') throw new Error(`Expected h2 substitute, got ${substitute}`);
    log('✓', 'Substitute resolution works');

    return true;
  } catch (err) {
    log('✗', `Scoring logic failed: ${err.message}`);
    return false;
  }
}

async function testEdgeFunctions() {
  console.log(`\n${colors.blue}Testing Edge Functions${colors.reset}`);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-onesignal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ action: 'app-stats' })
    });

    if (response.status === 401 || response.status === 403) {
      log('✓', 'send-onesignal edge function exists (auth required)');
      return true;
    } else if (response.ok) {
      log('✓', 'send-onesignal edge function works');
      return true;
    } else {
      log('✗', `send-onesignal returned ${response.status}`);
      return false;
    }
  } catch (err) {
    log('✗', `Edge function test failed: ${err.message}`);
    return false;
  }
}

async function testRLSPolicies(supabase) {
  console.log(`\n${colors.blue}Testing RLS Policies${colors.reset}`);
  try {
    // Test that anon can read but not write to users
    const { data: users, error: readErr } = await supabase.from('users').select('id').limit(1);
    if (readErr && readErr.code !== 'PGRST116') throw new Error(`Read failed: ${readErr.message}`);
    log('✓', 'Anon can read users');

    // Test that anon cannot write to users
    const { error: writeErr } = await supabase.from('users').insert({ id: 'test', email: 'test@test' });
    if (!writeErr) {
      log('✗', 'Anon should not be able to write to users (RLS check failed)');
      // Cleanup
      await supabase.from('users').delete().eq('id', 'test');
      return false;
    }
    log('✓', 'Anon cannot write to users (RLS working)');
    return true;
  } catch (err) {
    log('✗', `RLS test failed: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`${colors.blue}=== Pre-Race-Day Smoke Test ===${colors.reset}`);
  console.log(`Time: ${new Date().toISOString()}`);

  const supabase = await testSupabaseConnection();
  const tablesOk = await testCoreTables(supabase);
  const scoringOk = await testScoringLogic();
  const edgeFuncsOk = await testEdgeFunctions();
  const rlsOk = await testRLSPolicies(supabase);

  console.log(`\n${colors.blue}=== Summary ===${colors.reset}`);
  const allPassed = tablesOk && scoringOk && edgeFuncsOk && rlsOk;
  if (allPassed) {
    log('✓', 'All systems ready for race day! 🎉');
    process.exit(0);
  } else {
    log('✗', 'Some systems failed. Fix above errors before going live.');
    process.exit(1);
  }
}

main().catch(err => {
  log('✗', `Unexpected error: ${err.message}`);
  process.exit(1);
});
