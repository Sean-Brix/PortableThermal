"use strict";

const { randomUUID } = require("crypto");
const { getStorage } = require("firebase-admin/storage");
const { HttpError } = require("../utils/httpError");

const CAMERA_SHOOT_PATH = "camera-shoot/latest.json";

async function createShootRequest(payload) {
  const thermalScale = parseThermalScale(payload?.temp ?? payload?.temperature, payload?.ambient ?? payload?.ambiance);
  const request = {
    id: randomUUID(),
    temp: thermalScale.temperature,
    ambient: thermalScale.ambiance,
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  const file = getStorage().bucket().file(CAMERA_SHOOT_PATH);
  await file.save(Buffer.from(JSON.stringify(request)), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    }
  });

  return request;
}

async function getShootRequest() {
  const file = getStorage().bucket().file(CAMERA_SHOOT_PATH);
  const [exists] = await file.exists();
  if (!exists) {
    return null;
  }

  const [buffer] = await file.download();
  const request = parseStoredRequest(buffer);
  if (request.status !== "pending") {
    return null;
  }

  return request;
}

async function completeShootRequest(requestId) {
  if (`${requestId ?? ""}`.trim() === "") {
    throw new HttpError(400, "requestId is required.");
  }

  const file = getStorage().bucket().file(CAMERA_SHOOT_PATH);
  const [exists] = await file.exists();
  if (!exists) {
    return;
  }

  const [buffer] = await file.download();
  const request = parseStoredRequest(buffer);
  if (request.id !== requestId) {
    throw new HttpError(409, "Shoot request already changed.");
  }

  await file.delete();
}

function parseStoredRequest(buffer) {
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch (_error) {
    throw new HttpError(500, "Stored shoot request is invalid.");
  }

  const thermalScale = parseThermalScale(value?.temp ?? value?.temperature, value?.ambient ?? value?.ambiance);
  return {
    id: typeof value?.id === "string" ? value.id : null,
    temp: thermalScale.temperature,
    ambient: thermalScale.ambiance,
    createdAt: typeof value?.createdAt === "string" ? value.createdAt : null,
    status: value?.status === "pending" ? "pending" : "pending"
  };
}

function parseThermalScale(temperatureValue, ambianceValue) {
  if (`${temperatureValue ?? ""}`.trim() === "" || `${ambianceValue ?? ""}`.trim() === "") {
    throw new HttpError(400, "Temperature and ambient are required.");
  }

  const temperature = Number(temperatureValue);
  const ambiance = Number(ambianceValue);

  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) {
    throw new HttpError(400, "Temperature and ambient are required.");
  }

  if (temperature <= ambiance) {
    throw new HttpError(400, "Temperature must be higher than ambient.");
  }

  return { temperature, ambiance };
}

module.exports = {
  completeShootRequest,
  createShootRequest,
  getShootRequest
};
