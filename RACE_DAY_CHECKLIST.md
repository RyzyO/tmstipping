# Race Day Checklist

## Pre-Race Validation (5 minutes)

```bash
# 1. Run the smoke test (validates everything works)
npm run test:smoke

# Expected output: "All systems ready for race day! 🎉" with exit code 0
```

If you see ✓ on all checks, you're good. If any check fails, fix it before going live.

## What the Smoke Test Validates

- ✓ Supabase connection
- ✓ All core tables (races, tips, results, comps, users, etc.)
- ✓ Scoring logic (normal scoring, joker multiplier, substitutes)
- ✓ Edge functions (send-onesignal)
- ✓ RLS policies (security gates working)

## Optional: Full Test Suite

```bash
# Unit tests (13 tests, runs in ~2ms)
npm test -- tests/scoring.test.js

# Integration tests (slow, hits real Supabase, creates test data)
npm test -- tests/integration.test.js
```

## Key Files

- `scoring.js` — Pure scoring logic (testable, reusable)
- `tests/smoke.js` — Race-day validation script
- `tests/scoring.test.js` — Unit tests (13 passing)
- `tests/integration.test.js` — Integration tests (hits Supabase)

## If Something Breaks on Race Day

1. **Scoring is wrong**: Check `scoring.js`. All logic is centralized and tested.
2. **Jokers not working**: Check `calculateTipPoints()` joker multiplier logic.
3. **Substitutes not scoring**: Check `resolveScoredHorseId()` in `scoring.js`.
4. **Supabase down**: Smoke test will catch it immediately.
5. **RLS blocking writes**: Check user permissions and anon key.

## Before Merge

Run this once before merging to main:

```bash
npm run test:smoke && echo "Ready to merge! 🚀"
```

Exit code 0 = safe to ship.
