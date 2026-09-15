# GreenWave Operations Platform — Invoice UI & Print Reference Implementation

## 1. Visual & Structural Reproduction of `Greenwave Ops.pdf`

The GreenWave invoice generator and print layout are modeled directly on the 3-page reference document supplied in `Greenwave Ops.pdf`. The implementation avoids generic SaaS templates and preserves the exact document structure, free-text inputs, bordered blocks, rebate accounting, and Canadian tax formatting.

---

## 2. 3-Page Document Layout Structure

```
┌────────────────────────────────────────────────────────┐
│                        PAGE 1                          │
│  [ INVOICE ]                                           │
│  ┌───────────────────────────────────┐  [ LEAF LOGO ]  │
│  │ Greenwave Recycling Inc.          │                 │
│  │ BN: 751161951BC0001               │                 │
│  │ GST/HST Reg: 751161951RT0001      │                 │
│  │ 23394 Fisherman Rd, Maple Ridge   │                 │
│  │ sales@greenwaverecycling.ca       │                 │
│  │ 6724720423                        │                 │
│  └───────────────────────────────────┘                 │
│  ┌────────────────────────┐  ┌──────────────────────┐  │
│  │ BILL TO                │  │ SHIP TO              │  │
│  │ [ Free-text Address ]  │  │ [ Free-text Address ]│  │
│  └────────────────────────┘  └──────────────────────┘  │
│  - - - - - - - - - - - - - - - - - - - - - - - - - - - │
│  ┌────────────────────────┐  ┌──────────────────────┐  │
│  │ REFERENCE              │  │ PO REFERENCE         │  │
│  │ [ Free-text Ref ]      │  │ [ Free-text PO ]     │  │
│  └────────────────────────┘  └──────────────────────┘  │
│  https://gwgc.cloud                               1/3  │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│                        PAGE 2                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ FROM [ Origin facility ]                         │  │
│  └──────────────────────────────────────────────────┘  │
│  INVOICE DETAILS                                       │
│  INVOICE NO. : 1115 (Server Authoritative)             │
│  INVOICE DATE: 2026-08-28                              │
│  DUE DATE    : 2026-09-12                              │
│                                                        │
│  # 1. DESCRIPTION: sgfs                                │
│       UNIT: 10   QTY: 1   RATE: 10000.00  DISC: 1.00   │
│       AMOUNT: $9,999.00   DIRECTION: [ CHARGE ]        │
│                                                        │
│  WAYS TO PAY: sales@greenwaverecycling.ca / 6724720423 │
│  Subtotal: $9,999.00                                   │
│  https://gwgc.cloud                               2/3  │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│                        PAGE 3                          │
│  ┌───────────────────┬──────┬───────────────────────┐  │
│  │ GST @ 5%          │  5%  │ $499.95               │  │
│  └───────────────────┴──────┴───────────────────────┘  │
│  Total: $10,498.95                                     │
│                                                        │
│  https://gwgc.cloud                               3/3  │
└────────────────────────────────────────────────────────┘
```

---

## 3. Mathematical & Accounting Parity

### Line Item Calculation
$$\text{Gross} = (\text{Quantity} \times \text{Unit Price}) - \text{Discount}$$
$$\text{Line Total} = \begin{cases} +\text{Gross} & \text{if Direction is CHARGE} \\ -\text{Gross} & \text{if Direction is REBATE} \end{cases}$$

### Document Totals
$$\text{Subtotal} = \sum \text{Line Totals}$$
$$\text{Tax Total} = \text{Subtotal} \times \left(\frac{\text{Tax Rate}}{100}\right)$$
$$\text{Total} = \text{Subtotal} + \text{Tax Total}$$

### Reference Case Verification (`Greenwave Ops.pdf`)
- **Quantity**: $1$
- **Rate**: $\$10,000.00$
- **Discount**: $\$1.00$
- **Calculated Subtotal**: $\$9,999.00$
- **GST Rate**: $5\%$
- **GST Tax Amount**: $\$499.95$
- **Grand Total**: $\$10,498.95$

All values are rounded using commercial half-up currency rounding to 2 decimal places.

---

## 4. Print & PDF Styling

The `@media print` rules in `assets/app.css` ensure clean, professional output when printed or exported to PDF:
- Non-printable UI chrome (`.rail`, `.topbar`, `.tabbar`, `.noprint`, action buttons) is automatically hidden.
- Each of the 3 pages enforces `page-break-after: always; break-after: page;` to prevent awkward splits across physical pages or PDF sheets.
- High-contrast black borders and crisp typography are applied for physical paper and digital PDFs.
