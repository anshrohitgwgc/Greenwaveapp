import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clearAuth, getUser } from "../auth/authStorage";
import FacilitySelector from "../components/FacilitySelector";

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [warehouseId, setWarehouseId] = useState("");

  useEffect(() => {
    const storedUser = getUser();
    if (storedUser) {
      setUser(storedUser);
    }
  }, []);

  const handleLogout = () => {
    clearAuth();
    navigate("/login", { replace: true });
  };

  const displayName = user?.fullName || "Employee";
  const displayEmail = user?.email || "—";
  const displayRole = user?.role || "staff";

  return (
    <div className="dashboard-layout">
      {/* Top Navigation Bar */}
      <header className="navbar">
        <div className="navbar-container">
          <div className="navbar-brand">
            <img src="/assets/logo.png" alt="GreenWave" className="navbar-logo-img" data-testid="navbar-logo" />
            <div className="brand-text-group">
              <span className="navbar-title">GreenWave</span>
              <span className="navbar-badge">Operations Portal</span>
            </div>
          </div>

          <div className="navbar-actions">
            <FacilitySelector
              selectedWarehouseId={warehouseId}
              onSelectWarehouse={setWarehouseId}
            />
            <Link to="/inventory" className="btn btn-outline btn-sm">
              Inventory
            </Link>
            <Link to="/timesheets" className="btn btn-outline btn-sm">
              Time Clock
            </Link>
            <Link to="/invoices" className="btn btn-outline btn-sm">
              Invoices
            </Link>
            <Link to="/pickups" className="btn btn-outline btn-sm">
              Pickups
            </Link>
            <div className="user-pill">
              <div className="user-avatar">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="user-details">
                <span className="user-name">{displayName}</span>
                <span className="user-role-badge">{displayRole}</span>
              </div>
            </div>
            <button onClick={handleLogout} className="btn btn-outline btn-sm">
              Log Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        <div className="content-container">
          {/* Welcome Banner */}
          <div className="welcome-banner">
            <div>
              <h1 className="welcome-title">
                Welcome back, {displayName} 👋
              </h1>
              <p className="welcome-subtitle">
                GreenWave Recycling operational controls and system overview.
              </p>
            </div>
            <div className="role-indicator">
              Active Role: <span className="badge-role">{displayRole}</span>
            </div>
          </div>

          {/* User Profile Card */}
          <div className="card user-profile-card">
            <h2 className="section-title">Authenticated Profile Details</h2>
            <div className="profile-grid">
              <div className="profile-field">
                <span className="field-label">Full Name</span>
                <span className="field-value">{displayName}</span>
              </div>
              <div className="profile-field">
                <span className="field-label">Email Address</span>
                <span className="field-value">{displayEmail}</span>
              </div>
              <div className="profile-field">
                <span className="field-label">Assigned Role</span>
                <span className="field-value badge-role">{displayRole}</span>
              </div>
              <div className="profile-field">
                <span className="field-label">Session Status</span>
                <span className="field-value text-success">● Active</span>
              </div>
            </div>
          </div>

          {/* Operational Modules */}
          <h2 className="section-title" style={{ marginTop: "32px", marginBottom: "16px" }}>
            Operational Management
          </h2>
          <div className="modules-grid">
            {/* Pickups Management Card */}
            <div className="card module-card module-card-interactive" onClick={() => navigate("/pickups")}>
              <div>
                <div className="module-header">
                  <span className="module-icon">📦</span>
                  <span className="module-tag module-tag-active">Live Module</span>
                </div>
                <h3 className="module-title">Pickups Management</h3>
                <p className="module-description">
                  Schedule new pickups, inspect status lifecycle, and review customer pickup histories in real-time.
                </p>
              </div>
              <div className="module-footer">
                <Link to="/pickups" className="btn btn-primary btn-sm btn-block">
                  Open Pickups Portal &rarr;
                </Link>
              </div>
            </div>

            {/* Fleet & Dispatch Placeholder Card */}
            <div className="card module-card">
              <div>
                <div className="module-header">
                  <span className="module-icon">🚚</span>
                  <span className="module-tag">Fleet</span>
                </div>
                <h3 className="module-title">Driver &amp; Dispatch Ops</h3>
                <p className="module-description">
                  Dispatch daily routes, view fleet live locations, and verify material weight entries.
                </p>
              </div>
              <div className="module-footer">
                <span className="status-pill">Fleet Module Coming Soon</span>
              </div>
            </div>

            {/* Reports & Analytics Placeholder Card */}
            <div className="card module-card">
              <div>
                <div className="module-header">
                  <span className="module-icon">📊</span>
                  <span className="module-tag">Analytics</span>
                </div>
                <h3 className="module-title">Reports &amp; Admin</h3>
                <p className="module-description">
                  Monitor recycled material tonnage, oversee team accounts, and configure customer pricing.
                </p>
              </div>
              <div className="module-footer">
                <span className="status-pill">Analytics Module Coming Soon</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
