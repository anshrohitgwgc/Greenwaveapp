import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";
import { isAuthenticated, saveToken, saveUser } from "../auth/authStorage";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError("Please enter both your company email and password.");
      return;
    }

    setLoading(true);
    try {
      const data = await login(trimmedEmail, password);

      if (!data?.access_token || !data?.user) {
        throw new Error("Invalid response format received from authentication server.");
      }

      saveToken(data.access_token);
      saveUser(data.user);

      // Role-based navigation
      switch (data.user.role) {
        case "admin":
        case "manager":
        case "staff":
        case "driver":
        default:
          navigate("/dashboard", { replace: true });
          break;
      }
    } catch (err) {
      setError(err.message || "Unable to sign in. Please verify your credentials and network connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Brand Header */}
        <div className="brand-header">
          <div className="brand-logo">
            <img
              src="/assets/logo.png"
              alt="GreenWave Recycling"
              className="brand-logo-img"
              data-testid="brand-logo"
            />
            <span className="brand-name" style={{ display: "none" }}>GreenWave</span>
          </div>
          <p className="brand-subtitle">RECYCLING OPERATIONS PORTAL</p>
        </div>

        {/* Login Card */}
        <div className="card login-card">
          <h1 className="card-title">Welcome Back</h1>
          <p className="card-description">
            Sign in with your GreenWave employee account.
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="email" className="form-label">
                Company Email
              </label>
              <input
                id="email"
                type="email"
                className="form-input"
                placeholder="name@greenwave.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading}
            >
              {loading ? "Signing In..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="login-footer">GreenWave authorized employees only</p>
      </div>
    </div>
  );
}
