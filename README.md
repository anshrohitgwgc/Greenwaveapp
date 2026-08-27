# Greenwave Ops

An invoice maker and stock ledger for Greenwave Recycling and Greenwave
Healthcare. It starts **completely empty** — no demo customers, no demo
materials, no demo invoices.

## Run it

Double-click `index.html`. That's the whole install — no Node, no server, no
account. It works offline.

Chrome, Edge, Firefox and Safari are all fine.

## What's in it

**Invoices** *(Recycling only — Healthcare doesn't raise these)*

- Build an invoice line by line: service date, product, unit, description,
  quantity, rate. The amount and the totals compute as you type.
- **Rebate lines.** Tick *Rebate* on a line when you're paying the customer for
  their material instead of charging them — it subtracts. One document covers
  money going both directions, so you don't need a separate payable.
- **Tax follows the warehouse it ships from.** GST 5% out of BC or Alberta,
  HST 13% out of Ontario. Change *Ships from* and the total changes.
- Terms drive the due date. Net 15 on 27 Aug gives 11 Sep.
- **Print / PDF** prints just the invoice — no sidebar, no form controls, no
  buttons. Use your browser's "Save as PDF" to get a file.
- Numbering continues from your last one: the next invoice is **1115**.

**Inventory**

- On hand per warehouse, derived from tickets. Never typed in directly.
- Products with sizes (XL / L / M / S) break out into columns with totals on
  both axes, the way your spreadsheet does.
- The footer total is summed from the rows in front of you, not stored.

**Weigh-in / Receive**

- Weighed materials: enter gross and tare, net computes. A tare above gross is
  refused rather than posting a negative load.
- Counted products: enter a quantity, or one per size.
- In or Out. Posting updates inventory immediately.

**Setup** — customers, materials/products, warehouses, and your company
details as they appear on the invoice.

## What's already filled in

Only things you've actually told me:

- Your legal identity from invoice 1114 — name, address, BN, GST/HST number,
  email, phone. Editable in Settings.
- Three warehouses: Maple Ridge BC, Calgary AB, Ontario. **The Ontario one has
  no address yet** — it needs a city.
- The next invoice number, 1115.

Everything else is empty and waiting for you.

## Where your data lives — read this

**In this browser, on this computer. Nowhere else.**

That means it's private and works offline, but also:

- Clearing site data erases it.
- It doesn't follow you to another computer or phone.
- Nobody else on your team can see it.

**Use Settings → Export backup regularly.** It downloads a `.json` file you can
re-import here or on another machine. Do that before you rely on this for
anything that matters.

This is the right trade for getting something usable today. Moving it onto your
own servers — Postgres on 192.168.1.22, the API nodes, proper logins — is the
next step, and `greenwave-ops-brief.md` is the plan for it.

## Two things deliberately not done

**BC PST isn't applied.** Only GST and HST are. Whether PST applies to
recyclable material sold for reprocessing is a question for your accountant,
and this app would rather ask than quietly guess and leave you under-collected.

**Nothing is locked after saving.** A real system makes a posted invoice
immutable and handles corrections with a credit note. This one lets you edit a
saved invoice, because with no server there's no audit trail to protect. Worth
knowing if two people ever work from the same backup.

## Not built yet

Dispatch and routing, the driver app, certificates of recycling and
destruction, ESG reporting, the double-entry ledger, EDI. They depend on this
data existing first — which is why this module came first.

## Files

```
index.html          the app shell and all views
assets/app.css      styling, including the print layout
assets/app.js       all logic — invoices, tickets, inventory
assets/store.js     localStorage persistence and the empty starting state
```

Plain HTML, CSS and JavaScript. No build step, no dependencies. Open it in
Claude Code and extend it directly.
