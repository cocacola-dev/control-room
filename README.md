# Control Room

Your life as data. Capture ideas and todos, track focus time, and see where your hours and attention actually go. Runs on Mac, Windows and iPhone from one codebase, and keeps those devices in step through a server only you can reach.

## Principles

- **Local-first.** All data lives in a database on the device (IndexedDB). The app works fully offline and never needs a server to function.
- **Private by construction.** The production build ships a strict Content Security Policy: only the app's own code can run and the app can only talk to its own address. There are no analytics, no trackers, no third-party requests.
- **Your data is yours.** Export everything as plain JSON at any time from Settings. Import merges by "newest wins", so an old backup never erases recent work.
- **Sync is a layer, not a dependency.** It runs over your private network, everything is encrypted before it leaves a device, and the app keeps working without it.

## Run it

```bash
npm install
npm start            # build the app and start the server: http://localhost:8787
```

`npm start` is how you use the app day to day. It serves the production build and the sync API from one small program.

Other scripts:

```bash
npm run dev          # development mode with hot reload: http://localhost:5173
npm run build        # production build into dist/ (includes the service worker)
npm run serve        # start the server without rebuilding
npm test             # sync tests: encryption, the server, and simulated devices syncing
npm run typecheck    # TypeScript
npm run lint         # oxlint
npm run generate:icons   # regenerate PWA icons from public/logo.svg
```

## Install on your devices

Control Room is a Progressive Web App. Install it once and it opens in its own window, works offline and keeps its data protected from browser cleanups.

- **Mac / Windows (Chrome, Edge):** open the app, then use the install icon at the right of the address bar, or the "Install app" button in Settings.
- **Mac (Safari):** File → Add to Dock.
- **iPhone / iPad:** open the app in Safari, tap Share, then "Add to Home Screen".

Installing, offline mode and sync require a secure address: `https://…` or `localhost`. "Set up sync" below gives every device the same https address.

## Set up sync

