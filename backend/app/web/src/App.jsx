import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Pickups from "./pages/Pickups";
import CreatePickup from "./pages/CreatePickup";
import PickupDetails from "./pages/PickupDetails";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pickups"
          element={
            <ProtectedRoute>
              <Pickups />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pickups/new"
          element={
            <ProtectedRoute>
              <CreatePickup />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pickups/:id"
          element={
            <ProtectedRoute>
              <PickupDetails />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
