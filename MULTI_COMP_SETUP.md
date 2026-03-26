# Multi-Comp System - Database Setup Guide

## Collections to Create in Firestore

### 1. `comps` Collection
Documents representing different competitions.

**Document ID**: `{compId}` (e.g., "default-comp", "comp-001")

**Fields**:
```
{
  compId: string,
  name: string,
  description: string,
  entryFee: number,
  prizePool: number,
  maxParticipants: number,
  participantCount: number,
  status: "active" | "closed" | "archived",
  startDate: string (ISO 8601),
  endDate: string (ISO 8601),
  createdBy: string (userId),
  createdAt: timestamp,
  rules: string (markdown),
  image: string (URL)
}
```

**Example**:
```json
{
  "compId": "default-comp",
  "name": "The Great Spring Tip Off",
  "description": "The main competition for spring racing season",
  "entryFee": 25.00,
  "prizePool": 5000.00,
  "maxParticipants": 500,
  "participantCount": 125,
  "status": "active",
  "startDate": "2026-03-01T00:00:00Z",
  "endDate": "2026-04-30T23:59:59Z",
  "createdBy": "admin-uid-here",
  "createdAt": "2026-03-01T00:00:00Z",
  "rules": "# Rules\n- Standard tipping rules...",
  "image": "https://example.com/comp-image.jpg"
}
```

### 2. `userCompJoinings` Collection
Tracks user participation in competitions and payment status.

**Document ID**: `{userId}_{compId}` (e.g., "user123_default-comp")

**Fields**:
```
{
  userId: string,
  compId: string,
  joinDate: timestamp,
  paymentStatus: "pending" | "completed" | "failed",
  stripePaymentId: string,
  stripeSessionId: string,
  rank: number,
  points: number,
  wins: number,
  losses: number
}
```

**Example**:
```json
{
  "userId": "user123",
  "compId": "default-comp",
  "joinDate": "2026-03-10T14:30:00Z",
  "paymentStatus": "completed",
  "stripePaymentId": "pi_1A2B3C4D5E6F7G8H",
  "stripeSessionId": "cs_live_a1b2c3d4e5f6",
  "rank": 45,
  "points": 850,
  "wins": 12,
  "losses": 8
}
```

### 3. `tips` Collection (MODIFIED)
Now includes `compId` field.

**Document ID**: Auto-generated

**Fields**:
```
{
  userId: string,
  compId: string,        // NEW: which competition this tip is for
  raceId: string,
  horse: string,
  timestamp: timestamp,
  joker: boolean
}
```

### 4. `leaderboards` Collection
Per-competition leaderboards.

**Document ID**: `{compId}_{userId}` (e.g., "default-comp_user123")

**Fields**:
```
{
  compId: string,
  userId: string,
  teamName: string,
  rank: number,
  points: number,
  wins: number,
  losses: number,
  lastUpdated: timestamp
}
```

### 5. `payments` Collection (NEW)
Track all payment transactions.

**Document ID**: Auto-generated

**Fields**:
```
{
  userId: string,
  compId: string,
  amount: number,
  currency: string,
  stripePaymentIntentId: string,
  stripePaymentMethodId: string,
  status: "succeeded" | "processing" | "requires_action" | "canceled",
  createdAt: timestamp,
  metadata: object
}
```

## Database Indexes Required

Add these indexes in Firestore for optimal query performance:

1. **userCompJoinings**:
   - Composite Index: `userId` (Asc) + `joinDate` (Desc)
   - Composite Index: `compId` (Asc) + `paymentStatus` (Asc)

2. **tips**:
   - Composite Index: `userId` (Asc) + `compId` (Asc)
   - Composite Index: `compId` (Asc) + `raceId` (Asc)

3. **leaderboards**:
   - Composite Index: `compId` (Asc) + `rank` (Asc)
   - Single Index: `compId` (Asc)

## Setup Instructions

### Option 1: Firebase Console GUI
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Navigate to Firestore Database
3. Create collection: `comps`
4. Create collection: `userCompJoinings`
5. Create collection: `payments`
6. Create collection: `leaderboards`
7. Manually create the first competition document

