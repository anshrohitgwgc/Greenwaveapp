export const API_URL = "https://gwgcservers.ca/api/v1";

export async function login(email, password) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
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