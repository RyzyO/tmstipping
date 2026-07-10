# Test Suite

Race-day-critical tests for the tipping platform.

## Setup

```bash
npm install
```

## Run Tests

```bash
# Unit tests (pure scoring logic)
npm test

# Watch mode (for development)
npm run test:ui

# Pre-race-day smoke test
npm run test:smoke
```

## What's Tested

### Unit Tests (`scoring.test.js`)
- **Substitute resolution**: scratched horses fall to substitutes correctly
- **Tip scoring**: win/place/place scoring with correct points
- **Joker multiplier**: 2x points when joker is used
- **Aggregation**: multi-tip, multi-user point calculations

### Integration Tests (`integration.test.js`)
- Real Supabase connection and data persistence
- End-to-end scoring against live tables
- Data cleanup after tests

### Smoke Tests (`smoke.js`)
Run before race day to validate:
- Supabase connection
- All core tables exist and are queryable
- Scoring logic computes correctly
- Edge functions are callable
- RLS policies are enforced

## Key Files

- `scoring.js` — Pure, testable scoring functions
- `tests/scoring.test.js` — Unit tests
- `tests/integration.test.js` — Integration tests
- `tests/smoke.js` — Pre-race validation script

## Pre-Race Checklist

```bash
npm run test:smoke
```

Exit code 0 = ready to go. Exit code 1 = fix errors before race day.

## Common Issues

**Tests hang**: Check that Supabase credentials in `supabase-config.js` are valid.

**Integration tests fail**: They create test data — if the cleanup from a prior run didn't complete, old test records may interfere. Check Supabase manually for records matching `test-*`.

**Smoke test fails on RLS**: This is expected if you're not authenticated. The test validates that the public API rejects writes — a passing result.
