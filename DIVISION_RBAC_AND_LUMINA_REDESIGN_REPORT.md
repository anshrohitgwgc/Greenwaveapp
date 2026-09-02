# GreenWave V2 — Division Access Control + Lumina Web Redesign

**Status: LOCAL ONLY. Production NOT DEPLOYED, NOT MODIFIED.**

---

## 1. Branch / source safety

| | |
|---|---|
| Current branch | `greenwave-payment-rbac-ui` |
| Starting HEAD | `88cb121` fix(invoices): use postgres sequence starting at 10000 |
| Current HEAD | `9116bb5` test(web): verify division-aware navigation and views |
| Remote HEAD | `88cb121` — **5 commits ahead locally, nothing pushed** |
| `greenwave-v2` | untouched (local `25f3d57`, origin `51af5b3`), 0 merges |
| Diff vs start | 60 files changed, +4820 / −618 |

Commits:

1. `0ad6b36` feat(rbac): add division access control
2. `e5f3dac` test(rbac): cover cross-division authorization
3. `cbc4a0d` fix(db): correct users table reference in migration 017, add division seed
4. `b5830c8` feat(web): redesign application using Lumina reference
5. `9116bb5` test(web): verify division-aware navigation and views

---

## 2. What the codebase looked like first

`division` already existed as a **data attribute** — migrations 013 and 015 put a
`division VARCHAR(32) DEFAULT 'recycling'` column on `inventory_transactions`,
`containers` and `materials`, and services filtered on it.

It was **not an authorization boundary**. `materials.service.ts` said so out loud:

> *"There is no separate division-level permission in this app; division is a
> data attribute, not an authorization boundary."*

Any authenticated user could pass `?division=healthcare`, or a known UUID, and
read the other business unit's data. That gap is what this work closes.

### Naming decision

The canonical API key is **`greenwave`**; the pre-existing business-data columns
store **`recycling`**. Those rows are **not rewritten** — renaming live data was
out of scope and unnecessary. The boundary translates instead
(`src/divisions/divisions.constants.ts`): input is normalised to the canonical
key, reads match every storage synonym (`greenwave` → `IN ('recycling','greenwave')`),
and new rows persist `recycling` so they stay byte-compatible with the column
DEFAULT. `recycling` remains an accepted input alias everywhere.

---

## 3. Authorization model

```
USER
  └─ ROLE                  (existing: admin / manager / staff / driver)
  └─ DIVISION ACCESS       (NEW: user_divisions, explicit grant rows)
  └─ WAREHOUSE ACCESS      (existing: user_warehouses)
  └─ RESOURCE AUTHORIZATION (role + division + warehouse, per endpoint)
```

Modelled 1:1 on the existing warehouse isolation, not as a parallel system:

- `user_divisions` — one row per (user, division). **Absence of a row is absence
  of access.** No role-derived fallback, no implicit default.
- `DivisionsService` mirrors `WarehousesService`: `assertDivisionAccess`,
  `assertStoredDivisionAccess`, `scopeDivisions`, `assignUserDivisions`.
- `JwtStrategy` resolves grants on **every request**, so a revocation takes
  effect on the next call rather than at token expiry (verified by test).
- Both divisions are supportable; "both" is never granted automatically.
- Assignment is `@Roles('admin')` **and** limited to divisions the acting admin
  themselves holds — a GreenWave-only admin cannot mint Healthcare access for
  anyone, including themselves.

**Fail-closed detail:** a stored row whose `division` is NULL or unrecognised
resolves to GreenWave (the column DEFAULT), never to "unscoped and readable by
everyone".

---

## 4. Files changed

### Backend

| Area | Files |
|---|---|
| Division model | `src/divisions/divisions.constants.ts`, `divisions.service.ts`, `divisions.controller.ts`, `divisions.module.ts`, `entities/user-division.entity.ts`, `dto/assign-divisions.dto.ts` |
| Auth pipeline | `auth/jwt.strategy.ts`, `auth/auth.module.ts`, `common/decorators/current-user.decorator.ts`, `app.module.ts` |
| Guards / scoping | enforced in services (query level), not a new guard — see §5 |
| Services | `materials.service.ts`, `inventory.service.ts`, `customers.service.ts`, `invoices.service.ts`, `users.service.ts` |
| Controllers | `materials`, `inventory`, `customers`, `invoices`, `users`, `divisions` |
| Entities | `customer.entity.ts`, `invoice.entity.ts` (+`division` column) |
| DTOs | create-material, create-container, create-inventory-transaction, create-customer, create-invoice, create-user, update-user |
| Migrations | `017_division_access_control.sql` |
| Seeds | `004_dev_division_fixtures.sql` (local dev only) |
| Tests | `division-isolation.e2e-spec.ts`, `divisions.service.spec.ts`, `divisions.constants.spec.ts`, `tests/security/division-authorization-matrix.test.ts`, `test/fixtures/divisions-test.helper.ts`, + 8 existing specs updated |

