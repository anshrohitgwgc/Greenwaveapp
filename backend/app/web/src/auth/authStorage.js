const TOKEN_KEY = "greenwave_token";
const USER_KEY = "greenwave_user";

/**
 * Save JWT access token to localStorage
 * @param {string} token
 */
export function saveToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

/**
 * Retrieve JWT access token from localStorage
 * @returns {string|null}
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Remove JWT access token from localStorage
 */
export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Save sanitized user profile to localStorage
 * @param {{ id?: number|string, fullName?: string, email?: string, role?: string }} user
 */
export function saveUser(user) {
  if (!user) return;
  const sanitized = {
    id: user.id,
    fullName: user.fullName || "",
    email: user.email || "",
    role: user.role || "",
  };
  localStorage.setItem(USER_KEY, JSON.stringify(sanitized));
}

/**
 * Retrieve user profile from localStorage
 * @returns {{ id?: number|string, fullName?: string, email?: string, role?: string }|null}
 */
export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Remove user profile from localStorage
 */
export function removeUser() {
  localStorage.removeItem(USER_KEY);
}

/**
 * Check if active session exists
 * @returns {boolean}
 */
export function isAuthenticated() {
  return Boolean(getToken());
}

/**
 * Clear all authentication data
 */
export function clearAuth() {
  removeToken();
  removeUser();
}
