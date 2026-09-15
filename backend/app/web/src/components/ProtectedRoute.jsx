import { Navigate, Outlet } from "react-router-dom";
import { isAuthenticated } from "../auth/authStorage";

export default function ProtectedRoute({ children }) {
  const isAuth = isAuthenticated();

  if (!isAuth) {
    return <Navigate to="/login" replace />;
  }

  return children ? children : <Outlet />;
}
