# Multi-Comp System - Implementation Guide

## ✅ Completed

### 1. Frontend Pages Created/Updated
- ✅ **comps.html** - Full multi-comp browsing and joining system
- ✅ **signup.html** - Removed payment requirement, redirects to comps
- ✅ **dark.html** - Updated navigation to include Competitions link
- ✅ **tipdark.html** - Updated to check comp joining instead of payment status
- ✅ **db-setup.html** - Admin page to initialize Firestore collections

### 2. Core Changes
- ✅ Authentication flow: Users can now sign up without payment
- ✅ Comp joining: Users join comps through comps.html with payment modal
- ✅ Multi-comp support: Tips/races are filtered by competition ID

---

## ⏳ Remaining Work (Priority Order)

### PHASE 1: Critical - Required for Basic Functionality

#### 1.1 Update leaderboarddark.html
**Goal**: Show comp-filtered leaderboards

**Changes needed**:
```javascript
// Current: Fetches from 'leaderboard' collection
// New: Query 'userCompJoinings' filtered by compId

async function loadLeaderboard() {
  const compId = new URLSearchParams(window.location.search).get('compId') || 'default-comp';
  
  const q = query(
    collection(db, "userCompJoinings"),
    where("compId", "==", compId),
    orderBy("rank", "asc"),
    limit(100)
  );
  
  const snapshot = await getDocs(q);
  // Render leaderboard entries...
}
```

**Add to page**:
- Comp selector dropdown at top
- Last update timestamp
- Per-comp leaderboard with user rankings from userCompJoinings

---

#### 1.2 Update resultsDark.html
**Goal**: Show comp-filtered race results

**Changes needed**:
- Add comp selector
- Filter tips/results by compId
- Show race winner with payouts

---

#### 1.3 Update dark.html Home Page
**Goal**: Show user's active comps and summary

**Changes needed**:
```javascript
// Show user's joined comps instead of single leaderboard
const q = query(
  collection(db, "userCompJoinings"),
  where("userId", "==", currentUser.uid)
);

// Display cards:
// - Current comp status
// - Rank/points in each comp
// - Quick action button: "Tip Now" or "Join Comp"
```

---

#### 1.4 Update profiledark.html
**Goal**: Show user's profile and comp participations

**Changes needed**:
- Display user info (name, email, silk)
- Show list of joined comps
- Show stats per comp
- Allow leaving comps (optional)

---

### PHASE 2: Important - Enhanced Features

#### 2.1 Firestore Cloud Functions
**Function 1**: `createPaymentCheckout`
```typescript
// Create Stripe checkout session for comp joining
// Return sessionId to redirect user
```

**Function 2**: `handlePaymentWebhook`
```typescript
// Verify Stripe payment
// Update userCompJoinings with paymentStatus: completed
// Create leaderboard entry
```

**Function 3**: `updateCompLeaderboards`
```typescript
// Recalculate rankings after race results
// Update rank/points in userCompJoinings
```

---

#### 2.2 Stripe Integration
- Set up product/prices in Stripe Dashboard
- Store Stripe price IDs in comps documents
- Implement checkout flow in comps.html
- Add webhook endpoint for payment success

---

#### 2.3 Admin Dashboard Enhancement
- Create/edit competitions
- View comp participants
- Manage payouts
- Add new races to comps

---

### PHASE 3: Optional - Polish & Optimization

#### 3.1 Database Optimization
- Add Firestore indexes (see MULTI_COMP_SETUP.md)
- Implement caching strategy
- Batch operations for performance

#### 3.2 Migration Tools
- Batch move existing users to default-comp
- Update existing tips to include compId
- Validate data consistency

#### 3.3 User Experience
- Better error handling
- Loading states
- Offline support
- Push notifications for comp updates

---

## Page Update Template

### For leaderboard/results pages updating to use comps:

