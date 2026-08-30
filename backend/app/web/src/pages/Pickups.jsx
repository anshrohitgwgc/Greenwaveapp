import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getPickups } from "../api/client";
import { clearAuth, getToken, getUser } from "../auth/authStorage";

export default function Pickups() {
  const navigate = useNavigate();
  const user = getUser() || { fullName: "User", role: "staff" };
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPickups = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const token = getToken();
      if (!token) {
        navigate("/login", { replace: true });
        return;
      }
      const data = await getPickups(token);
      setPickups(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load pickups. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadPickups();
  }, [loadPickups]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login", { replace: true });
  };

  const getStatusBadgeClass = (status) => {
    switch (status?.toLowerCase()) {
      case "completed":
        return "status-badge status-completed";
      case "in_progress":
        return "status-badge status-in-progress";
      case "pending":
      default:
        return "status-badge status-pending";
    }
  };

  return (
    <div className="dashboard-layout">
      {/* Top Navbar */}
      <header className="navbar">
        <div className="navbar-container">
          <div className="navbar-brand">
            <img src="/assets/logo.png" alt="GreenWave" className="navbar-logo-img" data-testid="navbar-logo" />
            <div className="brand-text-group">
              <Link to="/dashboard" className="navbar-title-link">
                <span className="navbar-title">GreenWave</span>
              </Link>
              <span className="navbar-badge">Operations Portal</span>
            </div>
          </div>

          <div className="navbar-actions">
            <Link to="/dashboard" className="btn btn-outline btn-sm">
              Dashboard
            </Link>
            <div className="user-pill">
              <div className="user-avatar">
                {user.fullName ? user.fullName.charAt(0).toUpperCase() : "U"}
              </div>
              <div className="user-details">
                <span className="user-name">{user.fullName || "User"}</span>
                <span className="user-role-badge">{user.role || "staff"}</span>
              </div>
            </div>
            <button onClick={handleLogout} className="btn btn-outline btn-sm">
              Log Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <div className="content-container">
          {/* Header Section */}
          <div className="page-header">
            <div>
              <div className="breadcrumbs">
                <Link to="/dashboard" className="breadcrumb-link">Dashboard</Link>
                <span className="breadcrumb-separator">/</span>
                <span className="breadcrumb-current">Pickups</span>
              </div>
              <h1 className="page-title">Pickups Management</h1>
              <p className="page-subtitle">
                Inspect, schedule, and track customer material collection requests.
              </p>
            </div>
            <div className="page-actions">
              <Link to="/pickups/new" className="btn btn-primary">
                + Create Pickup
              </Link>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="card state-card">
              <div className="spinner"></div>
              <p className="state-text">Loading pickups data...</p>
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <div className="card state-card">
              <div className="state-icon error-icon">⚠️</div>
              <h2 className="state-title">Unable to Load Pickups</h2>
              <p className="state-text">{error}</p>
              <button onClick={loadPickups} className="btn btn-primary" style={{ marginTop: "16px" }}>
                Try Again
              </button>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && pickups.length === 0 && (
            <div className="card state-card">
              <div className="state-icon">📦</div>
              <h2 className="state-title">No Pickups Found</h2>
              <p className="state-text">
                There are currently no pickup requests scheduled. Create your first pickup to begin.
              </p>
              <Link to="/pickups/new" className="btn btn-primary" style={{ marginTop: "16px" }}>
                + Create First Pickup
              </Link>
            </div>
          )}

          {/* Pickups Table (Desktop/Tablet) */}
          {!loading && !error && pickups.length > 0 && (
            <>
              <div className="card table-card desktop-only">
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Pickup #</th>
                        <th>Customer</th>
                        <th>Address</th>
                        <th>Material</th>
                        <th>Est. Weight</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pickups.map((p) => (
                        <tr
                          key={p.id}
                          className="table-row-clickable"
                          onClick={() => navigate(`/pickups/${p.id}`)}
                        >
                          <td className="font-semibold text-primary">#{p.id}</td>
                          <td className="font-semibold">{p.customerName}</td>
                          <td className="text-muted" title={p.address}>
                            {p.address}
                          </td>
                          <td>
                            <span className="material-tag">{p.materialType}</span>
                          </td>
                          <td>
                            {p.estimatedWeight != null ? `${p.estimatedWeight} kg` : "—"}
                          </td>
                          <td>
                            <span className={getStatusBadgeClass(p.status)}>
                              {p.status || "pending"}
                            </span>
                          </td>
                          <td className="text-muted">
                            {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                          </td>
                          <td>
                            <Link
                              to={`/pickups/${p.id}`}
                              className="btn btn-outline btn-sm"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View Details
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Compact Card Layout (Mobile / Narrow Viewport) */}
              <div className="mobile-cards-list mobile-only">
                {pickups.map((p) => (
                  <div
                    key={p.id}
                    className="card pickup-compact-card"
                    onClick={() => navigate(`/pickups/${p.id}`)}
                  >
                    <div className="pickup-compact-header">
                      <span className="font-semibold text-primary">Pickup #{p.id}</span>
                      <span className={getStatusBadgeClass(p.status)}>
                        {p.status || "pending"}
                      </span>
                    </div>

                    <h3 className="pickup-compact-customer">{p.customerName}</h3>
                    <p className="pickup-compact-address">📍 {p.address}</p>

                    <div className="pickup-compact-details">
                      <div>
                        <span className="compact-label">Material:</span>
                        <span className="compact-value">{p.materialType}</span>
                      </div>
                      <div>
                        <span className="compact-label">Weight:</span>
                        <span className="compact-value">
                          {p.estimatedWeight != null ? `${p.estimatedWeight} kg` : "—"}
                        </span>
                      </div>
                    </div>

                    <div className="pickup-compact-footer">
                      <span className="text-muted text-sm">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                      </span>
                      <span className="text-primary font-semibold text-sm">View &rarr;</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
