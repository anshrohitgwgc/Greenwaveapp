-- ==============================================================================
-- GreenWave - Migration 022: Employee Management, Attendance Tracking,
-- Leave Balances & Approval Workflow.
--
-- Forward-only. Nothing is dropped.
--
-- RBAC:
--   - Employee (staff/driver): view own profile, record own attendance/clock,
--     view own leave balances, submit leave requests.
--   - Manager: view team profiles, view team attendance, approve/reject team leave.
--   - Admin / HR: full access to all employees, attendance, leave policies, audit.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. employees
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(32) NOT NULL UNIQUE,
    user_id INTEGER UNIQUE REFERENCES "user"(id) ON DELETE SET NULL,
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(32),
    department VARCHAR(64) NOT NULL,
    position VARCHAR(64) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'PROBATION', 'SUSPENDED', 'TERMINATED', 'ON_LEAVE')),
    employment_type VARCHAR(24) NOT NULL DEFAULT 'FULL_TIME'
        CHECK (employment_type IN ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'SEASONAL')),
    manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    metadata JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employees_user ON employees (user_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees (department);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees (manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_warehouse ON employees (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees (status);

-- ------------------------------------------------------------------------------
-- 2. attendance_records
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    clock_in TIMESTAMP WITH TIME ZONE,
    clock_out TIMESTAMP WITH TIME ZONE,
    total_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
    overtime_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'PRESENT'
        CHECK (status IN ('PRESENT', 'ABSENT', 'LATE', 'REMOTE', 'HALF_DAY', 'ON_LEAVE')),
    notes TEXT,
    source VARCHAR(24) NOT NULL DEFAULT 'MANUAL'
        CHECK (source IN ('MANUAL', 'TIMESHEET', 'KIOSK', 'SYSTEM')),
    timesheet_id UUID REFERENCES timesheets(id) ON DELETE SET NULL,
    verified_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_attendance_employee_date UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance_records (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records (date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records (status);

-- ------------------------------------------------------------------------------
-- 3. leave_balances
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    year SMALLINT NOT NULL,
    leave_type VARCHAR(24) NOT NULL
        CHECK (leave_type IN ('VACATION', 'SICK', 'PERSONAL', 'OTHER')),
    entitlement_days NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (entitlement_days >= 0),
    used_days NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
    pending_days NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (pending_days >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_leave_balances_emp_year_type UNIQUE (employee_id, year, leave_type)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances (employee_id, year);

-- ------------------------------------------------------------------------------
-- 4. leave_requests
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type VARCHAR(24) NOT NULL
        CHECK (leave_type IN ('VACATION', 'SICK', 'PERSONAL', 'OTHER')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_count NUMERIC(5,2) NOT NULL CHECK (days_count > 0),
    reason TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests (status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests (start_date, end_date);

-- ------------------------------------------------------------------------------
-- 5. Permissions
-- ------------------------------------------------------------------------------
INSERT INTO permissions (key, description) VALUES
    ('employees:read', 'View employee profiles and directory'),
    ('employees:manage', 'Create, update, and manage employee records'),
    ('attendance:read', 'View attendance records'),
    ('attendance:write', 'Record and edit attendance records'),
    ('attendance:manage', 'Manage and verify attendance records for team/all'),
    ('leave:read', 'View leave balances and requests'),
    ('leave:request', 'Submit and cancel own leave requests'),
    ('leave:manage', 'Approve, reject, and adjust leave requests')
ON CONFLICT (key) DO NOTHING;

-- Grant permissions to Admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.key IN (
    'employees:read', 'employees:manage',
    'attendance:read', 'attendance:write', 'attendance:manage',
    'leave:read', 'leave:request', 'leave:manage'
  )
ON CONFLICT DO NOTHING;

-- Grant permissions to Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager'
  AND p.key IN (
    'employees:read',
    'attendance:read', 'attendance:write', 'attendance:manage',
    'leave:read', 'leave:request', 'leave:manage'
  )
ON CONFLICT DO NOTHING;

-- Grant permissions to Staff & Driver
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('staff', 'driver')
  AND p.key IN (
    'employees:read',
    'attendance:read', 'attendance:write',
    'leave:read', 'leave:request'
  )
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------
-- 6. Backfill existing users into employees table
-- ------------------------------------------------------------------------------
INSERT INTO employees (id, employee_id, user_id, first_name, last_name, email, phone, department, position, start_date, status, employment_type, is_active)
SELECT
    gen_random_uuid(),
    'EMP-' || LPAD(u.id::text, 4, '0'),
    u.id,
    -- The users table column is "fullName" (migration 001); an earlier
    -- revision of this backfill referenced a non-existent u.name, which
    -- aborted the whole migration with 'column u.name does not exist' and
    -- took migrations 019-022 down with it.
    COALESCE(NULLIF(SPLIT_PART(u."fullName", ' ', 1), ''), 'Staff'),
    COALESCE(NULLIF(SUBSTRING(u."fullName" FROM POSITION(' ' IN u."fullName") + 1), ''), 'Member'),
    u.email,
    NULL,
    CASE u.role
        WHEN 'admin' THEN 'Administration'
        WHEN 'manager' THEN 'Operations'
        WHEN 'driver' THEN 'Logistics'
        ELSE 'Recycling'
    END,
    CASE u.role
        WHEN 'admin' THEN 'System Administrator'
        WHEN 'manager' THEN 'Operations Manager'
        WHEN 'driver' THEN 'Logistics Driver'
        ELSE 'Operations Specialist'
    END,
    CURRENT_DATE,
    'ACTIVE',
    'FULL_TIME',
    u.status = 'active'
FROM "user" u
WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id)
ON CONFLICT DO NOTHING;

-- Seed default leave balances for current year
INSERT INTO leave_balances (employee_id, year, leave_type, entitlement_days, used_days, pending_days)
SELECT
    e.id,
    EXTRACT(YEAR FROM CURRENT_DATE)::smallint,
    t.leave_type,
    t.days,
    0,
    0
FROM employees e
CROSS JOIN (
    VALUES
        ('VACATION'::varchar, 15.0),
        ('SICK'::varchar, 10.0),
        ('PERSONAL'::varchar, 5.0),
        ('OTHER'::varchar, 0.0)
) AS t(leave_type, days)
ON CONFLICT DO NOTHING;

COMMIT;
