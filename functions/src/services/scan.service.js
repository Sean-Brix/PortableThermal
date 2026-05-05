"use strict";

const { randomUUID } = require("crypto");
const { getStorage } = require("firebase-admin/storage");
const { HttpError } = require("../utils/httpError");
const { makeDownloadUrl } = require("../utils/downloadUrl");

const SCAN_LOGS_PREFIX = "scan-logs";
const SCAN_SESSIONS_PREFIX = "scan-sessions";
const DEFAULT_SYSTEM_SETTINGS = {
  enableLogs: true,
  showThermalMarkings: true,
  enableAdminMode: true,
  adminPassword: "admin123",
  maxComparativeScans: 20
};

async function createScanLog(payload) {
  const scanId = randomUUID();
  const timestamp = new Date().toISOString();
  const temperature = Number(payload.temperature);
  const ambiance = Number(payload.ambiance);
  
  const log = {
    id: scanId,
    timestamp,
    mode: payload.mode || "single", // "single" or "comparative"
    source: payload.source || "unknown",
    equipment: payload.equipment || "Unknown",
    location: payload.location || "Unknown",
    temperature,
    ambiance,
    classification: classifyReading(temperature, ambiance),
    hotspotCount: payload.hotspotCount || 0,
    notes: payload.notes || "",
    photoPath: payload.photoPath || null,
    photoName: payload.photoPath ? payload.photoPath.split("/").pop() : null,
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
  const entries = await readScanLogEntries(bucket);
  const logs = await Promise.all(
    entries
      .map((entry) => entry.log)
      .filter((log) => scanLogMatchesFilters(log, filters))
      .map((log) => hydrateScanLog(bucket, log))
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
    source: payload.source || "unknown",
    equipment: payload.equipment || "Unknown",
    location: payload.location || "Unknown",
    scans: [],
    analysis: null,
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
  if (!Array.isArray(session.scans)) {
    session.scans = [];
  }
  
  if (!session.scans.includes(scanId)) {
    session.scans.push(scanId);
  }
  session.updatedAt = new Date().toISOString();
  
  await file.save(Buffer.from(JSON.stringify(session)), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    }
  });

  return session;
}

async function completeScanSession(sessionId, analysis = null) {
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
  session.updatedAt = session.completedAt;
  
  // If session contains scans, compute a reference temperature (TRef) excluding outliers
  // and store per-scan temperature differences relative to that reference.
  try {
    const bucket = getStorage().bucket();
    const entries = await readScanLogEntries(bucket);
    const logs = (session.scans || [])
      .map((scanId) => entries.find((entry) => entry.log.id === scanId))
      .filter(Boolean);

    if (logs.length > 0) {
      const temps = logs.map((l) => Number(l.log.temperature)).filter((v) => Number.isFinite(v));
      const tref = computeReferenceTemperature(temps);
      const serverAnalysis = buildComparativeAnalysis(logs.map((entry) => entry.log));
      session.tref = tref;
      session.analysis = {
        ...serverAnalysis,
        ...(analysis && typeof analysis === "object" ? analysis : {})
      };

      // Write back per-scan delta and tref into each log
      for (const entry of logs) {
        try {
          entry.log.tref = tref;
          entry.log.temperatureDifference = Number(entry.log.temperature) - tref;
          entry.log.comparativeRecommendation = getComparativeRecommendation(entry.log.temperatureDifference);
          await entry.file.save(Buffer.from(JSON.stringify(entry.log)), {
            contentType: "application/json",
            resumable: false,
            metadata: { cacheControl: "private, max-age=0, no-transform" }
          });
        } catch (_e) {
          // ignore write errors for individual logs
        }
      }
    } else if (analysis && typeof analysis === "object") {
      session.analysis = analysis;
    }
  } catch (_e) {
    // don't fail session completion on errors computing references
  }

  await file.save(Buffer.from(JSON.stringify(session)), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    }
  });

  return session;
}

async function getScanSessions(filters = {}) {
  const bucket = getStorage().bucket();
  const [files] = await bucket.getFiles({ prefix: `${SCAN_SESSIONS_PREFIX}/` });
  const entries = await readScanLogEntries(bucket);
  const logMap = new Map(entries.map((entry) => [entry.log.id, entry.log]));

  const sessions = await Promise.all(
    files
      .filter((file) => file.name.endsWith(".json"))
      .map(async (file) => {
        try {
          const [buffer] = await file.download();
          return JSON.parse(buffer.toString("utf8"));
        } catch (_error) {
          return null;
        }
      })
  );

  const hydrated = await Promise.all(
    sessions
      .filter((session) => session !== null)
      .filter((session) => scanSessionMatchesFilters(session, filters))
      .map((session) => hydrateScanSession(bucket, session, logMap))
  );

  return hydrated.sort((a, b) => new Date(b.completedAt || b.timestamp) - new Date(a.completedAt || a.timestamp));
}