### Frontend (canonical root app — `index.html` + `assets/*`)

| Area | Change |
|---|---|
| Design system | `assets/app.css` rebuilt on Lumina: Inter, 8px scale, 24px gutters, 40px margins, 260px sidebar, radii 8/16/24, ambient shadows, tonal layering instead of borders |
| Primitives | sidebar, top bar, page header, card, stat card, table, filter bar, search field, button variants, modal, badge/chip, division chip, empty state, toast, form section |
| Division identity | three registers via `data-entity`: soft indigo (CloudCore/admin), GreenWave green, Healthcare clinical blue — only accent tokens differ |
| Navigation | division-gated; a Healthcare-only user never sees GreenWave-specific nav, and vice versa |
| Division selector | switcher only when >1 division; a static business-unit statement when exactly 1; explicit empty state when 0 |
| Staff Management | **Division Access** column (separate from Warehouse Access) + DIVISION ACCESS section in create/edit forms |
| Dashboard | real data, division + facility context pill, no fake numbers |
| Inventory / Materials / Customers / Invoices | division-scoped; create payloads state their division |
| Settings | read-only "Your access" card (role / division access / warehouse access), now reachable by every role; company form stays admin-only |
| Mobile | off-canvas drawer, bottom tab bar, `.table.stack-mobile` card layout with per-cell labels, 40–48px touch targets |
| Cache | `sw.js` bumped to `greenwave-v18`, assets to `?v=20260901_lumina` |

---

## 5. Backend enforcement

Enforced at the **service / query** layer, so it applies to list, read-by-id and
write alike, and cannot be bypassed by changing a query param, path, body or ID.

| Resource | List | By ID | Create | Update | Delete |
|---|---|---|---|---|---|
| Materials / products | scoped | 403 | 403 | 403 (both sides) | 403 |
| Inventory balances | scoped | — | — | — | — |
| Inventory transactions | scoped | 403 | 403 | — | — |
| Containers | scoped | 403 | 403 | — | — |
| Customers | scoped | 403 | 403 | 403 (both sides) | — |
| Invoices | scoped | 403 | 403 | 403 (both sides) | — |
| Dashboard | derived from the above | | | | |
| Staff division assignment | admin-only + limited to admin's own divisions | | | | |

Notes:

- **Warehouse 403 fires before division scoping**, so an unauthorized facility
  still returns 403 rather than being masked by an empty division scope.
- **Relationship leak closed:** an invoice cannot reference a customer in
  another division, on create or on update.
- **Unknown division → 400**, never a silent fallback.
- Users with **no** division get `[]` from every list and 403 from every ID.

---

## 6. Security verification

Ten required cases, all covered by automated tests **and** re-verified against a
live local API with real seeded data:

| # | Case | Result |
|---|---|---|
| 1 | GreenWave user → GreenWave resource | **allowed (200)** |
| 2 | GreenWave user → Healthcare resource | **denied (403)** |
| 3 | Healthcare user → Healthcare resource | **allowed (200)** |
| 4 | Healthcare user → GreenWave resource | **denied (403)** |
| 5 | GreenWave user, direct Healthcare UUID | **denied (403)** — material, transaction, customer, invoice, container |
| 6 | Healthcare user, direct GreenWave UUID | **denied (403)** — same set |
| 7 | Unauthorized staff modifies division assignment | **denied (403)** — self-grant, other-user, PATCH route, and GreenWave-only admin escalation |
| 8 | Admin assigns a division they hold | **allowed (200)**; revoke to `[]` allowed |
| 9 | Newly created staff | **no division access**; sees `[]` everywhere, 403 on every ID |
| 10 | Warehouse + division combinations | **isolated** — Calgary GW staff see 1 of 6 cells; all-warehouse GW admin sees 3 of 6 |

Also covered: `?division=` tampering (403), invented divisions (400), legacy
`recycling` alias handling, and a revoked division taking effect on the **next
request** with the same token.

**Frontend:** navigation isolation is tested separately, including a network
assertion that the no-division empty state issues **zero** division-scoped
requests — hiding menus while loading the data behind them would defeat the point.

---

## 7. Invoice numbering — no regression

`88cb121` is preserved exactly:

- `016_invoice_number_sequence.sql` — **0 lines changed**
- `allocateInvoiceNumber` / `peekNextInvoiceNumber` — **allocation path unchanged**
- SQLite production guard (`assertLegacyCounterAllowed`) intact and still tested

Verified live against the local dev database:

