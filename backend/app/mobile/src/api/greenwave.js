export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

export async function login(email, password) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: normalizedEmail,
      password,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Invalid email or password.");
  }

  return data;
}

export async function getPickups(token) {
  const response = await fetch(`${API_URL}/pickups`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch pickups.");
  }
  return data;
}

export async function getMyDriverPickups(token) {
  return getPickups(token);
}

export async function getPickupById(id, token) {
  const response = await fetch(`${API_URL}/pickups/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch pickup details.");
  }
  return data;
}

export async function updatePickup(id, updates, token) {
  const response = await fetch(`${API_URL}/pickups/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(updates),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to update pickup.");
  }
  return data;
}
