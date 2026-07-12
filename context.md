# Project Context

## Overview
YT Tracker — a backend API that processes YouTube videos/playlists, generates timestamps using Gemini AI, stores course data in Neo4j AuraDB, and manages user auth via Firebase Auth.

## Architecture
```
User → Express API (deployed on Render)
         ├── Firebase Auth (Admin SDK + service account)
         ├── Gemini AI (via google-generative-ai SDK)
         ├── Neo4j AuraDB (via neo4j-driver)
         └── yt-dlp (via youtube-dl-exec npm package)
```

## Firebase Project
- **Project ID:** `modulo-learn-75e14`
- **GitHub repo:** `Kartik23453/modulo_learn_backend_firebase`
- **Local folder:** `yt_tracker`
- **Plan:** Spark (free) — Blaze required for Cloud Functions outbound HTTP

## Firebase → Render Conversion

### Why we moved
Firebase Cloud Functions (Spark free plan) **blocks all outbound HTTP calls**, which are required for Neo4j and Gemini API access. Upgrading to Blaze (pay-as-you-go) would fix this but requires a payment plan. Render's free tier allows outbound HTTP without any upgrade.

### What changed (Step 1 — COMPLETED ✓)

| Change | Details |
|--------|---------|
| **Entry point** | Originally wrapped Express in `onRequest(app)` for Firebase Functions. Now uses standard `app.listen(PORT)` |
| **Firebase Admin** | Originally `admin.initializeApp()` auto-detected in Firebase env. Now uses **service account JSON** passed via `FIREBASE_SERVICE_ACCOUNT` env var |
| **Routes** | `auth.ts` and `course.ts` now import `auth`/`firestore` from local `firebase.ts` instead of `firebase-admin` directly |
| **yt-dlp** | Originally used `child_process.execFile("yt-dlp")`. Now uses `youtube-dl-exec` npm package (bundles yt-dlp) |
| **package.json** | Removed `firebase-functions` dependency. Start script now runs `node lib/index.js` |

### Verification
- Build passes (`tsc` — no errors)
- Server starts and responds on port 3000
- `/test` endpoint returns "Up and Running"

### Remaining steps (PENDING)
**Step 2** — Download Firebase Admin service account JSON
1. Go to https://console.firebase.google.com/project/modulo-learn-75e14/settings/serviceaccounts/adminsdk
2. Click **Generate New Private Key**
3. Save the JSON — will be used as `FIREBASE_SERVICE_ACCOUNT` env var on Render

**Step 3** — Deploy on Render
- **Web Service** from GitHub repo `Kartik23453/modulo_learn_backend_firebase`
- **Root Directory:** `functions`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Env vars needed:**
  - `FIREBASE_SERVICE_ACCOUNT` (service account JSON)
  - `AURADB_URI`, `AURADB_USER`, `AURADB_PASSWORD`
  - `GEMINI_API_KEY`
  - `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`

For full details, see `Firebase_to_Render.md`.

## API Endpoints

### GET /test
Health check. Returns `"Up and Running"`.

### POST /ask
Processes a YouTube video or playlist URL. Returns timestamps.
- **Body:** `{ "url": "..." }`
- If video has chapters → returns those directly
- Otherwise → fetches transcript via yt-dlp, generates timestamps via Gemini
- **Files:** `routes/ask.ts` → `services/ytdlp.ts` → `services/gemini.ts`

### POST /auth/signup
Creates a new Firebase Auth user + Firestore document.
- **Body:** `{ "name", "email", "password" }`

### POST /auth/login
Authenticates using Firebase REST API (email/password). Returns idToken.
- **Body:** `{ "email", "password" }`

### GET /auth/me?uid=...
Returns user profile from Firestore. Requires Bearer token.

### POST /courses (Auth required)
Creates a course with lectures in Neo4j.
- **Body:** `{ "title", "metadata", "thumbnail", "lectures[]" }`

### POST /courses/:courseId/enroll (Auth required)
Enrolls user in a course with a deadline.
- **Body:** `{ "deadline" }` (ISO date)

### POST /courses/:courseId/lectures/:lectureId/complete (Auth required)
Marks a lecture as completed by the user.

### GET /courses/:courseId/progress (Auth required)
Returns completion percentage, remaining lectures, deadline, pace.

### GET /courses (Auth required)
Lists all courses the user is enrolled in with progress.

### GET /help
Returns an HTML page documenting all endpoints.

## Neo4j Data Model

### Nodes
- **Course** — `{ id, title, metadata, thumbnail }`
- **Lecture** — `{ id, title, duration }`
- **User** — `{ id }`

### Relationships
- `(Course)-[:CONTAINS]->(Lecture)`
- `(User)-[e:ENROLLED_IN { deadline }]->(Course)`
- `(User)-[:COMPLETED]->(Lecture)`

### Key queries (in `services/neo4j.ts`)
| Function | Purpose |
|----------|---------|
| `createCourse()` | MERGE Course + Lecture nodes, CONTAINS relationship |
| `enrollUser()` | MERGE ENROLLED_IN relationship with deadline |
| `completeLecture()` | MERGE COMPLETED relationship |
| `getCourseProgress()` | MATCH enrollment + lectures + completed, compute % |
| `getUserCourses()` | Same as progress but for all enrolled courses |

## Key Dependencies
| Package | Purpose |
|---------|---------|
| `express` | Web framework |
| `firebase-admin` | Firebase Auth + Firestore access |
| `neo4j-driver` | Neo4j AuraDB connection |
| `@google/generative-ai` | Gemini AI SDK |
| `youtube-dl-exec` | YouTube metadata extraction (bundles yt-dlp) |
| `cors` | CORS middleware |
| `dotenv` | Local env var loading |

## How config.ts works
- **Local dev:** Checks `FUNCTIONS_EMULATOR === "true"` → loads `.env` via dotenv
- **Production:** Firebase Secrets Manager or Render env vars → read directly from `process.env`
- All `get*Config()` functions return values with `|| ""` fallbacks

## How firebase.ts works
- If `FIREBASE_SERVICE_ACCOUNT` env var exists → parse JSON and use `credential.cert()`
- Otherwise → fallback to `admin.initializeApp()` (for local dev with `GOOGLE_APPLICATION_CREDENTIALS`)
- Exports `auth` (Admin Auth) and `firestore` (Admin Firestore) instances

## Local Development
```bash
# Build TypeScript
cd functions && npm run build

# Run server (needs .env file with all secrets)
node lib/index.js

# Or run directly with tsx (hot reload)
npx tsx watch src/index.ts
```

## .env Format (required for local)
```
AURADB_URI=bolt+s://...
AURADB_USER=neo4j
AURADB_PASSWORD=...
GEMINI_API_KEY=...
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=modulo-learn-75e14
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...
```

## Project Structure
```
yt_tracker/
├── .firebaserc
├── firebase.json
├── .env                          # Local secrets (gitignored)
├── Firebase_to_Render.md         # Migration plan doc
├── context.md                    # This file
└── functions/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts              # Entry point (Express + app.listen)
        ├── firebase.ts           # Firebase Admin init
        ├── config.ts             # Config (env vars)
        ├── routes/
        │   ├── index.ts          # Router aggregator
        │   ├── auth.ts           # Auth endpoints
        │   ├── course.ts         # Course CRUD endpoints
        │   ├── ask.ts            # YouTube processing endpoint
        │   ├── help.ts           # API guide page
        │   └── test.ts           # Health check
        └── services/
            ├── neo4j.ts          # Neo4j queries
            ├── gemini.ts         # Gemini AI calls
            └── ytdlp.ts          # YouTube extraction
```
