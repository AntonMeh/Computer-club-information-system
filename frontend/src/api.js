const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = "Перевірте правильність заповнення полів";
    } catch {
      /* тіло відповіді не JSON — лишаємо statusText */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  health: () => request("/health"),
  list: (endpoint) => request(endpoint),
  create: (endpoint, data) => request(endpoint, { method: "POST", body: JSON.stringify(data) }),
  remove: (endpoint, id) => request(`${endpoint}/${id}`, { method: "DELETE" }),
};