async function getScanSession(sessionId) {
  const fileName = `${SCAN_SESSIONS_PREFIX}/${sessionId}.json`;
  const file = getStorage().bucket().file(fileName);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpError(404, "Session not found.");
  }

  const [buffer] = await file.download();
  const session = JSON.parse(buffer.toString("utf8"));
  const bucket = getStorage().bucket();
  const entries = await readScanLogEntries(bucket);
  const logMap = new Map(entries.map((entry) => [entry.log.id, entry.log]));
  return hydrateScanSession(bucket, session, logMap);
}

async function readScanLogEntries(bucket) {
  const [files] = await bucket.getFiles({ prefix: `${SCAN_LOGS_PREFIX}/` });
  const entries = await Promise.all(
    files
      .filter((file) => file.name.endsWith(".json"))
      .map(async (file) => {
        try {
          const [buffer] = await file.download();
          return { file, log: JSON.parse(buffer.toString("utf8")) };
        } catch (_error) {
          return null;
        }
      })
  );

  return entries.filter(Boolean);
}

async function hydrateScanLog(bucket, log) {
  const photoUrl = await resolvePhotoUrl(bucket, log.photoPath);
  return {
    ...log,
    url: photoUrl || log.url || null,
    imageUrl: photoUrl || log.imageUrl || null
  };
}

async function hydrateScanSession(bucket, session, logMap) {
  const scanIds = session.scans || [];
  const scans = await Promise.all(
    scanIds
      .map((scanId) => logMap.get(scanId))
      .filter(Boolean)
      .map((log) => hydrateScanLog(bucket, log))
  );
  const analysis = session.analysis || buildComparativeAnalysis(scans);

  return {
    ...session,
    scanIds,
    scans,
    scanCount: scans.length,
    analysis
  };
}

async function resolvePhotoUrl(bucket, photoPath) {
  if (!photoPath) return null;

  try {
    const file = bucket.file(photoPath);
    const [exists] = await file.exists();
    if (!exists) return null;

    const [metadata] = await file.getMetadata();
    const existingToken = metadata.metadata?.firebaseStorageDownloadTokens;
    if (existingToken) {
      return makeDownloadUrl(bucket.name, photoPath, existingToken.split(",")[0]);
    }

    const token = randomUUID();
    await file.setMetadata({
      metadata: {
        ...metadata.metadata,
        firebaseStorageDownloadTokens: token
      }
    });
    return makeDownloadUrl(bucket.name, photoPath, token);
  } catch (_error) {
    return null;
  }
}

function scanLogMatchesFilters(log, filters = {}) {
  if (filters.mode && log.mode !== filters.mode) return false;
  if (filters.source && log.source !== filters.source) return false;
  if (filters.equipment && log.equipment !== filters.equipment) return false;
  if (filters.location && log.location !== filters.location) return false;
  if (filters.classification && log.classification !== filters.classification) return false;
  return isWithinDateRange(log.timestamp, filters.startDate, filters.endDate);
}

function scanSessionMatchesFilters(session, filters = {}) {
  if (filters.source && session.source !== filters.source) return false;
  if (filters.status && session.status !== filters.status) return false;
  return isWithinDateRange(session.completedAt || session.timestamp, filters.startDate, filters.endDate);
}

function isWithinDateRange(timestamp, startDate, endDate) {
  if (!timestamp) return true;
  const value = new Date(timestamp);
  if (startDate && value < new Date(startDate)) return false;
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    if (value > end) return false;
  }
  return true;
}

function buildComparativeAnalysis(scans = []) {
  const temps = scans.map((scan) => Number(scan.temperature)).filter((value) => Number.isFinite(value));
  const tref = computeReferenceTemperature(temps);
  const deltas = scans.map((scan) => Number(scan.temperature) - tref);
  const finiteDeltas = deltas.filter((value) => Number.isFinite(value));
  const avgDelta = finiteDeltas.length
    ? finiteDeltas.reduce((sum, value) => sum + value, 0) / finiteDeltas.length
    : 0;
  const variance = finiteDeltas.length
    ? finiteDeltas.reduce((sum, value) => sum + Math.pow(value - avgDelta, 2), 0) / finiteDeltas.length
    : 0;
  const overallRecommendation = getWorstComparativeRecommendation(finiteDeltas);
  const classifications = {
    Critical: scans.filter((scan) => scan.classification === "Critical").length,
    Warning: scans.filter((scan) => scan.classification === "Warning").length,
    Normal: scans.filter((scan) => scan.classification === "Normal").length
  };

  return {
    scanCount: scans.length,
    tref,
    avgDelta,
    peakDelta: finiteDeltas.length ? Math.max(...finiteDeltas) : 0,
    avgTemperature: temps.length ? temps.reduce((sum, value) => sum + value, 0) / temps.length : 0,
    minTemperature: temps.length ? Math.min(...temps) : 0,
    maxTemperature: temps.length ? Math.max(...temps) : 0,
    standardDeviation: Math.sqrt(variance),
    classificationCounts: classifications,
    overallRecommendation,
    scanAnalyses: scans.map((scan, index) => {
      const delta = Number(scan.temperature) - tref;
      return {
        id: scan.id,
        index: index + 1,
        temperature: Number(scan.temperature),
        delta,
        recommendation: getComparativeRecommendation(delta)
      };
    })
  };
}

