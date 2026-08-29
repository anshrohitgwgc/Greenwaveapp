# GreenWave Operations Platform — Commercial UI/UX Design System

## 1. Design Philosophy & Brand Identity

The GreenWave Operations Platform is built as a **commercial Canadian industrial operations platform**. The interface emphasizes clarity, rapid operational data entry, high legibility under varying lighting conditions, and strong visual hierarchy.

---

## 2. Color Palette & Typography

### Color System
- **Primary Brand Green**: `#0F7A4C` (Forest green — represents recycling, active operations, and primary actions).
- **Secondary Teal/Blue**: `#2490A8` (Industrial teal — used for secondary actions, transit badges, and accents).
- **Neutral Dark / Ink**: `#0F172A` (Slate 900 — primary typography and high-contrast labels).
- **Neutral Surface / Panel**: `#FFFFFF` / `#F8FAFC` (Pure white and slate 50 background panels).
- **Subtle Borders**: `#E2E8F0` (Slate 200 — clean dividers and structured card containers).
- **Status Green (Success/Inbound)**: `#15803D` / `#DCFCE7` (Received / In stock).
- **Status Orange (Warning/Outbound)**: `#C2410C` / `#FFEDD5` (Dispatched / Shipped).
- **Status Red (Critical/Error)**: `#B91C1C` / `#FEE2E2` (Overdue / Adjustments / Errors).

### Typography Stack
- **Interface Body**: `Barlow, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Headings & Badges**: `Barlow Semi Condensed, "Barlow", sans-serif` (700 weight for crisp industrial density)
- **Numeric & Ledger Data**: `IBM Plex Mono, ui-monospace, SFMono-Regular, monospace` (Tabular figures for inventory counts, weights, currency, and timestamps)

---

## 3. Component Architecture & Ergonomics

### Warehouse Facility Selector
- **Single Warehouse Assigned**: Displays a fixed, read-only facility badge (`📍 Calgary, AB`) preventing accidental changes while giving clear context.
- **Multiple Warehouses Assigned**: Displays a clean dropdown populated strictly with authorized facilities (`Calgary, AB`, `Ontario`, `Maple Ridge, BC`).
- **Zero Warehouses Assigned**: Renders an alert chip (`⚠️ No warehouse assigned. Contact administrator.`).

### Touch Ergonomics & Warehouse Usability
- Minimum interactive touch target size: **44px × 44px** on buttons, tabs, and form controls.
- High-contrast visual focus rings for warehouse tablets and keyboard navigation.
- Dedicated bottom mobile tab bar (`#tabbar`) with quick-switch icons for warehouse staff on mobile devices.
- High-density responsive tables with horizontal scrolling containers (`.tablewrap`) on smaller viewports.

---

## 4. Multi-Domain Navigation
The application features a responsive sidebar rail navigation supporting multi-entity division switching (**Recycling** vs. **Healthcare**) and role-aware navigation scoping:
- **Operations**: Inventory Ledger, Weigh-in / Receiving, Photos, Time Clock
- **Communication**: Real-Time Global Staff Chat
- **Financials**: Invoices & Customer Accounts (Admins & Managers)
- **Administration**: Staff User Management & Facility Assignments, Append-Only Audit Trail, Settings
