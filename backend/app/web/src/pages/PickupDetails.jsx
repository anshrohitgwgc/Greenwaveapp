import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getPickupById } from "../api/client";
import { clearAuth, getToken, getUser } from "../auth/authStorage";

export default function PickupDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = getUser() || { fullName: "User", role: "staff" };

  const [pickup, setPickup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPickup = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const token = getToken();
      if (!token) {
        navigate("/login", { replace: true });
        return;
      }
      const data = await getPickupById(id, token);
      setPickup(data);
    } catch (err) {
      setError(err.message || "Failed to load pickup details.");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    loadPickup();
  }, [loadPickup]);

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
            <Link to="/pickups" className="btn btn-outline btn-sm">
              Pickups
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
        <div className="content-container detail-container">
          {/* Breadcrumbs & Header */}
          <div className="page-header">
            <div>
              <div className="breadcrumbs">
                <Link to="/dashboard" className="breadcrumb-link">Dashboard</Link>
                <span className="breadcrumb-separator">/</span>
                <Link to="/pickups" className="breadcrumb-link">Pickups</Link>
                <span className="breadcrumb-separator">/</span>
                <span className="breadcrumb-current">Pickup #{id}</span>
              </div>
              <div className="detail-title-group">
                <h1 className="page-title">Pickup #{id}</h1>
                {pickup && (
                  <span className={getStatusBadgeClass(pickup.status)}>
                    {pickup.status || "pending"}
                  </span>
                )}
              </div>
            </div>
            <div>
              <Link to="/pickups" className="btn btn-outline">
                &larr; Back to Pickups List
              </Link>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="card state-card">
              <div className="spinner"></div>
              <p className="state-text">Loading pickup details...</p>
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <div className="card state-card">
              <div className="state-icon error-icon">⚠️</div>
              <h2 className="state-title">Pickup Not Found</h2>
              <p className="state-text">{error}</p>
              <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
                <button onClick={loadPickup} className="btn btn-primary">
                  Retry
                </button>
                <Link to="/pickups" className="btn btn-outline">
                  Return to Pickups
                </Link>
              </div>
            </div>
          )}

          {/* Pickup Content Grid */}
          {!loading && !error && pickup && (
            <div className="detail-grid">
              {/* Customer & Location Card */}
              <div className="card detail-card">
                <h2 className="detail-card-title">Customer &amp; Location</h2>
                <div className="detail-row">
                  <span className="detail-label">Customer Name</span>
                  <span className="detail-value font-semibold">{pickup.customerName || "—"}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Pickup Address</span>
                  <span className="detail-value">{pickup.address || "—"}</span>
                </div>
              </div>

              {/* Material & Weight Specifications Card */}
              <div className="card detail-card">
                <h2 className="detail-card-title">Material Specifications</h2>
                <div className="detail-row">
                  <span className="detail-label">Material Type</span>
                  <span className="detail-value">
                    <span className="material-tag">{pickup.materialType || "—"}</span>
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Estimated Weight</span>
                  <span className="detail-value">
                    {pickup.estimatedWeight != null ? `${pickup.estimatedWeight} kg` : "Not specified"}
                  </span>
                </div>
                {pickup.actualWeight != null && (
                  <div className="detail-row">
                    <span className="detail-label">Actual Weight</span>
                    <span className="detail-value text-primary font-semibold">
                      {pickup.actualWeight} kg
                    </span>
                  </div>
                )}
                {pickup.assignedDriverId != null && (
                  <div className="detail-row">
                    <span className="detail-label">Assigned Driver ID</span>
                    <span className="detail-value font-semibold">
                      Driver #{pickup.assignedDriverId}
                    </span>
                  </div>
                )}
              </div>

              {/* Notes Card (if present) */}
              {pickup.notes && (
                <div className="card detail-card grid-full">
                  <h2 className="detail-card-title">Pickup Notes</h2>
                  <p className="detail-notes-text">{pickup.notes}</p>
                </div>
              )}

              {/* Timeline & Status Card */}
              <div className="card detail-card grid-full">
                <h2 className="detail-card-title">Timeline &amp; Audit</h2>
                <div className="profile-grid">
                  <div className="profile-field">
                    <span className="field-label">Created At</span>
                    <span className="field-value text-sm">
                      {pickup.createdAt ? new Date(pickup.createdAt).toLocaleString() : "—"}
                    </span>
                  </div>
                  <div className="profile-field">
                    <span className="field-label">Current Status</span>
                    <span className="field-value">
                      <span className={getStatusBadgeClass(pickup.status)}>
                        {pickup.status || "pending"}
                      </span>
                    </span>
                  </div>
                  {pickup.completedAt && (
                    <div className="profile-field">
                      <span className="field-label">Completed At</span>
                      <span className="field-value text-sm">
                        {new Date(pickup.completedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
