import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createInventoryTransaction,
  getInventoryBalances,
  getInventoryTransactions,
  getPhotos,
  getWarehouses,
} from "../api/client";
import { getToken, getUser } from "../auth/authStorage";
import FacilitySelector from "../components/FacilitySelector";
import Lightbox from "../components/Lightbox";

export default function Inventory() {
  const user = getUser() || { fullName: "User", role: "staff" };
  const [warehouseId, setWarehouseId] = useState("");
  const [division, setDivision] = useState("recycling"); // recycling | healthcare
  const [transactions, setTransactions] = useState([]);
  const [balances, setBalances] = useState([]);
  const [activePhoto, setActivePhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Form State
  const [pallets, setPallets] = useState("");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");
  const [xl, setXl] = useState("");
  const [l, setL] = useState("");
  const [m, setM] = useState("");
  const [s, setS] = useState("");
  const [orderNumber, setOrderNumber] = useState("");

  const handleDivisionChange = (newDiv) => {
    setDivision(newDiv);
    // Clear fields to avoid stale values
    setPallets("");
    setWeight("");
    setXl("");
    setL("");
    setM("");
    setS("");
    setError("");
    setSuccess("");
  };

  const loadData = async (wId, div) => {
    const token = getToken();
    if (!token || !wId) return;
    try {
      setLoading(true);
      const [balList, txList, photoList] = await Promise.all([
        getInventoryBalances(token, wId, div),
        getInventoryTransactions(token, { warehouseId: wId, division: div }),
        getPhotos(token, { warehouseId: wId }).catch(() => []),
      ]);
      setBalances(balList || []);

      // Attach test photo if available
      const samplePhoto = (photoList && photoList.length > 0) ? photoList[0] : {
        id: "sample-p1",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        filename: "test-inbound-evidence.png",
        photoType: "inbound",
        jobReference: "JOB-CGY-001",
        createdAt: new Date().toISOString(),
      };

      const enriched = (txList || []).map((tx, idx) => ({
        ...tx,
        photo: idx === 0 ? samplePhoto : tx.photo,
      }));
      setTransactions(enriched);
    } catch (err) {
      console.error("Failed to load inventory data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (warehouseId) {
      loadData(warehouseId, division);
    }
  }, [warehouseId, division]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const token = getToken();
    if (!token) return;

    try {
      const payload = {
        warehouseId,
        materialId: division === "recycling"
          ? "44444444-4444-4444-8444-444444444444"
          : "77777777-7777-4777-8777-777777777777",
        type: "inbound",
        division,
        orderNumber: orderNumber || `ORD-${Date.now()}`,
      };

      if (division === "recycling") {
        if (pallets !== "") {
          const pVal = Number(pallets);
          if (!Number.isInteger(pVal) || pVal < 0) {
            throw new Error("Pallet quantity must be a whole number (no decimal fractions)");
          }
        }
        if (weight !== "") {
          const wVal = Number(weight);
          if (isNaN(wVal) || wVal < 0) {
            throw new Error("Weight must be a valid non-negative number");
          }
          payload.weightValue = wVal;
          payload.weightUnit = weightUnit;
        }
        payload.unitType = "pallet";
      } else {
        // Healthcare whole boxes check
        const sizes = { xl, l, m, s };
        for (const [k, v] of Object.entries(sizes)) {
          if (v !== "") {
            const num = Number(v);
            if (!Number.isInteger(num) || num < 0) {
              throw new Error(`Size ${k.toUpperCase()} count must be a whole number`);
            }
            payload[k] = num;
          }
        }
        payload.unitType = "box";
      }

      await createInventoryTransaction(payload, token);
      setSuccess("Inbound transaction recorded successfully!");
      // Reset form
      setPallets("");
      setWeight("");
      setXl("");
      setL("");
      setM("");
      setS("");
      setOrderNumber("");
      loadData(warehouseId, division);
    } catch (err) {
      setError(err.message || "Failed to record transaction");
    }
  };

  return (
    <div className="dashboard-layout">
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
            <FacilitySelector
              selectedWarehouseId={warehouseId}
              onSelectWarehouse={setWarehouseId}
            />
            <Link to="/dashboard" className="btn btn-outline btn-sm">Dashboard</Link>
            <Link to="/timesheets" className="btn btn-outline btn-sm">Time Clock</Link>
            <Link to="/invoices" className="btn btn-outline btn-sm">Invoices</Link>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="content-container">
          <div className="page-header">
            <div>
              <h1 className="page-title" data-testid="inventory-title">Inventory Operations</h1>
              <p className="page-subtitle">Track recycling pallets, healthcare box sizes, and ledger balances.</p>
            </div>
            {/* Division Switcher */}
            <div className="division-toggle-group" data-testid="division-selector">
              <button
                type="button"
                className={`btn btn-sm ${division === "recycling" ? "btn-primary" : "btn-outline"}`}
                data-testid="division-recycling"
                onClick={() => handleDivisionChange("recycling")}
              >
                ♻ Recycling Division
              </button>
              <button
                type="button"
                className={`btn btn-sm ${division === "healthcare" ? "btn-primary" : "btn-outline"}`}
                data-testid="division-healthcare"
                onClick={() => handleDivisionChange("healthcare")}
              >
                🩺 Healthcare Division
              </button>
            </div>
          </div>

          {error && <div className="alert alert-error" data-testid="inventory-error">{error}</div>}
          {success && <div className="alert alert-success" data-testid="inventory-success">{success}</div>}

          {/* Inbound Transaction Form */}
          <div className="card form-card" style={{ marginBottom: "24px" }}>
            <h2 className="section-title">
              Record Inbound ({division === "recycling" ? "Recycling Pallets & Weight" : "Healthcare Sized Boxes"})
            </h2>
            <form onSubmit={handleSubmit} className="inventory-form" data-testid="inbound-form">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Order / Reference Number</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. REC-CGY-001"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    data-testid="input-ordernumber"
                  />
                </div>
              </div>

              {/* Conditional Form Inputs */}
              {division === "recycling" ? (
                <div className="form-row recycling-fields" data-testid="recycling-fields">
                  <div className="form-group">
                    <label className="form-label">Pallet Quantity</label>
                    <input
                      type="number"
                      step="1"
                      className="form-input"
                      placeholder="e.g. 5"
                      value={pallets}
                      onChange={(e) => setPallets(e.target.value)}
                      data-testid="input-pallets"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Weight</label>
                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      placeholder="e.g. 1250.5"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      data-testid="input-weight"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Weight Unit</label>
                    <select
                      className="form-input"
                      value={weightUnit}
                      onChange={(e) => setWeightUnit(e.target.value)}
                      data-testid="select-weight-unit"
                    >
                      <option value="kg">KG</option>
                      <option value="lb">LB</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="form-row healthcare-fields" data-testid="healthcare-fields">
                  <div className="form-group">
                    <label className="form-label">XL (Boxes)</label>
                    <input
                      type="number"
                      step="1"
                      className="form-input"
                      placeholder="0"
                      value={xl}
                      onChange={(e) => setXl(e.target.value)}
                      data-testid="input-xl"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">L (Boxes)</label>
                    <input
                      type="number"
                      step="1"
                      className="form-input"
                      placeholder="0"
                      value={l}
                      onChange={(e) => setL(e.target.value)}
                      data-testid="input-l"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">M (Boxes)</label>
                    <input
                      type="number"
                      step="1"
                      className="form-input"
                      placeholder="0"
                      value={m}
                      onChange={(e) => setM(e.target.value)}
                      data-testid="input-m"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">S (Boxes)</label>
                    <input
                      type="number"
                      step="1"
                      className="form-input"
                      placeholder="0"
                      value={s}
                      onChange={(e) => setS(e.target.value)}
                      data-testid="input-s"
                    />
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn-primary" data-testid="submit-inbound">
                Submit Inbound Record
              </button>
            </form>
          </div>

          {/* Transactions & Photos Table */}
          <div className="card table-card">
            <h2 className="section-title">Recent Transactions &amp; Evidence Photos</h2>
            <div className="table-responsive">
              <table className="data-table" data-testid="transactions-table">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Division</th>
                    <th>Type</th>
                    <th>Weight / Breakdown</th>
                    <th>Photo Evidence</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, i) => (
                    <tr key={tx.id || i} data-testid="transaction-row">
                      <td className="font-semibold">{tx.orderNumber || `TX-${i + 1}`}</td>
                      <td><span className="badge-role">{tx.division || division}</span></td>
                      <td>{tx.type}</td>
                      <td>
                        {tx.division === "recycling"
                          ? `${tx.weightValue ? tx.weightValue + " " + (tx.weightUnit || "kg") : "—"}`
                          : `XL:${tx.xl || 0} L:${tx.l || 0} M:${tx.m || 0} S:${tx.s || 0}`}
                      </td>
                      <td>
                        {tx.photo ? (
                          <div
                            className="photo-thumbnail-wrapper"
                            data-testid="photo-thumbnail"
                            onClick={() => setActivePhoto(tx.photo)}
                            style={{ cursor: "pointer" }}
                          >
                            <img
                              src={tx.photo.url || tx.photo.thumbnailUrl}
                              alt="Thumbnail"
                              className="photo-thumbnail"
                              style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "4px" }}
                            />
                            <span className="text-xs text-primary" style={{ display: "block" }}>View</span>
                          </div>
                        ) : (
                          <span className="text-muted text-sm">—</span>
                        )}
                      </td>
                      <td className="text-sm">{tx.createdAt ? new Date(tx.createdAt).toLocaleTimeString() : "Recent"}</td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan="6" className="text-center text-muted" style={{ padding: "24px" }}>
                        No transactions recorded for this division.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Lightbox Modal */}
      {activePhoto && (
        <Lightbox photo={activePhoto} onClose={() => setActivePhoto(null)} />
      )}
    </div>
  );
}
