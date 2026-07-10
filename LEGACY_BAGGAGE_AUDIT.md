# Legacy Baggage Audit

## Executive Summary

**1,187 lines of orphaned, unmaintained code** across 4 files. Zero references from active nav. These pages are dead weight — bugs fixed in the dark versions won't apply here.

---

## Orphaned Pages (Dead Code)

Completely unreferenced. Safe to delete.

| File | Lines | Last Modified | Dark Equivalent | Status |
|------|-------|----------------|-----------------|--------|
| `leaderboard.html` | 406 | Jun 22 | `leaderboarddark.html` | 🗑️ **DELETE** |
| `results.html` | 383 | Jun 22 | `resultsdark.html` | 🗑️ **DELETE** |
| `notifications.html` | 196 | Jun 22 | `notificationsdark.html` | 🗑️ **DELETE** |
| `admin-leaderboard.html` | 202 | Jun 22 | `admin-leaderboard.js` | 🗑️ **DELETE** |
| **TOTAL** | **1,187** | — | — | — |

### Why These Are Orphaned

```
dark.html (entry point) links ONLY to:
  ✓ leaderboarddark.html
  ✓ resultsdark.html
  ✓ notificationsdark.html
  
NOT to:
  ✗ leaderboard.html (never called)
  ✗ results.html (never called)
  ✗ notifications.html (never called)
  ✗ admin-leaderboard.html (never called)
```

### Code Divergence Evidence

Each light version is **severely out of sync** with its dark equivalent:

- `leaderboard.html` vs `leaderboarddark.html`: **1,287 lines differ** (87% divergence)
- `results.html` vs `resultsdark.html`: **988 lines differ** (84% divergence)
- `notifications.html` vs `notificationsdark.html`: **448 lines differ** (76% divergence)

**Risk**: A bug fix in `resultsdark.html` will NOT apply to `results.html`. Users who somehow hit the light version get the unfixed version.

---

## Still In Use (Keep)

| File | Status | References |
|------|--------|------------|
| `user-admin.html` | ✓ Active | Referenced in footer/nav, still being used |
| `admin.html` | ✓ Active | Referenced by sidebar navigation |
| All `*dark.html` | ✓ Active | Entry points link to dark variants |

---

## Recommendations

### Immediate (Before Race Day)

Delete these 4 files:
```bash
rm leaderboard.html
rm results.html
rm notifications.html
rm admin-leaderboard.html
```

**Why now**: These are dead code. They add no value and are a maintenance trap. If a user somehow reaches one (old browser cache, bookmarked link), they'll see an unmaintained, potentially buggy version.

### Before Shipping

1. **Audit any remaining light versions** (`user-admin.html`, `admin.html`):
   - Are they actively used or just legacy?
   - If legacy → delete or mark as deprecated
   - If active → ensure they stay in sync with dark versions OR migrate to dark

2. **Copy-pasted logic** — `admin-leaderboard.js` is separate from `admin-dark-script.js`:
   - These have diverged since I added the substitute-horse scoring
   - Consider unifying them or having a single source of truth

---

## What Gets Duplicated

1. **HTML structure** — page layout, forms, tables (same across light/dark)
2. **Business logic** — scoring functions, data fetching, calculations (SHOULD be shared)
3. **Styling** — Dark uses Tailwind; light uses Bootstrap. Completely different CSS.

**The real issue**: Scoring logic like `calculatePoints()` lives in separate `.js` files per page. When I fixed a bug (substitute horses), I had to fix it in 4 different places. One of those files (`results.html`) may never even be read, so the fix there is invisible to users.

---

## Files Audit Summary

### Complete Inventory

**Active (linked from nav):**
- `dark.html` (home)
- `tipdark.html` (place tips)
- `resultsdark.html` (race results)
- `leaderboarddark.html` (standings)
- `notificationsdark.html` (notifications)
- `profiledark.html` (user settings)
- `admin-dark.html` (admin console)
- `user-admin.html` (user management)

**Legacy light versions (unreferenced):**
- `leaderboard.html` ❌
- `results.html` ❌
- `notifications.html` ❌
- `admin-leaderboard.html` ❌

**Ambiguous (check if used):**
- `admin.html` (legacy admin panel, may still be referenced)
- Any `*dark.js` or `*.js` files that aren't imported by active pages

---

## How To Verify Before Deletion

```bash
# Confirm these files are never referenced
grep -r "leaderboard.html" . --include="*.html" --include="*.js" | grep -v "leaderboarddark.html"
grep -r "results.html" . --include="*.html" --include="*.js" | grep -v "resultsdark.html"
grep -r "notifications.html" . --include="*.html" --include="*.js" | grep -v "notificationsdark.html"
grep -r "admin-leaderboard.html" .

# Should return: (no results)
```

---

## Tech Debt Impact

- **Lines of code to maintain**: 1,187 (for zero value)
- **Potential bugs**: Any fix to dark version has ~1/4 chance of not applying to light version
- **Onboarding friction**: New developers see duplicate files and waste time understanding why
- **Testing burden**: We test the dark versions; light versions are untested
- **Race-day risk**: If a user stumbles onto a light version (bookmarked URL, old cache), they get an untested, buggy version

**Fix cost**: Delete 4 files, update nav links if needed. ~5 minutes.

---

## Next Steps

1. **Before race day**: Run the cleanup (delete orphaned files)
2. **Post-race**: Consolidate `user-admin.html` and `admin.html` into the dark ecosystem
3. **Architectural fix**: Extract shared logic (scoring, data fetching) into modules, not per-page `.js` files