function computeReferenceTemperature(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return 0;
  if (finiteValues.length === 1) return finiteValues[0];

  const mean = finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
  const variance = finiteValues.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / finiteValues.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return mean;

  const filtered = finiteValues.filter((value) => Math.abs((value - mean) / stdDev) <= 2.0);
  const safeValues = filtered.length > 0 ? filtered : finiteValues;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function getComparativeRecommendation(delta) {
  if (!Number.isFinite(delta) || delta < 1) {
    return {
      key: "normal",
      label: "No significant difference",
      action: "Continue routine monitoring.",
      tone: "normal"
    };
  }

  const rounded = Math.round(delta);
  if (rounded <= 3) {
    return {
      key: "possible",
      label: "Possible deficiency",
      action: "Possible deficiency; warrants investigation.",
      tone: "warning"
    };
  }
  if (rounded <= 15) {
    return {
      key: "probable",
      label: "Probable deficiency",
      action: "Indicates probable deficiency; repair as time permits.",
      tone: "warning"
    };
  }
  return {
    key: "major",
    label: "Major discrepancy",
    action: "Major discrepancy; repair immediately.",
    tone: "critical"
  };
}

function getWorstComparativeRecommendation(deltas) {
  const rank = {
    normal: 0,
    possible: 1,
    probable: 2,
    major: 3
  };

  return deltas.reduce((worst, delta) => {
    const current = getComparativeRecommendation(delta);
    return rank[current.key] > rank[worst.key] ? current : worst;
  }, getComparativeRecommendation(0));
}

function classifyReading(temperature, ambiance) {
  const high = Number(temperature);
  const ambient = Number(ambiance);
  if (!Number.isFinite(high) || !Number.isFinite(ambient)) {
    return "Unknown";
  }

  const diff = high - ambient;
  const ratioDiff = diff / ambient;

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
    await file.save(Buffer.from(JSON.stringify(DEFAULT_SYSTEM_SETTINGS)), {
      contentType: "application/json",
      resumable: false
    });
    return { ...DEFAULT_SYSTEM_SETTINGS };
  }

  const [buffer] = await file.download();
  return { ...DEFAULT_SYSTEM_SETTINGS, ...JSON.parse(buffer.toString("utf8")) };
}

async function updateSystemSettings(settings) {
  const fileName = "system-config/settings.json";
  const file = getStorage().bucket().file(fileName);

  const currentSettings = await getSystemSettings();
  const nextSettings = {
    ...currentSettings,
    ...settings
  };

  if (typeof settings?.adminPassword === "string" && settings.adminPassword.trim()) {
    nextSettings.adminPassword = settings.adminPassword.trim();
  } else {
    nextSettings.adminPassword = currentSettings.adminPassword;
  }
  
  await file.save(Buffer.from(JSON.stringify(nextSettings)), {
    contentType: "application/json",
    resumable: false
  });

  return nextSettings;
}

function sanitizeSystemSettings(settings) {
  const { adminPassword, ...safeSettings } = settings || {};
  return safeSettings;
}

async function deleteAllScanLogs() {
  const bucket = getStorage().bucket();
  const [files] = await bucket.getFiles({ prefix: `${SCAN_LOGS_PREFIX}/` });
  const jsonFiles = files.filter((f) => f.name.endsWith(".json"));
  await Promise.all(jsonFiles.map((f) => f.delete()));
  return jsonFiles.length;
}

async function deleteAllScanSessions() {
  const bucket = getStorage().bucket();
  const [files] = await bucket.getFiles({ prefix: `${SCAN_SESSIONS_PREFIX}/` });
  const jsonFiles = files.filter((f) => f.name.endsWith(".json"));
  await Promise.all(jsonFiles.map((f) => f.delete()));
  return jsonFiles.length;
}

module.exports = {
  addScanToSession,
  classifyReading,
  completeScanSession,
  createScanLog,
  createScanSession,
  deleteAllScanLogs,
  deleteAllScanSessions,
  getScanLogs,
  getScanSession,
  getScanSessions,
  getSystemSettings,
  sanitizeSystemSettings,
  updateSystemSettings
};
