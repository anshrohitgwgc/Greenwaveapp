const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Perform login request against GreenWave Auth API
 * @param {string} email - Company email address
 * @param {string} password - User password
 * @returns {Promise<{ access_token: string, user: { id: number|string, fullName: string, email: string, role: string } }>}
 */
export async function login(email, password) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Invalid email or password. Please try again.");
  }

  return data;
}

/**
 * Generic authenticated API request helper
 * @param {string} endpoint
 * @param {string} token
 * @param {RequestInit} [options]
 */
export async function apiRequest(endpoint, token, options = {}) {
  if (!token) {
    throw new Error("Authentication token is required.");
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "API request failed.");
  }

  return data;
}

/**
 * Fetch all pickups
 * @param {string} token
 */
export function getPickups(token) {
  return apiRequest("/pickups", token);
}

/**
 * Fetch single pickup by ID
 * @param {number|string} id
 * @param {string} token
 */
export function getPickupById(id, token) {
  return apiRequest(`/pickups/${id}`, token);
}

/**
 * Create a new pickup
 * @param {Object} pickupData
 * @param {string} token
 */
export function createPickup(pickupData, token) {
  return apiRequest("/pickups", token, {
    method: "POST",
    body: JSON.stringify(pickupData),
  });
}
