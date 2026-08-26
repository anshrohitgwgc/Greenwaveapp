# GreenWave — staff app

One Expo codebase that ships as **iOS app, Android app and web app**: pickups,
dropoffs, material and weight entry, job photos, staff accounts and clocked
hours.

- Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript · expo-router
- Auth: email + password (only emails in the staff database can sign in)
- Data: TanStack Query · Zustand for session · tokens in Keychain /
  EncryptedSharedPreferences on device
- Runs **without a backend** out of the box (mock mode) so you can click
  through everything today

---

## Quick start

Requires Node 20.19.4 or newer.

```bash
chmod +x setup.sh
./setup.sh
npm run web        # or: npm run android / npm run ios
```

It starts in **mock mode** with demo data. Sign in with any password as:

| Email | Role | Sees |
| --- | --- | --- |
| `admin@gwgc.cloud` | Administrator | Everything, including staff accounts |
| `manager@gwgc.cloud` | Manager | All jobs, all hours, can schedule work |
| `driver@gwgc.cloud` | Driver | Only their own jobs and their own hours |

Running on a phone: install **Expo Go**, run `npm start`, scan the QR code.

---

## Connecting your real API

Edit `.env`:

```bash
EXPO_PUBLIC_USE_MOCK=0
EXPO_PUBLIC_API_BASE_URL=https://api.gwgc.cloud/api/v1
```

Restart the dev server (env vars are read at bundle time, so a hot reload is
not enough).

**`docs/openapi.yaml` is the contract.** It describes every endpoint the app
calls — request shapes, response shapes, and the rules the server must enforce
(drivers only see their own jobs, photos come back as signed MinIO URLs,
`totalWeightKg` is computed server-side).

Two ways to connect:

1. **Implement the contract.** Point Claude Code CLI at your Fastify project
   with `docs/openapi.yaml` and it can scaffold the routes directly.
2. **Remap the app.** If your API already has these capabilities under
   different route names, edit **`src/api/endpoints.ts`** — that one file holds
   every URL the app uses, and nothing else hardcodes a path. If field names
   differ too, adjust `src/api/service.ts`, which is the only place that maps
   HTTP responses onto app types.

> ### One thing to check before you wire it up
>
> The API you described — `https://mgmt-api.gwgcservers.ca/api/v1` with
> `/overview`, `/incidents`, `/backups`, `/docker/containers`, `/n8n/control`
> — is the **infrastructure Management Portal**: it manages servers, not
> business records. There are no routes there for pickups, materials, weights,
> staff hours or job photos, and your own architecture notes exclude the
> Management Portal from the app.
>
> So this app needs a **second, separate API** for business data. Same Fastify
> stack, same PostgreSQL/Redis/MinIO, different service and different hostname
> (`api.gwgc.cloud`). Keeping them apart matters: a driver's phone should never
> hold a token that can reach `/docker/containers`.

---

## What's in the app

| Screen | Who | What it does |
| --- | --- | --- |
| **Today** | everyone | Shift status, today's counts, your jobs for today |
| **Jobs** | everyone | Search + filter by type, status, assignee |
| **Job detail** | everyone | Status changes, material + weight entry, photos |
| **New / edit job** | manager, admin | Schedule a pickup or dropoff, assign a driver |
| **Hours** | everyone | Clock in/out, live timer, your last 14 days |
| **Staff hours** | manager, admin | Everyone's shifts, grouped and totalled |
| **Staff** | manager, admin | The team; admins add and deactivate accounts |

**Roles.** `driver` sees and completes only jobs assigned to them.
`manager` schedules work and sees everyone. `admin` also manages staff
accounts. The app hides what a role can't use — **the API must enforce the
same rules**, since a client can always be tampered with.

**Photos.** Camera or library, up to 10 per job
(`EXPO_PUBLIC_MAX_PHOTOS_PER_JOB`), uploaded as multipart with a progress
bar. Enforce the cap and a size limit server-side too.

---

## Project layout

```
app/                      expo-router routes — the file tree IS the navigation
  (auth)/login.tsx        sign in
  (app)/(tabs)/           Today · Jobs · Hours · More
  (app)/job/[id].tsx      job detail: status, weights, photos
  (app)/job/new.tsx       create + edit (same form, ?editId=)
  (app)/staff/           team list and add-staff form
  (app)/timesheets.tsx    all-staff hours

src/
  api/
    endpoints.ts          ← every URL, in one file. Edit here to remap.
    service.ts            ← the only layer screens call; switches mock ↔ HTTP
    client.ts             fetch wrapper: bearer auth, timeout, 401 refresh
    upload.ts             multipart photo upload with progress (XHR)
    mock.ts               in-memory backend for demo mode
    queries.ts            React Query hooks + cache invalidation
    types.ts              domain types, mirroring docs/openapi.yaml
  auth/                   session store + secure token storage
  components/             UI kit, JobCard, PhotoGrid, WeightEntry
  theme.ts                colours, spacing, type scale, status styling
  utils/                  formatting, dates, cross-platform dialogs
```

---

## Shipping

### Web

```bash
npm run build:web        # static bundle in dist/
```

Serve `dist/` from NGINX on VM 101. It's a single-page app, so all unknown
paths must fall through to `index.html`:

```nginx
location / {
  root /var/www/greenwave;
  try_files $uri $uri/ /index.html;
}
```

### iOS and Android

```bash
npm install -g eas-cli
eas login
eas build:configure          # writes your real projectId into app.json
```

Then fill in the placeholders:

- `app.json` → `extra.eas.projectId`
- `eas.json` → `submit.production.ios` (Apple ID, App Store Connect app ID,
  team ID) and the Google Play service-account key path

```bash
npm run build:android        # AAB for Play Store
npm run build:ios            # IPA for App Store
npm run submit:android
npm run submit:ios
```

Bundle identifier is `cloud.gwgc.greenwave` on both platforms — change it in
`app.json` before your first build if you want something else, because it
can't be changed after the app is published.

`assets/` currently holds a **generated placeholder** icon and splash. Replace
them with the real GreenWave mark before you submit: `icon.png` (1024×1024,
opaque), `adaptive-icon.png` (1024×1024, transparent, artwork inside the
middle ~66%), `splash.png`, `favicon.png`.

### Over-the-air updates

Once you're live, `eas update` pushes JS-only changes to installed apps
without an app-store review — worth setting up early.

---

## Notes and known gaps

- **Offline.** The app needs a connection. Drivers in a yard with no signal
  will see errors rather than a queue. If that matters, the next step is
  persisting the React Query cache and queueing mutations.
- **Date and time entry** uses chips plus a typed `YYYY-MM-DD` / `HH:MM`
  field rather than a native picker, so it behaves identically on all three
  platforms. Swap in `@react-native-community/datetimepicker` on native if
  you prefer.
- **Push notifications** are not wired up. `expo-notifications` plus a device
  token on the staff record is the usual next step for "you've been assigned
  a job".
- **Typed routes** are off (`app.json` → `experiments.typedRoutes`). Turn them
  on once you're building locally and TypeScript will check every navigation.
- **Reports and billing** exist in your feature list but aren't in this build —
  worth designing once real job data is flowing.