```
greenwave  -> 10261
healthcare -> 10262     single global series, +1 each
greenwave  -> 10263     no per-division counter

cross-division create -> 403
next-number before=10264  after=10264   (rejected before allocation; no number burned)

99 invoices >= 10000, 99 distinct numbers   (no reuse)
```

Division is scoping metadata only; it has no bearing on numbering. Production
invoices **1115, 1116, 1125, 1126** were not touched — no production database
connection was made at any point.

---

## 8. Test results

| Suite | Baseline (88cb121) | Now |
|---|---|---|
| Jest (`npm test`) | 28 suites / 168 tests | **30 suites / 207 tests** |
| node unit | 28 | **28** |
| node security | 19 | **41** |
| node acceptance | 34 | **34** |
| API e2e | 5 suites / 53 (8 failing) | **7 suites / 129 (0 failing)** |
| Legacy e2e | 101 | **114 (109 passed, 5 pre-existing skips)** |
| Web e2e | 29 | **29** |
| Lint | clean | **clean** |
| Build | clean | **clean** |

Coverage increased in every category; nothing was weakened or removed.

### Pre-existing failure found and fixed

`payment-rbac.e2e-spec.ts` had **8 tests already failing at `88cb121`** — verified
by running that spec in a clean worktree at that commit. The non-PostgreSQL
invoice-numbering fallback reads `invoice_number_counter`, which no entity maps
to, so `synchronize: true` never created it and every invoice create returned
500. The suite now creates the table the same way
`invoice-numbering.integration.spec.ts` does. All 8 now pass.

### API contract change

An account holding **both** divisions must now state the division when creating
an invoice or customer, rather than having one guessed. That is the direct
consequence of "do not silently default a user to Recycling". Four call sites
were updated to say which division they mean; three were tests, one was the
React app's invoice form.

---

## 9. Local dev environment

Local only — Docker containers on `localhost`, `NODE_ENV=development`:

- Postgres `localhost:5432/greenwave_dev` — migrations 001–017 applied, seeds 001–004
- API `127.0.0.1:4000`
- Root frontend `127.0.0.1:8080`
- React app `127.0.0.1:5173`

Seed 004 provides all six warehouse × division cells and one account per access
shape (`gw.only@`, `hc.only@`, `both.admin@`, `unassigned@` — all
`DevPassword123!`).

---

## 10. Visual QA

Reviewed at 1600×1000 (desktop), 834×1112 (tablet) and 390×844 (mobile), for
four access shapes, with **no page or console errors**:

Dashboard · Inventory · Materials · Customers · Invoices · Staff Management ·
Time Clock · Photos · Operational History · Settings · Staff Chat · staff edit
modal · Healthcare division · GreenWave-only · Healthcare-only · no-division state

Checked: alignment, spacing, typography, responsive behaviour, empty states,
loading states, modals, filters, tables, navigation, buttons, forms, badges, icons.

Fixed during QA:

- Three sub-4.5:1 colour pairs found by the axe audit (`--muted` on `--panel-3`
  and `--ground`; `--faint` as body text) — palette retuned.
- Nav section labels dimmed `--rail-ink` to 70%, dropping to 4.05–4.40:1 —
  opacity removed, now 6.9–7.6:1 on all three rail themes.
- Date / reference columns wrapped mid-token — now `nowrap` with table scroll.
- Three CSS variables (`--mono`, `--sec`, `--line-focus`) that the previous
  stylesheet referenced but never declared, so those invoice-document rules
  rendered with no value at all.

### Known remaining differences

1. **Sidebar brand** uses the real GreenWave logo; the reference mock uses a
   placeholder "GR" tile. Intentional — the reference says not to copy its
   branding.
2. **Icons** remain the app's existing SVG sprite rather than Material Symbols.
   Consistent throughout, and avoids a new font dependency for the PWA.
3. **Staff table at 1600px** puts Last Login and Actions behind a horizontal
   scroll (9 columns). Below 768px it becomes a card list. A column-visibility
   control would be the fix if the full set must be visible at once.
4. **Invoice document view** keeps its own print-exact stylesheet, deliberately
   not restyled — it must keep matching the physical invoice.
5. **Empty sidebar** on the no-division state is stark but honest; a support
   contact line could be added if wanted.

---

## 11. Production status

```
PRODUCTION: NOT DEPLOYED
PRODUCTION: NOT MODIFIED
```

- No deployment to VM101 / .11, .12, .21, .31
- No production database read, write, delete, or schema migration
- No production invoices or invoice numbers altered
- No VM reboot, no rack restart
- No production credentials used; nothing sourced from shell history
- Nothing pushed to `origin`; `greenwave-v2` untouched and unmerged
- Migration 017 applied to the **local dev** database only

Awaiting explicit approval before the production rollout phase.
