"use strict";

const { getStorage } = require("firebase-admin/storage");
const { HttpError } = require("../utils/httpError");

const SENSOR_READING_PATH = "sensor-readings/latest.json";

async function getLatestReading() {
  const file = getStorage().bucket().file(SENSOR_READING_PATH);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpError(404, "No sensor reading has been received yet.");
  }

  const [buffer] = await file.download();
  const reading = parseStoredReading(buffer);
  return reading;
}

async function updateLatestReading(payload) {
  const thermalScale = parseThermalScale(payload?.temperature, payload?.ambiance ?? payload?.ambient);
  const reading = {
    temperature: thermalScale.temperature,
    ambiance: thermalScale.ambiance,
    updatedAt: new Date().toISOString()
  };

  const file = getStorage().bucket().file(SENSOR_READING_PATH);
  await file.save(Buffer.from(JSON.stringify(reading)), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    }
  });

  return reading;
}

function parseStoredReading(buffer) {
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch (_error) {
    throw new HttpError(500, "Stored sensor reading is invalid.");
  }

  const thermalScale = parseThermalScale(value?.temperature, value?.ambiance);
  return {
    ...thermalScale,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null
  };
}

function parseThermalScale(temperatureValue, ambianceValue) {
  if (`${temperatureValue ?? ""}`.trim() === "" || `${ambianceValue ?? ""}`.trim() === "") {
    throw new HttpError(400, "Temperature and ambiance are required.");
  }

  const temperature = Number(temperatureValue);
  const ambiance = Number(ambianceValue);

  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) {
    throw new HttpError(400, "Temperature and ambiance are required.");
  }

  if (temperature <= ambiance) {
    throw new HttpError(400, "Temperature must be higher than ambiance.");
  }

  return { temperature, ambiance };
}

module.exports = {
  getLatestReading,
  updateLatestReading
};