```html
<!-- HEAD: Add styles if needed -->

<!-- BODY: Add comp selector -->
<div class="comp-selector">
  <label>Select Competition:</label>
  <select id="compSelect" onchange="onCompChange()">
    <option value="">Loading...</option>
  </select>
</div>

<!-- SCRIPT: Update data loading -->
<script type="module">
  // ... Firebase imports ...
  
  let selectedCompId = new URLSearchParams(window.location.search).get('compId') || 'default-comp';
  
  async function loadComps() {
    const compsSnap = await getDocs(collection(db, "comps"));
    const select = document.getElementById('compSelect');
    select.innerHTML = '';
    
    compsSnap.forEach(doc => {
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      if (doc.id === selectedCompId) option.selected = true;
      select.appendChild(option);
    });
  }
  
  window.onCompChange = () => {
    selectedCompId = document.getElementById('compSelect').value;
    loadData(); // Reload with new comp
  };
  
  async function loadData() {
    // Use selectedCompId to filter queries
    const q = query(
      collection(db, "userCompJoinings"),
      where("compId", "==", selectedCompId),
      orderBy("rank", "asc")
    );
    
    const snapshot = await getDocs(q);
    // Render data...
  }
  
  // Initialize
  loadComps();
  loadData();
</script>
```

---

## Database Query Examples

### Get user's competitions:
```javascript
const q = query(
  collection(db, "userCompJoinings"),
  where("userId", "==", userId)
);
const snapshot = await getDocs(q);
```

### Get comp leaderboard:
```javascript
const q = query(
  collection(db, "userCompJoinings"),
  where("compId", "==", compId),
  orderBy("rank", "asc"),
  limit(100)
);
```

### Get user's tips in a comp:
```javascript
const q = query(
  collection(db, "tips"),
  where("userId", "==", userId),
  where("compId", "==", compId)
);
```

### Create user comp joining record:
```javascript
await setDoc(doc(db, "userCompJoinings", `${userId}_${compId}`), {
  userId,
  compId,
  joinDate: serverTimestamp(),
  paymentStatus: "completed",
  stripePaymentId: sessionId,
  rank: 999999,
  points: 0,
  wins: 0,
  losses: 0
});
```

---

## Testing Checklist

- [ ] Sign up new user (no payment)
- [ ] User lands on comps.html
- [ ] Create test comp in db-setup.html
- [ ] Join comp from comps.html
- [ ] View joined comp in "My Comps" tab
- [ ] Click "Go to Tips" button
- [ ] Load races for that comp
- [ ] Submit a tip
- [ ] Verify tip shows in leaderboard
- [ ] View leaderboard filtered by comp
- [ ] View results for completed comp

---

## Known Limitations & TODOs

1. **Payment Integration**: Currently comps.html has placeholder payment logic. Full Stripe integration needed.
2. **Race Filtering**: tipdark.html needs to filter races by comp (currently shows all)
3. **Admin Interface**: Create/edit comps only available through db-setup.html
4. **Migration**: Existing tips/leaderboards not automatically migrated
5. **Notifications**: Users not notified when they join wrong comp or comp ends

---

## Quick Start for Developers

1. **Set up database**:
   - Go to `/db-setup.html` while logged in as admin
   - Click through all initialization steps

2. **Test the flow**:
   - Sign up as new user at `/signup.html`
   - Join test comp at `/comps.html`
   - Make tips at `/tipdark.html?compId=default-comp`
   - Check leaderboard at `/leaderboarddark.html?compId=default-comp`

3. **Add new comp**:
   - Go to `/db-setup.html`
   - Adjust comp details and click "Create Competition"

---

## Deployment Notes

1. **Firestore Rules**: Update to allow new collections (see MULTI_COMP_SETUP.md)
2. **Cloud Functions**: Deploy payment webhook handler
3. **Stripe**: Configure product/prices and webhook endpoint
4. **Admin Panel**: Ensure at least one admin user has `admin: true` flag
5. **Backward Compatibility**: Old leaderboard collection remains for legacy data

---

## Getting Help

- **Firebase Issues**: Check Firebase Console for errors
- **Stripe Issues**: Review Stripe Dashboard webhook logs
- **Auth Issues**: Verify user has proper role/permissions in Firestore rules
- **UI Bugs**: Use browser DevTools console for errors