The idea in one paragraph: one computer you own (your Mac, to start with) runs the Control Room server. The server is invisible to the internet and to your Wi-Fi. Your devices reach it through [Tailscale](https://tailscale.com), a private network that only devices signed in to your account can join. On top of that, every record is encrypted on the device with a key the server never sees.

### 1. Put your devices on a private network

1. Create a Tailscale account and install Tailscale on the Mac, the iPhone and the PC. Sign in with the same account on each.
2. In the Tailscale admin console, open **DNS** and turn on **MagicDNS** and **HTTPS Certificates**.

Turning on HTTPS certificates lists your machine's address (`machine-name.tailnet-name.ts.net`) in public certificate logs. Nobody can connect to it from outside, but the name itself is visible, so avoid personal details in the machine and tailnet names.

### 2. Start the server and share it inside your network

```bash
npm start                    # terminal 1: leave it running
tailscale serve --bg 8787    # terminal 2: once
```

`tailscale serve` prints an address like `https://my-mac.tail1234.ts.net`. That is your Control Room address, on every device. If the `tailscale` command is not found on a Mac, use `/Applications/Tailscale.app/Contents/MacOS/Tailscale` in its place. Command options change between Tailscale versions: `tailscale serve --help` shows the current ones.

Use `tailscale serve`, which stays inside your network. **Never use `tailscale funnel`**: that publishes a server to the whole internet.

### 3. Move your existing data to the new address

A browser keeps a separate database for every address. What you tracked so far lives under the address you have been using (for example `localhost:5173`), and is not visible at the new address until you carry it over:

1. Open the app where your data is now. Settings → **Export backup**.
2. Open the new https address. Settings → **Import backup**.

From now on use the https address everywhere, including on the Mac itself.

### 4. Turn sync on

1. On the device that has your data: Settings → Sync between devices → **Set up sync**.
2. The app shows a **sync key**, once. Save it in a password manager.
3. On each other device: open the same address, install the app, go to Settings and enter the key.

After that, sync is automatic. A small marker at the bottom of the sidebar (a cloud icon on the phone) shows its state.

### Good to know

- **The server has to be running and reachable for sync to happen.** If the Mac is asleep or Tailscale is off, every device keeps working on its own and catches up later. Nothing is lost.
- **Moving the server later is easy**, for example to a small always-on computer. Copy the project and `~/.control-room/sync/vault.jsonl` over, run `npm start` and `tailscale serve` there, then open the new address on each device and enter the sync key. Because the stored data is encrypted, even a rented server would not be able to read it.
- **Lost the sync key, or lost a device?** Start over with a new key:
  1. If a device is lost, remove it from your network in the Tailscale admin console first.
  2. Stop the server, delete `~/.control-room/sync/vault.jsonl`, start the server again.
  3. On the device with the most complete data: Settings → Turn off, then **Set up sync**. This makes a new key and uploads everything again.
  4. On every other device: Settings → Turn off, then enter the new key.
- **Server options** (environment variables): `PORT` (default 8787), `SYNC_DATA_DIR` (default `~/.control-room/sync`), `SYNC_ALLOWED_HOSTS` (extra host names to answer to, comma separated). `HOST` changes the listening address and should stay at its default, `127.0.0.1`.

## How sync works

- **Every record has a timestamp, and the newest version wins.** Each idea, todo, project and time block carries `updatedAt`. When two versions of the same record meet, the newer one replaces the older one whole. Deleting is just another edit (it sets `deletedAt`), so deletions travel the same way.
- **Each device remembers what the server has.** For every record it notes which version the server holds. Anything that differs gets sent. Nothing depends on code remembering to flag a change.
- **A run is pull, then push.** The device fetches what changed since last time, decrypts and checks it, merges it, then sends its own changes. The server accepts a push only from a device that has already seen everything on it. If another device got in first, this one pulls again and retries. That gives all devices one agreed order of events without the server ever looking inside a record.
- **When it runs.** When the app opens, a moment after you change something, when you return to the app, when the network comes back, and every 30 seconds while the app is on screen. A closed app does not sync in the background.
- **Clocks that disagree.** A device with a slow clock could stamp an edit earlier than the version it edited, and the edit would lose. To prevent that, a local edit is always stamped at least a millisecond later than the version it replaces.
- **Two timers.** If two devices each start a timer while apart, the one started last keeps running after they sync, and the earlier one is ended where the later one began.

What sync does not do:

- **No merging inside a record.** If two devices edit the same todo before syncing, the later edit wins and the earlier one is replaced.
- **Settings stay per device.** Theme, timer lengths and the Insights range are not synced.
- **Deleted records are kept as small markers** on devices and on the server, so that the deletion can reach every device.

## Security

### What protects what

| Layer | What it stops |
| --- | --- |
| Server listens on `127.0.0.1` only | Nothing on your Wi-Fi or the internet can connect to it. There is no open port to scan or attack. |
| Tailscale | Only devices signed in to your account can reach the server. Traffic between them travels in an encrypted tunnel, with HTTPS inside it. |
| End-to-end encryption (AES-256-GCM) | The server, its data file, and anyone who copies that file see scrambled bytes. Changing a stored record, or passing one record off as another, is detected and the record is refused. |
| Sync key never leaves your devices | The server gets a token derived from the key (HKDF-SHA-256), which proves a device belongs but cannot decrypt anything. The server stores only a hash of that token. On each device the encryption key is kept as a non-extractable browser key: the app can use it, but its bytes cannot be read back, not even by the app. |
| Access token on every sync request | A device on your network without the key gets nothing and can write nothing. |
| Same-site checks on the API | A website you happen to visit cannot use your browser to talk to the server. Requests from other sites and for unknown host names are refused. |
| Incoming data is never trusted | Every record from the server or a backup file is rebuilt field by field from values of the expected type. Unknown fields are dropped. Malformed records are rejected. |
| Content Security Policy | Only the app's own code runs, and the page can only talk to its own address. Sync goes to that same address, so this rule did not have to be loosened for it. The server also sends the policy as a header with `frame-ancestors 'none'`, so no other page can embed the app. |
| No added dependencies | The encryption is the browser's built-in Web Crypto. The server uses only Node's standard library. The one new package (`fake-indexeddb`) is used by tests and never ships. |

### What the server can see

The number of records, a random id for each, each record's size rounded up to a multiple of 256 bytes, and when devices connect. Not titles, notes, projects, times, or even which kind of record is which.

### Limits you should know

- **The sync key plus access to your network equals your data.** Keep the key in a password manager. If it may have leaked, start over with a new key.
- **An unlocked device shows its own data.** The local database is protected by the device's lock screen and disk encryption, not by the sync key.
- **A tampered server could hide or replay data.** It cannot read or forge records, but it could withhold changes or serve an older version of a record. Devices keep their own copies, so nothing on a device is lost. Since the server is your own computer, this matters mostly if you later rent one.

### Also in place

- `script-src 'self'`: no inline scripts, no third-party scripts. The service worker is registered from the bundle, not from an injected inline tag.
- Dependencies are pinned through `package-lock.json`. `npm audit` is clean at moderate and above; the remaining low findings are in build-time tools (workbox and the shadcn CLI) that never ship to the browser.
- The sync data file is created readable by your user account only, outside the project folder and outside iCloud.

## Project layout

```
src/
  main.tsx            entry: theme, service worker registration, sync start, render
  App.tsx             routes
  index.css           Tailwind + shadcn theme tokens + app base rules
  db/
    schema.ts         data model (Project, Item, Session), shared record fields, sync bookkeeping types
    db.ts             Dexie database, indexes, and the rule that keeps `updatedAt` moving forward
    repo.ts           all writes: create, update, soft-delete, convert, wipe
    export.ts         backup format, validation, merge-import
  sync/
    codec.ts          the sync key, key derivation, encrypting and decrypting one record
    records.ts        strict checks for records arriving from outside the device
    api.ts            the only network code: four calls to the app's own address
    engine.ts         pull, merge, push
    sync.ts           when sync runs, and its status for the UI
  hooks/
    useData.ts        live queries (re-render automatically when data changes)
    useNow.ts         ticking clock
  lib/
    theme.ts          light / dark / system
    settings.ts       timer preferences (durations, chime, keep awake), stored per device
    sessions.ts       all time math: elapsed, remaining, formatting, daily sums
    insights.ts       every number on the Insights page, as pure functions over the records
    timerActions.ts   start focus / start break, long-break suggestion
    alerts.ts         generated chime, system notifications, vibration
    wakeLock.ts       keep the screen on during focus (opt-in)
    install.ts        install prompt capture, platform detection
    dates.ts, ids.ts  helpers
  components/         app shell, quick capture, item rows, dialogs
    TimerEngine.tsx   app-wide: ticks the running block, ends it on time, fires alerts
    FocusTimer.tsx    the timer UI: setup, running, what-next
    SyncCard.tsx      Settings: set up, join, status, turn off
    SyncBadge.tsx     the small sync state marker in the sidebar and phone top bar
    charts/           column chart, ranked bars, table view: plain HTML and CSS, no chart library
  components/ui/      shadcn/ui primitives (generated)
  pages/              Today, Inbox, Focus, Log, Projects, Insights, Settings
server/
  server.mjs          serves the built app and stores encrypted sync data. No dependencies.
  server.test.mjs     tests against a real HTTP listener
tests/
  sync.test.mjs       encryption, record checks, and simulated devices syncing through the real server
  register.mjs        test setup: in-memory IndexedDB, and the "@/…" import alias for Node
vite.config.ts        Tailwind, PWA manifest + service worker, CSP injection, dev proxy for /api
```

## Data model

Every record carries `id` (UUID), `createdAt`, `updatedAt` and `deletedAt`. Deletes are soft. That is what makes sync a merge: the newest `updatedAt` wins, and a deletion is just another update.

| Table      | What it holds                                                         |
| ---------- | --------------------------------------------------------------------- |
| `projects` | Areas of life or work. Name, color, archived flag.                    |
| `items`    | Ideas and todos in one table so either can become the other.          |
| `sessions` | Focus and break blocks: start, end, paused time, project, todo, note. Written by the timer or logged by hand. |
| `syncState`, `syncedVersions` | Sync bookkeeping: the device's key and position, and which version of each record the server holds. Never exported, never sent. |

## How the timer works

The timer never counts seconds. A running block is a session row with a start timestamp and no end. The display is `now - start - paused`, recomputed every second, so closing the tab, switching apps or the phone sleeping cannot drift it. When the planned length is reached, the block is ended at exactly its planned end time (even if the app noticed late), a chime plays, a system notification fires if allowed, and the next step is offered: a short break, a long break after the configured number of blocks, or another focus block.

Blocks stopped early are kept and marked as such. Blocks under a minute are discarded. Time that happened without the timer can be logged by hand from Focus or Log.

On iPhone, an installed app receives notifications and the timer stays accurate, but the alert may be delayed while the app is in the background. "Keep screen awake during focus" in Settings avoids that.

With sync on, a block started on one device shows as running on the others once they sync, and each open device alerts when it ends.

## How Insights works

Insights answers four questions: how much you focused, when, on what, and whether todos are being closed faster than they pile up.

- **One filter row.** A date range (7 days, 30 days, 12 weeks, 12 months) and an optional project. Every tile and chart below reads from the same slice, so the numbers always agree with each other.
- **Comparison.** The arrows on the tiles compare the range with the same number of days right before it. They stay hidden until there is earlier data to compare against.
- **Each chart states its takeaway in words** ("Tuesdays are strongest", "The backlog grew by 3"), so you do not have to read bars to get the point.
- **Rules behind the numbers.** A block counts toward the day it started on. Minutes are rounded per block, so a total always equals the sum of the rows you can see. Weekdays are compared by average, because a 30-day range holds five of some weekdays and four of others. A block that crosses an hour boundary is split between the hours.
- **No chart library.** The charts are ordinary HTML and CSS in `src/components/charts/`. That keeps the dependency list short, which is part of the security posture. Every chart has a table view with the same numbers, works with the keyboard (arrow keys), and uses two colors chosen to stay distinguishable with color blindness.

All of the math lives in `src/lib/insights.ts` as pure functions: records in, numbers out, no database and no UI.

## Roadmap

1. **Foundation** (done): install anywhere, local database, capture, projects, backup.
2. **Core tracking** (done): Focus timer that logs sessions, manual time, daily log, timer settings.
3. **Insights** (done): dashboard with date ranges, comparison against the previous period, focus per day, by weekday and by hour, time per project and per todo, todo flow, streak.
4. **Encrypted sync** (done): end-to-end encrypted sync between devices through your own server on a private network (Tailscale).
5. **Learning and habits:** spaced-repetition reminders, habits, mood and energy, journaling.
6. **Native polish:** optional Tauri wrapper for menu-bar timer and global hotkeys.
