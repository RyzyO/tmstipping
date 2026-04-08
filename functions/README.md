# Firebase Cloud Functions for Notifications

This folder contains notification functions for:

- Admin notifications (all users, competition users, or one user)
- User test notifications
- Scheduled race reminders (5 minutes before race time, Sydney timezone)

## Deploy

1. Install Firebase CLI if needed:

   npm install -g firebase-tools

2. Log in:

   firebase login

3. From the project root, deploy functions:

   firebase deploy --only functions

## Exported Functions

- sendAdminNotification (callable)
- sendUserTestNotification (callable)
- sendNotificationTest (callable, backward-compatible alias)
- upsertRaceReminderSubscriptions (callable)
- sendRaceReminderNotifications (scheduled every minute)

## Data Notes

- User tokens are read from users/{uid}.fcmToken and users/{uid}.fcmTokens.
- Notification history is written to notifications.
- User race reminder subscriptions are written to userRaceReminderSubscriptions/{uid}.
- Reminder dedupe markers are written to raceReminderSends/{raceId_date_time}.
