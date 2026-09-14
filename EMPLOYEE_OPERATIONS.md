# GreenWave Recycling Inc. — Employee Operations & Workforce Platform

## 1. Executive Summary

The Employee Operations module manages GreenWave's workforce across multiple processing warehouses and mobile recycling collection teams. It encompasses:
1. **Workforce Directory & Profile Management:** Centralized employee records linked to authentication user accounts.
2. **Attendance Tracking:** Daily work logs, clock-in/out timestamps, break durations, and overtime tracking.
3. **Leave Management Engine:** Annual entitlement balances, automated day calculations, and approval workflows.
4. **Hierarchical Approval & Scoping:** Multi-level manager authorization scoped by division and reporting hierarchy.

```
+---------------------------------------------------------------------------------------------------+
|                                 EMPLOYEE OPERATIONS ARCHITECTURE                                  |
+---------------------------------------------------------------------------------------------------+
  [ Employee (Staff/Driver) ]
      |
      | 1. Submits leave request via POST /api/employees/me/leave-requests
      v
  [ EmployeesService.submitLeaveRequest() ]
      |
      | 2. Validates business dates (daysBetween)
      | 3. Checks available balance (allocated - used - pending)
      | 4. Reserves pending days on leave_balances
      | 5. Creates leave_requests (status = SUBMITTED)
      v
  [ Manager or Admin ]
      |
      | 6. Reviews pending requests: GET /api/employees/leave-requests?status=SUBMITTED
      | 7. Scoped to direct reports & authorized warehouse divisions
      | 8. Approves: POST /api/employees/leave-requests/:id/review { status: 'APPROVED' }
      v
  [ Leave Approval Engine ]
      |
      | 9. Updates leave_requests status to APPROVED
      | 10. Transfers pending days -> used days on leave_balances
      | 11. Generates ON_LEAVE records on attendance_records for the entire date range
      | 12. Records immutable audit log
      v
  [ PostgreSQL Production DB ]
```

---

## 2. Workforce Profiles & Data Models

Workforce data is modeled in migration `022_employee_operations.sql` and enforced by strict database constraints.

### 2.1 Entity Schema: `employees`
| Field | Type | Description |
|---|---|---|
| `id` | `UUID PK` | Unique employee identifier |
| `user_id` | `INT UNIQUE` | Foreign key to `users.id` (1-to-1 link for authenticated staff) |
| `employee_number` | `VARCHAR(20) UNIQUE` | Formal company badge number (e.g. `EMP-2026-0012`) |
| `first_name` | `VARCHAR(60)` | Given name |
| `last_name` | `VARCHAR(60)` | Family name |
| `email` | `VARCHAR(120) UNIQUE` | Official work email |
| `phone` | `VARCHAR(30)` | Contact phone number |
| `department` | `VARCHAR(60)` | Operations, Warehouse, Logistics, Maintenance, Finance |
| `position` | `VARCHAR(80)` | Job title (e.g. Lead Sorter, Heavy Equipment Operator, Driver) |
| `hire_date` | `DATE` | Start date with GreenWave |
| `status` | `VARCHAR(20)` | `ACTIVE`, `ON_LEAVE`, `TERMINATED` |
| `manager_id` | `UUID FK` | Reference to employee's direct reporting supervisor |
| `warehouse_id` | `INT FK` | Primary warehouse location assignment |

---

## 3. Attendance Tracking System

The attendance engine tracks daily presence, punctuality, and work hours across facility staff and collection drivers.

### 3.1 Entity Schema: `attendance_records`
| Field | Type | Description |
|---|---|---|
| `id` | `UUID PK` | Attendance record identifier |
| `employee_id` | `UUID FK` | Associated employee |
| `date` | `DATE` | Business date (`YYYY-MM-DD`) |
| `check_in` | `TIMESTAMPTZ` | Clock-in time |
| `check_out` | `TIMESTAMPTZ` | Clock-out time |
| `break_minutes` | `INT` | Total lunch and rest break time (default: 30) |
| `total_hours` | `NUMERIC(5,2)` | Computed net billable work hours |
| `overtime_hours` | `NUMERIC(5,2)` | Hours exceeding daily threshold (> 8 hours) |
| `status` | `VARCHAR(20)` | `PRESENT`, `ABSENT`, `LATE`, `HALF_DAY`, `ON_LEAVE`, `HOLIDAY` |
| `notes` | `TEXT` | Supervisor notes, reason for absence/late arrival |
| `source` | `VARCHAR(20)` | `MANUAL`, `TIMESHEET`, `KIOSK`, `SYSTEM` |

