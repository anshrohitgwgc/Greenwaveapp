import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { clockIn, clockOut, getCurrentShift, getTimesheetHistory, getWarehouses } from "../api/client";
import { getToken, getUser } from "../auth/authStorage";
import FacilitySelector from "../components/FacilitySelector";

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function TimeClock() {
  const user = getUser() || { fullName: "User", role: "staff" };
  const [warehouseId, setWarehouseId] = useState("");
  const [currentShift, setCurrentShift] = useState(null);
  const [history, setHistory] = useState([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const timerRef = useRef(null);

  const loadShifts = async () => {
    const token = getToken();
    if (!token) return;
    try {
      const [shift, historyList] = await Promise.all([
        getCurrentShift(token),
        getTimesheetHistory(token).catch(() => []),
      ]);
      setCurrentShift(shift);
      setHistory(historyList || []);

      if (shift && shift.clockIn) {
        const startMs = new Date(shift.clockIn).getTime();
        const diff = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        setElapsedSeconds(diff);
      } else {
        setElapsedSeconds(0);
      }
    } catch (err) {
      console.error("Failed to load timesheet data", err);
    }
  };

  useEffect(() => {
    loadShifts();
  }, []);

  // Live timer tick
  useEffect(() => {
    if (currentShift && currentShift.clockIn) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const startMs = new Date(currentShift.clockIn).getTime();
        const diff = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        setElapsedSeconds(diff);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedSeconds(0);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentShift]);

  const handleClockIn = async () => {
    if (isSubmitting || currentShift) return;
    setIsSubmitting(true);
    setError("");
    setSuccess("");

    const token = getToken();
    try {
      const shift = await clockIn({ warehouseId: warehouseId || undefined }, token);
      setCurrentShift(shift);
      setSuccess("Clocked in successfully!");
      loadShifts();
    } catch (err) {
      setError(err.message || "Failed to clock in");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClockOut = async () => {
    if (isSubmitting || !currentShift) return;
    setIsSubmitting(true);
    setError("");
    setSuccess("");

    const token = getToken();
    try {
      await clockOut(token);
      setCurrentShift(null);
      setSuccess("Clocked out successfully!");
      loadShifts();
    } catch (err) {
      setError(err.message || "Failed to clock out");
    } finally {
      setIsSubmitting(false);
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
            <Link to="/invoices" className="btn btn-outline btn-sm">Invoices</Link>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="content-container">
          <div className="page-header">
            <div>
              <h1 className="page-title" data-testid="timeclock-title">Staff Time Clock</h1>
              <p className="page-subtitle">Track shift hours, punch in/out, and review past attendance.</p>
            </div>
          </div>

          {error && <div className="alert alert-error" data-testid="timeclock-error">{error}</div>}
          {success && <div className="alert alert-success" data-testid="timeclock-success">{success}</div>}

          {/* Clock In / Out Action Card */}
          <div className="card clock-card" style={{ marginBottom: "24px", textAlign: "center", padding: "32px" }}>
            <div className="status-indicator-group" style={{ marginBottom: "16px" }}>
              <span
                className={`status-pill ${currentShift ? "status-in-progress" : "status-pending"}`}
                data-testid="shift-status"
                style={{ fontSize: "16px", padding: "8px 16px" }}
              >
                {currentShift ? "🟢 Clocked In" : "⚪ Clocked Out"}
              </span>
            </div>

            <div className="timer-display" style={{ margin: "24px 0" }}>
              <span className="text-muted" style={{ display: "block", marginBottom: "8px" }}>Active Shift Duration</span>
              <span
                className="live-timer-text"
                data-testid="live-timer"
                style={{ fontSize: "48px", fontWeight: "700", fontFamily: "monospace", color: currentShift ? "var(--color-primary, #059669)" : "#64748b" }}
              >
                {formatDuration(elapsedSeconds)}
              </span>
            </div>

            <div className="clock-actions" style={{ display: "flex", justifyContent: "center", gap: "16px" }}>
              {!currentShift ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleClockIn}
                  disabled={isSubmitting}
                  data-testid="clock-in-btn"
                  style={{ minWidth: "160px", padding: "12px 24px", fontSize: "16px" }}
                >
                  {isSubmitting ? "Punching..." : "Clock In"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleClockOut}
                  disabled={isSubmitting}
                  data-testid="clock-out-btn"
                  style={{ minWidth: "160px", padding: "12px 24px", fontSize: "16px", borderColor: "#dc2626", color: "#dc2626" }}
                >
                  {isSubmitting ? "Punching..." : "Clock Out"}
                </button>
              )}
            </div>
          </div>

          {/* Timesheet History Card */}
          <div className="card table-card">
            <h2 className="section-title">Recent Shift History</h2>
            <div className="table-responsive">
              <table className="data-table" data-testid="timesheet-history">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((sh, idx) => {
                    const start = sh.clockIn ? new Date(sh.clockIn) : null;
                    const end = sh.clockOut ? new Date(sh.clockOut) : null;
                    const durSec = (start && end) ? Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000)) : 0;
                    return (
                      <tr key={sh.id || idx} data-testid="history-row">
                        <td className="font-semibold">{start ? start.toLocaleDateString() : "Today"}</td>
                        <td>{start ? start.toLocaleTimeString() : "—"}</td>
                        <td>{end ? end.toLocaleTimeString() : <span className="text-success">Active</span>}</td>
                        <td data-testid="shift-duration">{durSec > 0 ? formatDuration(durSec) : "Active / <1m"}</td>
                      </tr>
                    );
                  })}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan="4" className="text-center text-muted" style={{ padding: "24px" }}>
                        No past shifts recorded yet.
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
