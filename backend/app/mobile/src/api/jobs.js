import { API_URL } from "./greenwave";

async function authenticatedRequest(path, token, options = {}) {
  if (!token) {
    throw new Error("You must be signed in to access pickups.");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Pickup request failed");
  }

  return data;
}

export function createPickup(pickupData, token) {
  return authenticatedRequest("/pickups", token, {
    method: "POST",
    body: JSON.stringify(pickupData),
  });
}

export function getPickups(token) {
  return authenticatedRequest("/pickups", token);
}

export function getPickupById(id, token) {
  return authenticatedRequest(`/pickups/${id}`, token);
}

export function getMyDriverPickups(token) {
  return authenticatedRequest("/pickups/driver/me", token);
}

export function updatePickup(id, data, token) {
  return authenticatedRequest(`/pickups/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
