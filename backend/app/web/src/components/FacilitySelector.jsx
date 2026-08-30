import { useEffect, useState } from "react";
import { getWarehouses } from "../api/client";
import { getToken } from "../auth/authStorage";

export default function FacilitySelector({ selectedWarehouseId, onSelectWarehouse }) {
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = getToken();
        if (token) {
          const list = await getWarehouses(token);
          // Deduplicate by ID
          const unique = Array.from(new Map(list.map((w) => [w.id, w])).values());
          setWarehouses(unique);
          if (unique.length > 0 && !selectedWarehouseId && onSelectWarehouse) {
            onSelectWarehouse(unique[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to load facilities", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="facility-selector-wrapper">
      <label htmlFor="facility-select" className="facility-label">Facility:</label>
      <select
        id="facility-select"
        data-testid="facility-selector"
        className="facility-select"
        value={selectedWarehouseId || ""}
        onChange={(e) => onSelectWarehouse && onSelectWarehouse(e.target.value)}
        disabled={loading || warehouses.length <= 1}
      >
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </div>
  );
}
