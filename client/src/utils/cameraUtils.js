import { fetchLocalFirst } from "../api.js";

export async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "Camera permission was blocked.";
  if (error?.name === "NotFoundError")   return "No camera was found.";
  if (location.protocol !== "https:" && location.hostname !== "localhost")
    return "Camera access needs HTTPS or localhost.";
  return error?.message || "Could not open the camera.";
}

export async function resolveThermalScale(temperatureValue, ambianceValue) {
  const manual = getManualThermalScale(temperatureValue, ambianceValue);
  if (manual?.error) throw new Error(manual.error);
  if (manual) return manual;
  try {
    return await fetchSensorScale();
  } catch (err) {
    throw new Error(`${err.message} Enter test values while the sensor API is empty.`);
  }
}

export function getManualThermalScale(temperatureValue, ambianceValue) {
  const hasT = `${temperatureValue}`.trim() !== "";
  const hasA = `${ambianceValue}`.trim() !== "";
  if (!hasT && !hasA) return null;
  if (!hasT || !hasA) return { error: "Enter both temperature and ambiance numbers." };
  return parseThermalScale(temperatureValue, ambianceValue);
}

export async function fetchSensorScale() {
  const response = await fetchLocalFirst("/sensors/latest", { cache: "no-store" });
  const reading  = await readJson(response);
  const scale    = parseThermalScale(reading.temperature, reading.ambiance ?? reading.ambient);
  if (scale.error) throw new Error(`Sensor reading is invalid. ${scale.error}`);
  return scale;
}

export function parseThermalScale(temperatureValue, ambianceValue) {
  const temperature = Number(temperatureValue);
  const ambiance    = Number(ambianceValue);
  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance))
    return { error: "Enter both temperature and ambiance numbers." };
  if (temperature <= ambiance)
    return { error: "Temperature must be higher than ambiance." };
  return { temperature, ambiance };
}
