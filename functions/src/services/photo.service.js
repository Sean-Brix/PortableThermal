"use strict";

const { randomUUID } = require("crypto");
const { getStorage } = require("firebase-admin/storage");
const { HttpError } = require("../utils/httpError");
const { makeDownloadUrl } = require("../utils/downloadUrl");

const PHOTO_PREFIX = "camera-photos";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PHOTO_NAME_PATTERN = /^[0-9]{13}-[A-Za-z0-9-]+\.jpg$/;

async function listPhotos() {
  const bucket = getStorage().bucket();
  const [files] = await bucket.getFiles({ prefix: `${PHOTO_PREFIX}/` });

  const photos = await Promise.all(
    files
      .filter((file) => file.name.endsWith(".jpg"))
      .map(async (file) => {
        const [metadata] = await file.getMetadata();
        const token = await ensureDownloadToken(file, metadata);
        const createdAt =
          metadata.metadata?.createdAt ||
          metadata.timeCreated ||
          metadata.updated;

        return {
          name: file.name.split("/").pop(),
          path: file.name,
          url: makeDownloadUrl(bucket.name, file.name, token),
          createdAt,
          temperature: parseOptionalNumber(metadata.metadata?.temperature),
          ambiance: parseOptionalNumber(metadata.metadata?.ambiance)
        };
      })
  );

  photos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return photos;
}

async function createPhoto({ imageData, temperature, ambiance }) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(imageData || "");
  if (!match) {
    throw new HttpError(400, "Expected a JPEG image.");
  }

  const thermalScale = parseThermalScale(temperature, ambiance);
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new HttpError(400, "Photo must be under 10 MB.");
  }

  const bucket = getStorage().bucket();
  const createdAt = new Date().toISOString();
  const token = randomUUID();
  const name = `${Date.now()}-${randomUUID()}.jpg`;
  const path = `${PHOTO_PREFIX}/${name}`;
  const file = bucket.file(path);

  await file.save(buffer, {
    contentType: "image/jpeg",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform",
        metadata: {
          createdAt,
          temperature: String(thermalScale.temperature),
          ambiance: String(thermalScale.ambiance),
          firebaseStorageDownloadTokens: token
        }
      }
  });

  return {
    name,
    path,
    url: makeDownloadUrl(bucket.name, path, token),
    createdAt,
    temperature: thermalScale.temperature,
    ambiance: thermalScale.ambiance
  };
}

async function deletePhoto(name) {
  if (!PHOTO_NAME_PATTERN.test(name || "")) {
    throw new HttpError(400, "Invalid photo name.");
  }

  const file = getStorage().bucket().file(`${PHOTO_PREFIX}/${name}`);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpError(404, "Photo not found.");
  }

  await file.delete();
}

async function ensureDownloadToken(file, metadata) {
  const existing = metadata.metadata?.firebaseStorageDownloadTokens;
  if (existing) {
    return existing.split(",")[0];
  }

  const token = randomUUID();
  await file.setMetadata({
    metadata: {
      ...metadata.metadata,
      firebaseStorageDownloadTokens: token
    }
  });
  return token;
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

function parseOptionalNumber(value) {
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  createPhoto,
  deletePhoto,
  listPhotos
};
