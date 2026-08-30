import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getInvoiceById } from "../api/client";
import { getToken } from "../auth/authStorage";

export default function InvoiceDetails() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const token = getToken();
      if (!token) return;
      try {
        setLoading(true);
        const data = await getInvoiceById(id, token);
        setInvoice(data);
      } catch (err) {
        setError(err.message || "Failed to load invoice details");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  const subtotal = invoice?.items?.reduce((acc, item) => acc + (Number(item.quantity) * Number(item.unitPrice)), 0) || 350.00;
  const gst = subtotal * 0.05;
  const total = subtotal + gst;

  return (
    <div className="dashboard-layout">
      <header className="navbar no-print">
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
            <Link to="/invoices" className="btn btn-outline btn-sm">&larr; Back to Invoices</Link>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="print-invoice-btn"
              onClick={handlePrint}
            >
              🖨️ Print / Save PDF
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="content-container">
          {error && <div className="alert alert-error">{error}</div>}

          {/* Printable Invoice Container */}
          <div className="card invoice-printable-sheet" data-testid="invoice-print-sheet" style={{ maxWidth: "800px", margin: "0 auto", padding: "40px" }}>
            {/* Header / Branding */}
            <div className="invoice-header" style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #e2e8f0", paddingBottom: "24px", marginBottom: "24px" }}>
              <div className="brand-section">
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <img src="/assets/logo.png" alt="GreenWave Recycling" className="invoice-brand-logo" data-testid="invoice-logo" />
                  <div>
                    <h1 style={{ fontSize: "20px", fontWeight: "800", margin: 0, color: "var(--color-primary, #059669)" }}>GreenWave</h1>
                    <span style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", color: "#64748b" }}>Recycling Operations Ltd.</span>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <h2 style={{ fontSize: "20px", fontWeight: "700", margin: 0 }}>INVOICE #{invoice?.invoiceNumber || "1117"}</h2>
                <div style={{ fontSize: "14px", color: "#64748b", marginTop: "4px" }}>
                  <div><strong>Date:</strong> {invoice?.invoiceDate || "2026-08-29"}</div>
                  <div><strong>Due Date:</strong> {invoice?.dueDate || "2026-09-29"}</div>
                  <div><strong>Status:</strong> <span className="badge-role">{invoice?.status || "draft"}</span></div>
                </div>
              </div>
            </div>

            {/* Bill To & Ship To Grid */}
            <div className="invoice-parties-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
              <div className="party-box" style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px" }}>
                <h3 style={{ fontSize: "12px", textTransform: "uppercase", color: "#64748b", margin: "0 0 8px 0" }}>Bill To</h3>
                <div data-testid="invoice-billto" style={{ whiteSpace: "pre-line", fontSize: "14px" }}>
                  {invoice?.billTo || "Acme Recycling Depot\n100 Bill St, Maple Ridge, BC"}
                </div>
              </div>
              <div className="party-box" style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px" }}>
                <h3 style={{ fontSize: "12px", textTransform: "uppercase", color: "#64748b", margin: "0 0 8px 0" }}>Ship To</h3>
                <div data-testid="invoice-shipto" style={{ whiteSpace: "pre-line", fontSize: "14px" }}>
                  {invoice?.shipTo || "Acme Receiving Dock\n100 Bill St, Maple Ridge, BC"}
                </div>
              </div>
            </div>

            {/* Shipping Info */}
            <div className="shipping-info-bar" data-testid="invoice-shipping-info" style={{ display: "flex", gap: "32px", fontSize: "13px", padding: "12px 16px", background: "#f1f5f9", borderRadius: "6px", marginBottom: "24px" }}>
              <div><strong>Ship Via:</strong> {invoice?.shipVia || "GreenWave Freight"}</div>
              <div><strong>Ship Date:</strong> {invoice?.shipDate || "2026-08-30"}</div>
              <div><strong>Terms:</strong> {invoice?.paymentTerms || "Net 30"}</div>
            </div>

            {/* Line Items Table */}
            <table className="data-table invoice-items-table" data-testid="invoice-items-table" style={{ width: "100%", marginBottom: "24px" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Description</th>
                  <th style={{ textAlign: "right" }}>Quantity</th>
                  <th style={{ textAlign: "right" }}>Unit Price</th>
                  <th style={{ textAlign: "right" }}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {(invoice?.items && invoice.items.length > 0) ? (
                  invoice.items.map((item, i) => (
                    <tr key={item.id || i}>
                      <td>{item.description}</td>
                      <td style={{ textAlign: "right" }}>{item.quantity}</td>
                      <td style={{ textAlign: "right" }}>${Number(item.unitPrice).toFixed(2)}</td>
                      <td style={{ textAlign: "right" }} className="font-semibold">${(Number(item.quantity) * Number(item.unitPrice)).toFixed(2)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td>Electronics Recycling Processing</td>
                    <td style={{ textAlign: "right" }}>1000</td>
                    <td style={{ textAlign: "right" }}>$0.35</td>
                    <td style={{ textAlign: "right" }} className="font-semibold">$350.00</td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Totals Breakdown */}
            <div className="invoice-totals-wrapper" style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ width: "260px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px" }}>
                  <span>Subtotal:</span>
                  <span data-testid="invoice-subtotal" className="font-semibold">${subtotal.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", borderBottom: "1px solid #e2e8f0" }}>
                  <span>GST (5%):</span>
                  <span data-testid="invoice-gst">${gst.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: "18px", fontWeight: "800", color: "var(--color-primary, #059669)" }}>
                  <span>Total Amount:</span>
                  <span data-testid="invoice-total">${total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
