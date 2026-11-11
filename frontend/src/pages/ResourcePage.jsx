import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

const blankForm = (fields) => Object.fromEntries(fields.map((f) => [f.name, ""]));

// Перетворює значення форми на тіло запиту: числа — у Number, порожні необов'язкові поля — пропускає
function buildPayload(fields, form) {
  const payload = {};
  for (const f of fields) {
    const raw = String(form[f.name] ?? "").trim();
    if (raw === "") {
      if (f.required) payload[f.name] = f.type === "number" ? undefined : "";
      continue;
    }
    payload[f.name] = f.type === "number" ? Number(raw) : raw;
  }
  return payload;
}

export default function ResourcePage({ title, endpoint, idKey, columns, fields, emptyText, addLabel }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => blankForm(fields));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.list(endpoint));
      setError("");
    } catch (e) {
      setError(`Не вдалося завантажити дані: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.create(endpoint, buildPayload(fields, form));
      setForm(blankForm(fields));
      setError("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(row) {
    if (!window.confirm("Видалити цей запис?")) return;
    try {
      await api.remove(endpoint, row[idKey]);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      <h1>{title}</h1>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <form className="panel add-form" onSubmit={onSubmit}>
        {fields.map((f) => (
          <label key={f.name}>
            <span>{f.label}</span>
            <input
              type={f.type === "number" ? "number" : "text"}
              min={f.type === "number" ? 0 : undefined}
              step={f.step}
              required={f.required}
              placeholder={f.placeholder}
              value={form[f.name]}
              onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
            />
          </label>
        ))}
        <button type="submit" disabled={saving}>
          {saving ? "Зберігаємо…" : addLabel}
        </button>
      </form>

      <div className="panel table-wrap">
        {loading ? (
          <p className="muted">Завантаження…</p>
        ) : rows.length === 0 ? (
          <p className="muted">{emptyText}</p>
        ) : (
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th aria-label="Дії" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[idKey]}>
                  {columns.map((c) => (
                    <td key={c.key}>{row[c.key] ?? "—"}</td>
                  ))}
                  <td className="actions">
                    <button type="button" className="link-danger" onClick={() => onDelete(row)}>
                      Видалити
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
