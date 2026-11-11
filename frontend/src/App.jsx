import { useEffect, useState } from "react";
import { api } from "./api.js";
import ResourcePage from "./pages/ResourcePage.jsx";

// Нова сутність у меню = новий запис у цьому об'єкті (бекенд-роутер + конфіг сторінки)
const PAGES = {
  clubs: {
    nav: "Клуби",
    title: "Клуби мережі",
    endpoint: "/clubs",
    idKey: "club_id",
    addLabel: "Додати клуб",
    emptyText: "Клубів ще немає. Додайте перший за допомогою форми вище.",
    columns: [
      { key: "club_id", label: "№" },
      { key: "name", label: "Назва" },
      { key: "address", label: "Адреса" },
      { key: "phone", label: "Телефон" },
      { key: "pc_count", label: "Кількість ПК" },
    ],
    fields: [
      { name: "name", label: "Назва", type: "text", required: true },
      { name: "address", label: "Адреса", type: "text", required: true },
      { name: "phone", label: "Телефон", type: "text", required: true, placeholder: "+380…" },
      { name: "pc_count", label: "Кількість ПК", type: "number" },
    ],
  },
  clients: {
    nav: "Клієнти",
    title: "Клієнти",
    endpoint: "/clients",
    idKey: "client_id",
    addLabel: "Додати клієнта",
    emptyText: "Клієнтів ще немає. Додайте першого за допомогою форми вище.",
    columns: [
      { key: "client_id", label: "№" },
      { key: "full_name", label: "ПІБ" },
      { key: "phone", label: "Телефон" },
      { key: "email", label: "Email" },
      { key: "reg_date", label: "Дата реєстрації" },
      { key: "bonus_balance", label: "Бонуси" },
    ],
    fields: [
      { name: "full_name", label: "ПІБ", type: "text", required: true },
      { name: "phone", label: "Телефон", type: "text", required: true, placeholder: "+380…" },
      { name: "email", label: "Email", type: "text" },
    ],
  },
};

export default function App() {
  const [active, setActive] = useState("clubs");
  const [apiOk, setApiOk] = useState(null);

  useEffect(() => {
    api.health().then(() => setApiOk(true)).catch(() => setApiOk(false));
  }, []);

  const page = PAGES[active];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Клубна система</div>
        <nav aria-label="Розділи">
          {Object.entries(PAGES).map(([key, p]) => (
            <button
              key={key}
              type="button"
              className={key === active ? "nav-item active" : "nav-item"}
              aria-current={key === active ? "page" : undefined}
              onClick={() => setActive(key)}
            >
              {p.nav}
            </button>
          ))}
        </nav>
        <p className={`api-status ${apiOk === false ? "down" : apiOk ? "up" : ""}`}>
          {apiOk === null ? "Перевірка API…" : apiOk ? "API підключено" : "API недоступне"}
        </p>
      </aside>

      <main className="content">
        <ResourcePage key={active} {...page} />
      </main>
    </div>
  );
}
