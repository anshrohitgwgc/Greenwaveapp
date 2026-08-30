import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPickup } from "../api/client";
import { clearAuth, getToken, getUser } from "../auth/authStorage";

export default function CreatePickup() {
  const navigate = useNavigate();
  const user = getUser() || { fullName: "User", role: "staff" };

  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [estimatedWeight, setEstimatedWeight] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const handleLogout = () => {
    clearAuth();
    navigate("/login", { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    const trimmedCustomer = customerName.trim();
    const trimmedAddress = address.trim();
    const trimmedMaterial = materialType.trim();

    if (!trimmedCustomer) {
      setError("Please enter the customer name.");
      return;
    }
    if (!trimmedAddress) {
      setError("Please enter the pickup address.");
      return;
    }
    if (!trimmedMaterial) {
      setError("Please enter or select a material type.");
      return;
    }

    const payload = {
      customerName: trimmedCustomer,
      address: trimmedAddress,
      materialType: trimmedMaterial,
      estimatedWeight: estimatedWeight.trim() ? parseFloat(estimatedWeight.trim()) : null,
      notes: notes.trim() || null,
    };

    setLoading(true);
    try {
      const token = getToken();
      if (!token) {
        navigate("/login", { replace: true });
        return;
      }

      const created = await createPickup(payload, token);
      setSuccessMessage(`Pickup #${created.id} has been created successfully.`);

      // Navigate to the newly created pickup detail page after a short confirmation
      setTimeout(() => {
        navigate(`/pickups/${created.id}`);
      }, 750);
    } catch (err) {
      setError(err.message || "Failed to create pickup. Please try again.");
      setLoading(false);
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
        <div className="content-container form-container">
          {/* Breadcrumbs & Header */}
          <div className="page-header">
            <div>
              <div className="breadcrumbs">
                <Link to="/dashboard" className="breadcrumb-link">Dashboard</Link>
                <span className="breadcrumb-separator">/</span>
                <Link to="/pickups" className="breadcrumb-link">Pickups</Link>
                <span className="breadcrumb-separator">/</span>
                <span className="breadcrumb-current">New</span>
              </div>
              <h1 className="page-title">Schedule New Pickup</h1>
              <p className="page-subtitle">
                Enter customer information and material details to create a collection job.
              </p>
            </div>
            <div>
              <Link to="/pickups" className="btn btn-outline">
                &larr; Back to Pickups
              </Link>
            </div>
          </div>

          {/* Feedback Alerts */}
          {error && <div className="alert alert-error">{error}</div>}
          {successMessage && (
            <div className="alert alert-success">
              ✓ {successMessage} Redirecting to pickup details...
            </div>
          )}

          {/* Form Card */}
          <div className="card form-card">
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group grid-full">
                  <label htmlFor="customerName" className="form-label">
                    Customer Name <span className="required-star">*</span>
                  </label>
                  <input
                    id="customerName"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Apex Industrial Solutions"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-group grid-full">
                  <label htmlFor="address" className="form-label">
                    Pickup Address <span className="required-star">*</span>
                  </label>
                  <input
                    id="address"
                    type="text"
                    className="form-input"
                    placeholder="e.g. 742 Evergreen Terrace, Sector 4"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="materialType" className="form-label">
                    Material Type <span className="required-star">*</span>
                  </label>
                  <input
                    id="materialType"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Cardboard, Metal, Plastic, Electronics"
                    value={materialType}
                    onChange={(e) => setMaterialType(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="estimatedWeight" className="form-label">
                    Estimated Weight (kg)
                  </label>
                  <input
                    id="estimatedWeight"
                    type="number"
                    step="0.1"
                    min="0"
                    className="form-input"
                    placeholder="e.g. 45.0"
                    value={estimatedWeight}
                    onChange={(e) => setEstimatedWeight(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="form-group grid-full">
                  <label htmlFor="notes" className="form-label">
                    Pickup Notes &amp; Special Instructions
                  </label>
                  <textarea
                    id="notes"
                    className="form-textarea"
                    placeholder="Provide loading bay instructions, contact person, or gate security notes..."
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="form-actions">
                <Link to="/pickups" className="btn btn-outline" style={{ marginRight: "12px" }}>
                  Cancel
                </Link>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading ? "Creating Pickup..." : "Create Pickup Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
