export function formatDate(value) {
  return formatDateTime(value, "Saved photo");
}

export function formatDateTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = normalizeDate(value);
  if (!date) return fallback;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${formatTime(date)}`;
}

export function formatTime(value) {
  const date = normalizeDate(value);
  if (!date) return "-";
  return date
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

export function formatScale(photo) {
  if (photo.temperature == null || photo.ambiance == null) return "No scale saved";
  return `High ${formatNumber(photo.temperature)} / Ambient ${formatNumber(photo.ambiance)}`;
}

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return Number.isInteger(number) ? `${number}` : `${number.toFixed(1)}`;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
