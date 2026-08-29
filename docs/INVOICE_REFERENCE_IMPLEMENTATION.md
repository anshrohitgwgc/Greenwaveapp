# GreenWave Operations Platform — Authoritative Invoice Creator Implementation

This document provides the reference mapping, visual alignment, and calculation verification for the GreenWave Invoice Creator, matching the authoritative reference document: `Greenwave Ops.pdf` (3-page reference).

---

## 1. Authoritative Reference Document (`Greenwave Ops.pdf`)

The GreenWave invoice is a structured commercial document supporting both standard charges and commodity rebate/deduction lines in a single server-authoritative document.

### Visual & Section Breakdown

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ PAGE 1: INVOICE HEADER, COMPANY LETTERHEAD, LOGO, BILL TO, SHIP TO, REF       │
├──────────────────────────────────────────────────────────────────────────────┤
│ • INVOICE (Bold #0F7A4C Green Title)                                         │
│ • Company Information Box:                                                   │
│     - Greenwave Recycling Inc.                                               │
│     - BN 751161951BC0001                                                     │
│     - GST/HST Registration No. 751161951RT0001                               │
│     - 23394 Fisherman Rd,                                                    │
│     - Maple Ridge, BC V2W 1B9                                                │
│     - sales@greenwaverecycling.ca                                            │
│     - 6724720423                                                             │
│ • Logo: Official Greenwave Recycling Inc. logo (assets/logo.png)             │
│ • BILL TO (Free-text recipient billing textarea)                             │
│ • SHIP TO (Free-text recipient shipping textarea)                            │
│ • REFERENCE (Reference code input)                                           │
│ • PO REFERENCE (Customer purchase order input)                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ PAGE 2: ORIGIN, INVOICE DETAILS, LINE ITEMS, WAYS TO PAY, SUBTOTAL           │
├──────────────────────────────────────────────────────────────────────────────┤
│ • FROM (Warehouse origin, e.g. Maple Ridge, BC, Calgary, AB, Ontario)        │
│ • INVOICE DETAILS:                                                           │
│     - INVOICE NO. (Server-allocated sequence number, e.g. INV-2026-0001)     │
│     - INVOICE DATE (Date picker)                                             │
│     - DUE DATE (Date picker)                                                 │
│ • LINE ITEMS (#, DESCRIPTION, UNIT, QTY, RATE, DISCOUNT, AMOUNT, DIRECTION) │
│     - Line Amount = (Quantity * Rate) - Discount                             │
│     - DIRECTION: Pill toggle [ REBATE ] vs [ CHARGE ]                        │
│ • WAYS TO PAY (Payment instructions / electronic transfer info)              │
│ • Subtotal (Sum of all line amounts taking Direction into account)           │
├──────────────────────────────────────────────────────────────────────────────┤
│ PAGE 3: TAX & GRAND TOTAL                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ • TAX ROW: Tax Label (e.g. GST @ 5%), Tax Rate (5%), Tax Amount ($499.95)   │
│ • GRAND TOTAL ($10,498.95 in large bold typography)                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Field-by-Field Architecture Mapping

| Reference Section | Field Name | Application UI Element | Backend Entity Column | Persistence & Validation |
| :--- | :--- | :--- | :--- | :--- |
| **Header** | Company Name | `.inv-box` input | `invoices.company_info->name` | JSON string, default 'Greenwave Recycling Inc.' |
| **Header** | BN Number | `.inv-box` input | `invoices.company_info->bn` | Business Number string |
| **Header** | GST/HST Reg | `.inv-box` input | `invoices.company_info->gst` | GST/HST Registration string |
| **Header** | Address | `.inv-box` input | `invoices.company_info->line1/line2` | Physical facility address |
| **Header** | Contact | `.inv-box` input | `invoices.company_info->email/phone` | Billing contact |
| **Recipient** | BILL TO | `#edBill` textarea | `invoices.bill_to` | Free text (TEXT) |
| **Recipient** | SHIP TO | `#edShip` textarea | `invoices.ship_to` | Free text (TEXT) |
| **Reference** | REFERENCE | `#edRef` input | `invoices.notes` | Text (VARCHAR 100) |
| **Reference** | PO REFERENCE | `#edPo` input | `invoices.po_reference` | Text (VARCHAR 100) |
| **Details** | FROM | `#edFrom` input | `invoices.warehouse_id` | Origin facility association |
| **Details** | INVOICE NO. | `#edInvNoDisplay` | `invoices.invoice_number` | Server-authoritative sequence |
| **Details** | INVOICE DATE | `#edDate` input | `invoices.invoice_date` | Date (DATE) |
| **Details** | DUE DATE | `#edDueDate` input | `invoices.due_date` | Date (DATE) |
| **Line Items** | DESCRIPTION | `.ed-desc` input | `invoice_items.description` | Text |
| **Line Items** | UNIT | `.ed-unit` input | `invoice_items.unit` | Text (e.g. '10', 'kg', 'cases') |
| **Line Items** | QTY | `.ed-qty` input | `invoice_items.quantity` | Numeric (NUMERIC 12,3) |
| **Line Items** | RATE | `.ed-price` input | `invoice_items.unit_price` | Numeric (NUMERIC 12,4) |
| **Line Items** | DISCOUNT | `.ed-disc` input | `invoice_items.discount` | Numeric (NUMERIC 12,2) |
| **Line Items** | AMOUNT | `.inv-line-amount-val` | `invoice_items.line_total` | Computed: `(Qty * Rate) - Discount` |
| **Line Items** | DIRECTION | `.ed-toggle-rebate` | `invoice_items.is_rebate` | Boolean (`true` for REBATE, `false` for CHARGE) |
| **Payment** | WAYS TO PAY | `#edWaysToPay` | `invoices.payment_instructions` | Free text (TEXT) |
| **Summary** | Subtotal | `#edSubtotalVal` | `invoices.subtotal` | Numeric (NUMERIC 12,2) |
| **Summary** | Tax Label & Rate | `#edTaxLabel`, `#edTaxRate` | `invoices.tax_label`, `invoices.tax_rate` | String & Numeric percentage |
| **Summary** | Tax Amount | `#edTaxVal` | `invoices.tax_total` | Computed: `Subtotal * (TaxRate / 100)` |
| **Summary** | Total | `#edTotalVal` | `invoices.total` | Computed: `Subtotal + TaxAmount` |

---

## 3. Mathematical Formula Verification

### A. Line Item Calculation
$$\text{Gross Amount} = (\text{Quantity} \times \text{Rate}) - \text{Discount}$$
$$\text{Line Total} = \begin{cases} -\text{Gross Amount} & \text{if DIRECTION is REBATE} \\ +\text{Gross Amount} & \text{if DIRECTION is CHARGE} \end{cases}$$

### B. Subtotal, Tax, and Grand Total
$$\text{Subtotal} = \sum \text{Line Totals}$$
$$\text{Tax Amount} = \text{Subtotal} \times \left(\frac{\text{Tax Rate \%}}{100}\right)$$
$$\text{Grand Total} = \text{Subtotal} + \text{Tax Amount}$$

### C. Reference PDF Example Verification
- Line 1: Description `sgfs`, Unit `10`, Qty `1`, Rate `10000`, Discount `1.00`, Direction `CHARGE`
  - $\text{Line Amount} = (1 \times 10000) - 1.00 = \$9,999.00$
- $\text{Subtotal} = \$9,999.00$
- $\text{GST @ 5\%} = \$9,999.00 \times 0.05 = \$499.95$
- $\text{Grand Total} = \$9,999.00 + \$499.95 = \$10,498.95$

---

## 4. Print & PDF Styling Architecture

When the user triggers **Print / PDF**, `@media print` rules activate:
1. Navigation rail, top bar, buttons, and action bars are hidden (`.noprint`).
2. `.invoice-doc-container` expands to full page width.
3. `.invoice-page` applies `page-break-after: always;` / `break-after: page;` for clean, predictable 3-page pagination.
4. Input boxes and borders switch to crisp print-resolution borders.
5. Exact font typography and brand colors are preserved.
