# Greenwave Ops

Invoicing, stock, photos and a time clock for Greenwave Recycling and
Greenwave Healthcare. Starts **completely empty** — no demo data.

## Run it

**On a computer:** unzip and double-click `index.html`.

**On phones and tablets:** you need it served over http, so run

```bash
./serve.sh
```

It prints two addresses. Open the `http://192.168.x.x:8080` one on any phone
on the same wifi, then **Add to Home Screen** — it installs like an app, opens
full screen with no browser bars, and works with no signal.

## About "an iOS app and an Android app"

This installs to the home screen on both, from one codebase, with no App Store
review, no Apple developer account and no build step. For an internal staff
tool that is the right answer right now.

What it does **not** do that a store-built native app would: background GPS,
push notifications when the app is closed, and reading a weighbridge over
Bluetooth or serial. When you need those, the same screens get rebuilt in
React Native — but that only makes sense once there is a server for them to
sync with, because a native app with per-device storage has the same limits
this one does.

## Signing in (V2 — real server authentication)

Sign-in is email **and password**, checked by the real GreenWave API
(`app/api` in the `FULL-INFRA-V.0001` repo) against PostgreSQL — not by the
browser. The first time the server has zero accounts, this app's gate offers
"First time setting this up?", which creates exactly one administrator and
then permanently disables itself; every other account is created by an
administrator (`POST /users`), never by anyone signing themselves up.

The browser is never the authority: a password gets bcrypt-checked on the
server, a JWT comes back, and that token — not anything typed into this
page — is what every subsequent request is checked against. See
`docs/V2_ARCHITECTURE.md` in the API repo for the full model.

Three roles, enforced **server-side** on every request (the sidebar just
hides buttons a role can't use — it isn't what stops them):

| | Stock, weigh-in, photos, clock | Invoices, customers, materials, history | Staff, settings |
|---|---|---|---|
| **Staff** | ✅ | | |
| **Manager** | ✅ | ✅ | |
| **Administrator** | ✅ | ✅ | ✅ |

**Status note:** sign-in/sign-out, invoices, inventory, customers, materials,
warehouses, photos, time clock and history are all wired to the real server
(`assets/api.js`) as of Gate 1 staging — `localStorage`/IndexedDB now act as
a read-through cache, refreshed from the API on each view, not the source of
truth. The in-app **Staff** screen creates real accounts via `POST /users`;
there is no deactivate/reactivate endpoint yet, so that control isn't shown.
Customer and material **delete** aren't wired either — no `DELETE` endpoint
exists for either yet, so those buttons were removed rather than left as
fake local-only deletes that would resurrect on reload. See
`docs/V2_IMPLEMENTATION.md` for the full list of what changed and what's
still outstanding.

## Invoices *(Recycling only)*

**Every field is a text box.** Company name, address, business number, bill
to, ship to, ship via, invoice number, the tax label *and* the tax rate — type
over any of it. Customers and warehouses only *prefill*; nothing is locked,
because real invoices always need a one-off change somewhere.

- Amounts and totals compute as you type.
- **Rebate lines subtract.** Tick *Rebate* when you're paying the customer for
  their material instead of charging them, and one document covers both
  directions. Below zero it reads *Payable to customer*.
- Warehouse prefills tax: GST 5% out of BC and Alberta, HST 13% out of
  Ontario. Type over it whenever a job needs something else.
- **Print / PDF** prints the invoice alone — no sidebar, no form controls.
- Numbering continues from 1114, so your next one is 1115.

Checked against your invoice 1114: 3.658 t × $140.00 = **$512.12**, GST
**$25.61**, total **$537.73**.

## Photos

Tap **Add photo** — on a phone this opens the camera. Staff see their own;
**managers and administrators see every photo anyone has taken**, tagged with
who took it and when. Administrators can delete.

Photos are downscaled to 1600px before saving. A phone photo is 4-8 MB; this
stores it at roughly 300 KB, still easily good enough to read a plate, a seal
number or a contaminated load. It also strips EXIF, so a customer's GPS
coordinates don't travel with a picture of their bin.

They live in IndexedDB, not localStorage — which caps out around 5 MB and would
break the whole app after a handful of pictures.

## Time clock

One button. Live counter while you're on shift, your last 7 days, and your
shift history. Managers and administrators also see the whole team's hours and
who is on shift right now. A green chip in the top bar follows you around the
app while the clock is running.

## History

Every sign-in, ticket, photo, invoice, clock-in and staff change, with who and
when. Administrators and managers only.

## Where your data lives

**In this browser, on this device.** Private, works offline, and gone if you
clear site data. Nobody else on the team sees it — two people using this on two
phones have two separate sets of records.

**Settings → Export backup** downloads a `.json`. Do it regularly.

Note the JSON does **not** include photos — they are far too large. Photos stay
on the device that took them.

That per-device limit is the real reason to move this onto your own servers.
`greenwave-ops-brief.md` is the plan: Postgres on 192.168.1.22, MinIO for
photos, the API nodes you already have.

## Not built — and why

**Enterprise / Phase 2** — index-linked commodity pricing, EDI 810/850/856,
consolidated parent-child invoicing, ESG and Scope 3 reporting, dual approval
over $5,000, immutable audit trails.

None of it can work on per-device browser storage. Every item needs a server:
a shared database two people can both write to, a scheduled job to pull
Fastmarkets or LME prices, an endpoint a customer's SAP can transmit to, and
an audit log nobody can edit. Building them here would produce something that
looks right on one laptop and falls apart the moment a second person uses it.

Also outstanding: dispatch and routing, the driver route app, certificates of
recycling and destruction, and the double-entry ledger.

## Files

```
index.html              app shell and all views
assets/app.css          styling, print layout, mobile
assets/app.js           all logic
assets/api.js           GreenWave API client (V2 — auth is wired; see Signing in above)
assets/store.js         localStorage state (client cache, not server-authoritative — see V2 notes)
assets/photos.js        IndexedDB photo storage
assets/logo.png         your logo
manifest.webmanifest    home-screen install
sw.js                   offline cache
serve.sh                local server for phone testing
```

No build step, no dependencies. Open it in Claude Code and extend it directly.
