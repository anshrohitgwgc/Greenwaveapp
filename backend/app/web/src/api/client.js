const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:4000";

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
 * Fetch authorized warehouses for current user
 * @param {string} token
 */
export function getWarehouses(token) {
  return apiRequest("/warehouses", token);
}

/**
 * Fetch inventory balances
 * @param {string} token
 * @param {string} [warehouseId]
 * @param {string} [division]
 */
export function getInventoryBalances(token, warehouseId, division) {
  let query = "";
  const params = [];
  if (warehouseId) params.push(`warehouseId=${warehouseId}`);
  if (division) params.push(`division=${division}`);
  if (params.length > 0) query = `?${params.join("&")}`;
  return apiRequest(`/inventory/balances${query}`, token);
}

/**
 * Fetch inventory transactions
 * @param {string} token
 * @param {Object} [filters]
 */
export function getInventoryTransactions(token, filters = {}) {
  const query = new URLSearchParams(filters).toString();
  return apiRequest(`/inventory/transactions${query ? `?${query}` : ""}`, token);
}

/**
 * Create inventory transaction
 * @param {Object} txData
 * @param {string} token
 */
export function createInventoryTransaction(txData, token) {
  return apiRequest("/inventory/transactions", token, {
    method: "POST",
    body: JSON.stringify(txData),
  });
}

/**
 * Fetch photos
 * @param {string} token
 * @param {Object} [filters]
 */
export function getPhotos(token, filters = {}) {
  const query = new URLSearchParams(filters).toString();
  return apiRequest(`/photos${query ? `?${query}` : ""}`, token);
}

/**
 * Time clock helpers
 */
export function clockIn(data, token) {
  return apiRequest("/timesheets/clock-in", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function clockOut(token) {
  return apiRequest("/timesheets/clock-out", token, {
    method: "POST",
  });
}

export function getCurrentShift(token) {
  return apiRequest("/timesheets/me/current", token).catch(() => null);
}

export function getTimesheetHistory(token) {
  return apiRequest("/timesheets/me/history", token);
}

/**
 * Invoices helpers
 */
export function getInvoices(token, filters = {}) {
  const query = new URLSearchParams(filters).toString();
  return apiRequest(`/invoices${query ? `?${query}` : ""}`, token);
}

export function getInvoiceById(id, token) {
  return apiRequest(`/invoices/${id}`, token);
}

export function createInvoice(invoiceData, token) {
  return apiRequest("/invoices", token, {
    method: "POST",
    body: JSON.stringify(invoiceData),
  });
}

export function getPickups(token) {
  return apiRequest("/pickups", token);
}

export function getPickupById(id, token) {
  return apiRequest(`/pickups/${id}`, token);
}

export function createPickup(pickupData, token) {
  return apiRequest("/pickups", token, {
    method: "POST",
    body: JSON.stringify(pickupData),
  });
}