### Option 2: Firestore Rules Update
Update your Firestore rules to include the new collections:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      allow read: if request.auth.uid == userId;
      allow write: if request.auth.uid == userId;
    }

    // Comps collection (public read)
    match /comps/{compId} {
      allow read: if true;
      allow write: if request.auth.uid == resource.data.createdBy || isAdmin();
    }

    // User comp joinings
    match /userCompJoinings/{docId} {
      allow read: if request.auth.uid == resource.data.userId || isAdmin();
      allow write: if request.auth.uid == resource.data.userId || isAdmin();
    }

    // Tips
    match /tips/{tipId} {
      allow read: if request.auth.uid == resource.data.userId || isAdmin();
      allow write: if request.auth.uid == resource.data.userId || isAdmin();
    }

    // Leaderboards
    match /leaderboards/{docId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Payments
    match /payments/{paymentId} {
      allow read: if request.auth.uid == resource.data.userId || isAdmin();
      allow write: if isAdmin();
    }

    // Helper function
    function isAdmin() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.admin == true;
    }
  }
}
```

## Migration from Old System

For existing competitions, you need to:

1. Create a document in `comps` collection:
```json
{
  "compId": "default-comp",
  "name": "The Great Spring Tip Off",
  "description": "Legacy competition",
  "entryFee": 0,
  "status": "archived",
  "startDate": "2026-03-01T00:00:00Z",
  "endDate": "2026-04-30T23:59:59Z",
  "participantCount": 0
}
```

2. Migrate existing leaderboard entries to `userCompJoinings`:
```javascript
// For each user in old 'leaderboard' collection:
const existingLeaderboard = db.collection('leaderboard').doc(userId);
const joiningsDoc = db.collection('userCompJoinings').doc(`${userId}_default-comp`);
await joiningsDoc.set({
  userId: userId,
  compId: 'default-comp',
  joinDate: new Date(),
  paymentStatus: 'completed',
  stripePaymentId: 'migrated-legacy',
  rank: leaderboardData.rank,
  points: leaderboardData.points,
  wins: leaderboardData.winners,
  losses: 0
});
```

3. Update all existing `tips` documents to include `compId: 'default-comp'`

## Stripe Integration

For payment processing in the comps.html page:

1. Create a Stripe product for each competition entry
2. Store the Stripe price ID in the `comps` document
3. Use Stripe Checkout sessions to handle payment
4. Call a Cloud Function to verify payment status and update `userCompJoinings`

Example Stripe setup:
```javascript
// Initialize Stripe session for comp joining
const response = await fetch('/api/create-payment-session', {
  method: 'POST',
  body: JSON.stringify({
    userId: currentUser.uid,
    compId: selectedComp.id,
    priceId: selectedComp.stripePriceId,
    amount: selectedComp.entryFee
  })
});

const { sessionId } = await response.json();
window.location.href = `https://checkout.stripe.com/pay/${sessionId}`;
```

## Firestore Cloud Functions

You'll need to create these Cloud Functions:

### 1. `createPaymentCheckout`
Initializes Stripe payment session.

### 2. `handlePaymentSuccess`
Updates `userCompJoinings` when payment succeeds.

### 3. `updateCompLeaderboard`
Recalculates leaderboard after tips are submitted.

Template Cloud Function:
```typescript
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

const stripe = new Stripe(functions.config().stripe.key, {
  apiVersion: '2023-10-16'
});

export const createPaymentCheckout = functions.https.onCall(async (data, context) => {
  const { userId, compId, amount } = data;
  
  // Create Stripe session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'aud',
        product_data: { name: `Competition Entry - ${compId}` },
        unit_amount: Math.round(amount * 100)
      },
      quantity: 1
    }],
    mode: 'payment',
    success_url: `${process.env.HOSTING_URL}/comps.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.HOSTING_URL}/comps.html`,
    metadata: { userId, compId }
  });

  return { sessionId: session.id };
});

export const handlePaymentSuccess = functions.https.onRequest(async (req, res) => {
  const db = admin.firestore();
  const sig = req.headers['stripe-signature'];
  const endpointSecret = functions.config().stripe.webhook_secret;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, compId } = session.metadata;

    // Update userCompJoinings
    await db.collection('userCompJoinings').doc(`${userId}_${compId}`).set({
      userId,
      compId,
      joinDate: admin.firestore.FieldValue.serverTimestamp(),
      paymentStatus: 'completed',
      stripePaymentId: session.payment_intent,
      rank: 999999,
      points: 0,
      wins: 0,
      losses: 0
    }, { merge: true });
  }

  res.json({ received: true });
});
```

## Testing the System

1. Create a test comp in Firestore
2. Sign up as a new user
3. Join the comp with test Stripe card: `4242 4242 4242 4242`
4. Verify payment completes
5. Test tipping in that comp
6. Check leaderboard updates

## Backward Compatibility

All existing functionality should work with:
- Default comp ID: `default-comp`
- Existing `leaderboard` collection for legacy data
- Migration path for old users to new comp system
