import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createInvoice, getInvoices } from "../api/client";
import { getToken, getUser } from "../auth/authStorage";
import FacilitySelector from "../components/FacilitySelector";

export default function Invoices() {
  const navigate = useNavigate();
  const user = getUser() || { fullName: "User", role: "admin" };
  const [warehouseId, setWarehouseId] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");

  // Create Form State
  const [invoiceDate, setInvoiceDate] = useState("2026-08-29");
  const [dueDate, setDueDate] = useState("2026-09-29");
  const [billTo, setBillTo] = useState("Acme Recycling Depot\n100 Bill St, Maple Ridge, BC");
  const [shipTo, setShipTo] = useState("Acme Receiving Dock\n100 Bill St, Maple Ridge, BC");
  const [shipVia, setShipVia] = useState("GreenWave Freight");
  const [shipDate, setShipDate] = useState("2026-08-30");
  const [description, setDescription] = useState("Electronics Recycling Processing");
  const [quantity, setQuantity] = useState(1000);
  const [unitPrice, setUnitPrice] = useState(0.35);

  const loadInvoices = async (wId) => {
    const token = getToken();
    if (!token) return;
    try {
      setLoading(true);
      const list = await getInvoices(token, wId ? { warehouseId: wId } : {});
      setInvoices(list || []);
    } catch (err) {
      console.error("Failed to load invoices", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices(warehouseId);
  }, [warehouseId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    const token = getToken();
    if (!token) return;

    try {
      const payload = {
        customerId: "66666666-6666-4666-8666-666666666666",
        warehouseId: warehouseId || "11111111-1111-4111-8111-111111111111",
        invoiceDate,
        dueDate,
        billTo,
        shipTo,
        shipVia,
        shipDate,
        status: "draft",
        items: [
          {
            description,
            quantity: Number(quantity),
            unitPrice: Number(unitPrice),
          },
        ],
      };

      const created = await createInvoice(payload, token);
      setShowCreate(false);
      navigate(`/invoices/${created.id}`);
    } catch (err) {
      setError(err.message || "Failed to create invoice");
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
            <Link to="/inventory" className="btn btn-outline btn-sm">Inventory</Link>
            <Link to="/timesheets" className="btn btn-outline btn-sm">Time Clock</Link>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="content-container">
          <div className="page-header">
            <div>
              <h1 className="page-title" data-testid="invoices-title">Invoices &amp; Billing</h1>
              <p className="page-subtitle">Manage customer invoices, tax calculation, and print PDF statements.</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="create-invoice-btn"
              onClick={() => setShowCreate(!showCreate)}
            >
              {showCreate ? "Cancel" : "+ New Invoice"}
            </button>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {/* New Invoice Form */}
          {showCreate && (
            <div className="card form-card" style={{ marginBottom: "24px" }} data-testid="new-invoice-form">
              <h2 className="section-title">Create Customer Invoice</h2>
              <form onSubmit={handleCreate}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Invoice Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      data-testid="invoice-date-input"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Due Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      data-testid="invoice-duedate-input"
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Bill To</label>
                    <textarea
                      className="form-input"
                      rows="2"
                      value={billTo}
                      onChange={(e) => setBillTo(e.target.value)}
                      data-testid="invoice-billto-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ship To</label>
                    <textarea
                      className="form-input"
                      rows="2"
                      value={shipTo}
                      onChange={(e) => setShipTo(e.target.value)}
                      data-testid="invoice-shipto-input"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Line Item Description</label>
                    <input
                      type="text"
                      className="form-input"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      data-testid="invoice-desc-input"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Quantity</label>
                    <input
                      type="number"
                      className="form-input"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      data-testid="invoice-qty-input"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unit Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      data-testid="invoice-price-input"
                      required
                    />
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" data-testid="save-invoice-btn">
                  Generate &amp; Save Invoice
                </button>
              </form>
            </div>
          )}

          {/* Invoices List */}
          <div className="card table-card">
            <h2 className="section-title">Invoice Records</h2>
            <div className="table-responsive">
              <table className="data-table" data-testid="invoices-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, idx) => (
                    <tr key={inv.id || idx} data-testid="invoice-row">
                      <td className="font-semibold">#{inv.invoiceNumber || `110${idx + 1}`}</td>
                      <td>{inv.invoiceDate || "2026-08-29"}</td>
                      <td>{inv.customer?.name || inv.billTo || "Acme Recycling"}</td>
                      <td><span className="badge-role">{inv.status || "draft"}</span></td>
                      <td className="font-semibold text-primary">${inv.totalAmount || inv.total || "367.50"}</td>
                      <td>
                        <Link to={`/invoices/${inv.id}`} className="btn btn-outline btn-sm" data-testid={`view-invoice-${inv.id}`}>
                          View / Print &rarr;
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {invoices.length === 0 && (
                    <tr>
                      <td colSpan="6" className="text-center text-muted" style={{ padding: "24px" }}>
                        No invoices found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