### 3.2 Automated Leave Calendar Integration
When an employee's leave request is approved, the system automatically inserts or updates `attendance_records` for every calendar day in the leave interval, marking `status = 'ON_LEAVE'` and `notes = 'Approved leave (VACATION)'`. This prevents erroneous "No Show / Absent" flags on warehouse dispatch rosters.

---

## 4. Leave Balances & Entitlement Tracking

GreenWave provides multiple categories of employee leave:
- **`VACATION`:** Accrued annual paid vacation days.
- **`SICK`:** Paid personal and medical illness leave.
- **`PERSONAL`:** Personal or family responsibility days.
- **`BEREAVEMENT`:** Compassionate leave for family loss.
- **`UNPAID`:** Approved unpaid leaves of absence.

### 4.1 Balance Lifecycle (`leave_balances`)
For each employee, calendar year, and leave type, the database tracks:
- `allocated_days`: Total statutory or contractual days granted for the calendar year.
- `used_days`: Days consumed by completed, approved leave.
- `pending_days`: Days currently requested and awaiting manager approval.
- `remaining_days`: Computed dynamically as $\text{allocated} - (\text{used} + \text{pending})$.

---

## 5. Leave Request & Multi-Level Approval Workflow

### 5.1 Submission (`POST /api/employees/me/leave-requests`)
1. An employee selects leave type, start date, end date, and reason.
2. The system verifies:
   - `startDate <= endDate`
   - `startDate >= today` (or within allowed retrospective limit for emergency sick days).
   - The requested `daysCount` does not exceed available balance:
     $$\text{daysCount} \le \text{allocatedDays} - (\text{usedDays} + \text{pendingDays})$$
3. A row is inserted in `leave_requests` with status `SUBMITTED`, and `pendingDays` is incremented.

### 5.2 Review & Authorization (`POST /api/employees/leave-requests/:id/review`)
1. Only authorized managers or admins can review requests:
   - **Admin:** Can approve or reject any company request.
   - **Manager:** Can only approve requests for their direct reports (`manager_id = actor.employee_id`) or employees assigned to warehouses they supervise.
2. Actions:
   - **`APPROVED`:**
     - Request status transitions to `APPROVED`.
     - `leave_balances.pendingDays` is decremented by `daysCount`.
     - `leave_balances.usedDays` is incremented by `daysCount`.
     - Attendance calendar days are automatically populated with `ON_LEAVE`.
   - **`REJECTED`:**
     - Request status transitions to `REJECTED`.
     - Review comments are saved.
     - `leave_balances.pendingDays` is decremented, restoring the available balance.

---

## 6. Role-Based Access Control (RBAC) Matrix

| Platform Action | Admin | Manager | Staff / Driver |
|---|:---:|:---:|:---:|
| View All Employees Directory | **Yes** | Scoped (Team/Warehouse) | No (Self Only) |
| Create / Edit Employee Profile | **Yes** | No | No |
| View Company-Wide Attendance | **Yes** | Scoped (Team/Warehouse) | No (Self Only) |
| Record / Adjust Attendance Logs | **Yes** | Scoped (Team/Warehouse) | Clock-in/out Only |
| View Leave Balances | **Yes** (All) | Scoped (Team/Warehouse) | Own Balances Only |
| Override Leave Allocations | **Yes** | No | No |
| Submit Leave Request | **Yes** | Yes (Own) | Yes (Own) |
| Approve / Reject Leave Requests | **Yes** (All) | Scoped (Direct Reports) | No |

---

## 7. Frontend User Interface Views

Three dedicated user interface views are available in the GreenWave web application:

1. **Workforce Directory (`#v-employees`):**
   - Roster grid with badges for department, status, warehouse assignment, and manager.
   - Quick search and filtering by department or employment status.
   - "New Employee" modal for administrators.
2. **Attendance Calendar & Log (`#v-attendance`):**
   - KPI metrics: Total Active Employees, Present Today, On Leave, Late Arrivals.
   - Filter by date range and warehouse.
   - Status indicators (`PRESENT` in green, `ON_LEAVE` in blue, `LATE` in amber).
3. **Leave Requests & Approvals (`#v-leaverequests`):**
   - Employee self-service card showing real-time balance breakdown (Vacation, Sick, Personal).
   - "Request Time Off" submission dialog.
   - Manager approval queue with single-click "Approve" and "Reject" buttons.
