# Firebase to Render Migration Plan

## Architecture

```
User → Render (Express API)
              ├── Firebase Auth (via Admin SDK + service account)
              ├── Gemini AI (via API key)
              ├── Neo4j AuraDB (via credentials)
              └── yt-dlp (via Docker or npm package)
```

---

## Step 1: Code Changes

### 1a. Rewrite entry point — `functions/src/index.ts`

- Remove `import {setGlobalOptions} from "firebase-functions/v2"`
- Remove `import {onRequest} from "firebase-functions/v2/https"`
- Remove `setGlobalOptions({ maxInstances: 10 })`
- Remove `export const api = onRequest(app)`
- Add Firebase Admin init import from new `firebase.ts`
- Add `app.listen(PORT)` at the end

### 1b. Create Firebase init — `functions/src/firebase.ts` (new file)

```ts
import * as admin from "firebase-admin";

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccount))
  });
} else {
  admin.initializeApp(); // for local dev (GOOGLE_APPLICATION_CREDENTIALS)
}

export const auth = admin.auth();
export const firestore = admin.firestore();
```

### 1c. Update route imports

**`routes/auth.ts`** and **`routes/course.ts`**
- Replace `import * as admin from "firebase-admin"` with `import { auth, firestore } from "../firebase.js"`
- Replace `admin.auth()` → `auth`
- Replace `admin.firestore()` → `firestore`

### 1d. Handle yt-dlp

| Option | Action |
|--------|--------|
| **Dockerfile** | Create `functions/Dockerfile` that installs yt-dlp + runs `npm start` |
| **youtube-dl-exec** | `npm install youtube-dl-exec`, rewrite `services/ytdlp.ts` to use it |

### 1e. Update `functions/package.json`

- Remove `"firebase-functions": "^7.0.0"` from dependencies
- Change `"start": "npm run shell"` → `"start": "node lib/index.js"`

---

## Step 2: Get Firebase Service Account

1. Go to **Firebase Console → Project Settings → Service Accounts**
2. Click **Generate New Private Key**
3. Save the downloaded JSON file (you'll paste its content into Render's env vars)

---

## Step 3: Setup Render

1. Push updated code to GitHub
2. Go to **render.com** → New **Web Service**
3. Connect repo `Kartik23453/modulo_learn_backend_firebase`
4. Configure:
   - **Root Directory**: `functions`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
5. Add environment variables in Render Dashboard:
   - `FIREBASE_SERVICE_ACCOUNT` (the full service account JSON)
   - `AURADB_URI`
   - `AURADB_USER`
   - `AURADB_PASSWORD`
   - `GEMINI_API_KEY`
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
6. Deploy

---

## Key Differences from Firebase

| Aspect | Firebase | Render |
|--------|----------|--------|
| **Entry point** | `export const api = onRequest(app)` | `app.listen(PORT)` |
| **Firebase Admin** | Auto-initialized | Needs service account JSON |
| **Secrets** | Firebase Secrets (Blaze) | Dashboard env vars |
| **yt-dlp** | Not available | Docker or npm wrapper |
| **Cold starts** | Fast | Slower (free tier sleeps) |
| **Outbound HTTP** | Requires Blaze | Always allowed |
