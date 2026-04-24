# Firebase automation (Gmail + Google Calendar)

This folder contains a **Firebase Cloud Functions** backend that runs “after the AI receives a message”.

The intended pipeline is:

1. Your AI layer (e.g. `scheduler_bot.py`, or the Expo app) writes an `automationRequests/{requestId}` document in Firestore.
2. A Cloud Function triggers on document creation.
3. The function uses **Google APIs** to:
   - send an email via **Gmail**, or
   - create an event in **Google Calendar**
4. The function writes `status`, `result`, and `error` back onto the same Firestore document.

## Firestore schema

Collection: `automationRequests`

`userId` can be any stable identifier. If you enqueue from `scheduler_bot.py`, it uses `telegram:<telegramUserId>` (example: `telegram:123456789`).

Example “send email” request:

```json
{
  "userId": "abc123",
  "type": "send_email",
  "payload": {
    "to": "student@example.com",
    "subject": "Meeting confirmed",
    "bodyText": "See you tomorrow at 3pm."
  },
  "status": "queued",
  "createdAt": "<server timestamp>"
}
```

Example “create calendar event” request:

```json
{
  "userId": "abc123",
  "type": "create_calendar_event",
  "payload": {
    "calendarId": "primary",
    "summary": "Project sync",
    "description": "Weekly check-in",
    "start": "2026-04-24T15:00:00-04:00",
    "end": "2026-04-24T15:30:00-04:00",
    "attendees": ["person1@example.com", "person2@example.com"]
  },
  "status": "queued",
  "createdAt": "<server timestamp>"
}
```

Status transitions:

- `queued` → `processing` → `done`
- On failure: `queued`/`processing` → `error`

## Google auth model (recommended)

- Store **one refresh token per user** in Firestore:
  - `users/{userId}/integrations/google` (document)
  - field: `refreshToken`
- Store your OAuth app credentials as **Firebase secrets**:
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_REDIRECT_URI`

> Important: `GOOGLE_OAUTH_REDIRECT_URI` must match the Expo redirect URI **exactly**.
> For Expo Go with `useProxy: true`, it typically looks like `https://auth.expo.io/@YOUR_EXPO_USERNAME/DoMyWork`.
> If this does not match what is configured in Google Cloud Console, Google will show **"Access blocked"** errors (often `redirect_uri_mismatch`).

> Note: Getting refresh tokens requires an OAuth consent flow (user signs in). This repo only scaffolds the server-side execution.

## Local install (functions)

From the repo root:

```bash
cd firebase/functions
npm install
npm run build
```

## Deploy

This layout keeps Firebase config under this folder. You can deploy with:

```bash
firebase --config firebase/firebase.json deploy --only functions
```

This repo is currently configured to deploy to Firebase project `domywork-df38f` via `firebase/.firebaserc`.

Before deploying, set secrets:

```bash
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_ID
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
firebase functions:secrets:set GOOGLE_OAUTH_REDIRECT_URI
```
