/**
 * Форматування сум, дат, часу, тривалості та телефонів за правилами розділу 5 (локаль uk-UA).
 */

const numberFmt = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Форматує грошову суму: 1390 -> "1 390,00 ₴"
 */
export function formatMoney(value) {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return "0,00 ₴";
  return `${numberFmt.format(num).replace(/\u00a0/g, " ")} ₴`;
}

/**
 * Форматує дату YYYY-MM-DD або Date у "15.11.2026"
 */
export function formatDate(value) {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}.${m}.${y}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

/**
 * Форматує час у 24-годинному форматі "18:30"
 */
export function formatTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Форматує дату й час: "15.11.2026, 18:30"
 */
export function formatDateTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDate(date)}, ${formatTime(date)}`;
}

/**
 * Форматує тривалість із хвилин у "2 год 15 хв"
 */
export function formatDuration(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes ?? 0)));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h} год ${m} хв`;
}

/**
 * Форматує телефон: "+380500000001" -> "+380 50 000 00 01"
 */
export function formatPhone(phone) {
  if (!phone) return "—";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("380")) {
    return `+380 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
  }
  return String(phone);
}

