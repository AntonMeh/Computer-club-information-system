const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const TOKEN_STORAGE_KEY = "club_access_token";

// Токен тримаємо в пам'яті застосунку з відновленням із sessionStorage (розділ 3 специфікації)
let memoryToken = null;
try {
  memoryToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
} catch {
  memoryToken = null;
}

let unauthorizedHandler = null;

export function getToken() {
  return memoryToken;
}

export function setToken(token) {
  memoryToken = token || null;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    /* sessionStorage може бути недоступним у приватному режимі */
  }
}

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  constructor(message, status, body = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !(options.body instanceof URLSearchParams)) {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }
  if (memoryToken) {
    headers["Authorization"] = `Bearer ${memoryToken}`;
  }

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError("Немає зв'язку з сервером. Перевірте підключення до API.", 0);
  }

  if (!res.ok) {
    let detail = res.statusText || "Помилка запиту";
    let body = null;
    try {
      body = await res.json();
      if (typeof body?.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body?.detail)) {
        detail = "Перевірте правильність заповнення полів";
      }
    } catch {
      /* тіло відповіді не JSON */
    }

    if (res.status === 401 && path !== "/auth/login" && unauthorizedHandler) {
      unauthorizedHandler();
    }

    throw new ApiError(detail, res.status, body);
  }

  return res.status === 204 ? null : res.json();
}

export const api = {
  health: () => request("/health"),
  get: (path) => request(path),
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  patch: (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (endpoint, id) =>
    request(id !== undefined ? `${endpoint}/${id}` : endpoint, { method: "DELETE" }),

  // Сумісність зі сторінками довідників
  list: (endpoint) => request(endpoint),
  create: (endpoint, data) => request(endpoint, { method: "POST", body: JSON.stringify(data) }),
  update: (endpoint, id, data) =>
    request(`${endpoint}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  auth: {
    login: async (username, password) => {
      const form = new URLSearchParams();
      form.set("username", username);
      form.set("password", password);
      const data = await request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      setToken(data.access_token);
      return data;
    },
    me: () => request("/auth/me"),
    changePassword: (current_password, new_password) =>
      request("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password, new_password }),
      }),
    logout: () => setToken(null),
  },
};
