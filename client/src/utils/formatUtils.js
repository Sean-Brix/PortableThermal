export function formatDate(value) {
  if (!value) return "Saved photo";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
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
