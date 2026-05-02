"use strict";

const { randomUUID } = require("crypto");
const { getStorage } = require("firebase-admin/storage");
const { HttpError } = require("../utils/httpError");

const SCAN_LOGS_PREFIX = "scan-logs";
const SCAN_SESSIONS_PREFIX = "scan-sessions";

async function createScanLog(payload) {
  const scanId = randomUUID();
  const timestamp = new Date().toISOString();
  
  const log = {
    id: scanId,
    timestamp,
    mode: payload.mode || "single", // "single" or "comparative"
    equipment: payload.equipment || "Unknown",
    location: payload.location || "Unknown",
    temperature: payload.temperature,
    ambiance: payload.ambiance,
    classification: classifyReading(payload.temperature, payload.ambiance),
    hotspotCount: payload.hotspotCount || 0,
    notes: payload.notes || "",
    photoPath: payload.photoPath,
    sessionId: payload.sessionId || null,
    status: "completed"
  };

  const fileName = `${SCAN_LOGS_PREFIX}/${timestamp.split("T")[0]}/${scanId}.json`;
  const file = getStorage().bucket().file(fileName);
  
  await file.save(Buffer.from(JSON.stringify(log)), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    }
  });

  return log;
}

async function getScanLogs(filters = {}) {
  const bucket = getStorage().bucket();
  const prefix = `${SCAN_LOGS_PREFIX}/`;
  const [files] = await bucket.getFiles({ prefix });

  const logs = await Promise.all(
    files
      .filter((file) => file.name.endsWith(".json"))
      .map(async (file) => {
        try {
          const [buffer] = await file.download();
          const log = JSON.parse(buffer.toString("utf8"));
          
          // Apply filters
          if (filters.equipment && log.equipment !== filters.equipment) return null;
          if (filters.location && log.location !== filters.location) return null;
          if (filters.classification && log.classification !== filters.classification) return null;
          if (filters.startDate && new Date(log.timestamp) < new Date(filters.startDate)) return null;
          if (filters.endDate && new Date(log.timestamp) > new Date(filters.endDate)) return null;
          
          return log;
        } catch (_error) {
          return null;
        }
      })
  );

  return logs.filter((log) => log !== null).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function createScanSession(payload) {
  const sessionId = randomUUID();
  const timestamp = new Date().toISOString();
  
  const session = {
    id: sessionId,
    timestamp,
    mode: "comparative",
    equipment: payload.equipment || "Unknown",
    location: payload.location || "Unknown",
    scans: [],
    status: "in-progress",
    notes: payload.notes || ""
  };

  const fileName = `${SCAN_SESSIONS_PREFIX}/${sessionId}.json`;
  const file = getStorage().bucket().file(fileName);
  
  await file.save(Buffer.from(JSON.stringify(session)), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    }
  });

  return session;
}

async function addScanToSession(sessionId, scanId) {
  const fileName = `${SCAN_SESSIONS_PREFIX}/${sessionId}.json`;
  const file = getStorage().bucket().file(fileName);
  
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpError(404, "Session not found.");
  }

  const [buffer] = await file.download();
  const session = JSON.parse(buffer.toString("utf8"));
  
  session.scans.push(scanId);
  
  await file.save(Buffer.from(JSON.stringify(session)), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    }
  });

  return session;
}

async function completeScanSession(sessionId) {
  const fileName = `${SCAN_SESSIONS_PREFIX}/${sessionId}.json`;
  const file = getStorage().bucket().file(fileName);
  
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpError(404, "Session not found.");
  }

  const [buffer] = await file.download();
  const session = JSON.parse(buffer.toString("utf8"));
  
  session.status = "completed";
  session.completedAt = new Date().toISOString();
  
  await file.save(Buffer.from(JSON.stringify(session)), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    }
  });

  return session;
}

function classifyReading(temperature, ambiance) {
  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) {
    return "Unknown";
  }

  const diff = temperature - ambiance;
  const ratioDiff = diff / ambiance;

  // Classification thresholds
  if (ratioDiff > 0.5 || diff > 50) {
    return "Critical";
  } else if (ratioDiff > 0.25 || diff > 25) {
    return "Warning";
  }
  return "Normal";
}

async function getSystemSettings() {
  const fileName = "system-config/settings.json";
  const file = getStorage().bucket().file(fileName);
  
  const [exists] = await file.exists();
  if (!exists) {
    const defaults = {
      enableLogs: true,
      showThermalMarkings: true,
      enableAdminMode: true,
      adminPassword: "admin123", // Should be hashed in production
      maxComparativeScans: 20
    };
    await file.save(Buffer.from(JSON.stringify(defaults)), {
      contentType: "application/json",
      resumable: false
    });
    return defaults;
  }

  const [buffer] = await file.download();
  return JSON.parse(buffer.toString("utf8"));
}

async function updateSystemSettings(settings) {
  const fileName = "system-config/settings.json";
  const file = getStorage().bucket().file(fileName);
  
  await file.save(Buffer.from(JSON.stringify(settings)), {
    contentType: "application/json",
    resumable: false
  });

  return settings;
}

module.exports = {
  addScanToSession,
  classifyReading,
  completeScanSession,
  createScanLog,
  createScanSession,
  getScanLogs,
  getSystemSettings,
  updateSystemSettings
};
