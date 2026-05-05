"use strict";

const crypto = require("crypto");
const scanService = require("../services/scan.service");
const { HttpError } = require("../utils/httpError");

const DEV_PASSWORD = "121802";

async function adminLogin(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      throw new HttpError(400, "Username and password are required.");
    }

    const settings = await scanService.getSystemSettings();

    if (settings.enableAdminMode === false) {
      throw new HttpError(403, "Admin mode is disabled.");
    }

    if (username !== "admin" || password !== settings.adminPassword) {
      throw new HttpError(401, "Invalid username or password.");
    }

    // In production, issue a JWT token here
    const token = signAdminToken(settings.adminPassword);
    res.json({
      authenticated: true,
      token,
      message: "Admin authenticated"
    });
  } catch (error) {
    next(error);
  }
}

async function getSystemSettings(req, res, next) {
  try {
    const settings = await requireAdminSession(req);
    res.json(scanService.sanitizeSystemSettings(settings));
  } catch (error) {
    next(error);
  }
}

async function updateSystemSettings(req, res, next) {
  try {
    await requireAdminSession(req);
    const settings = await scanService.updateSystemSettings(req.body);
    res.json(scanService.sanitizeSystemSettings(settings));
  } catch (error) {
    next(error);
  }
}

async function getScanLogs(req, res, next) {
  try {
    await requireAdminSession(req);
    const filters = {
      mode: req.query.mode,
      source: req.query.source,
      equipment: req.query.equipment,
      location: req.query.location,
      classification: req.query.classification,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const logs = await scanService.getScanLogs(filters);
    res.set("Cache-Control", "no-store");
    res.json({ logs, count: logs.length });
  } catch (error) {
    next(error);
  }
}

async function getComparativeSessions(req, res, next) {
  try {
    await requireAdminSession(req);
    const filters = {
      source: req.query.source,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const sessions = await scanService.getScanSessions(filters);
    res.set("Cache-Control", "no-store");
    res.json({ sessions, count: sessions.length });
  } catch (error) {
    next(error);
  }
}

async function generateThermalReport(req, res, next) {
  try {
    await requireAdminSession(req);
    const scanId = req.params.scanId;
    if (!scanId) {
      throw new HttpError(400, "Scan ID is required.");
    }

    // Get scan log
    const logs = await scanService.getScanLogs({});
    const scan = logs.find((log) => log.id === scanId);
    
    if (!scan) {
      throw new HttpError(404, "Scan not found.");
    }

    // For now, return JSON report
    // In production, generate PDF with pdfkit
    const report = {
      title: "Thermal Inspection Report",
      scanId: scan.id,
      timestamp: scan.timestamp,
      equipment: scan.equipment,
      location: scan.location,
      readings: {
        highTemperature: scan.temperature,
        ambientTemperature: scan.ambiance
      },
      classification: scan.classification,
      hotspotCount: scan.hotspotCount,
      recommendations: [
        "IEC 60364-6:2016",
        "Tighten / Secure Connections",
        "Inspect / Clean for Corrosion or Oxidation",
        "Check for Signs of Arcing or Tracking",
        "Verify Load / Current Balance",
        "Ensure Proper Ventilation / Clean Dust or Debris"
      ],
      generatedAt: new Date().toISOString()
    };

    res.json(report);
  } catch (error) {
    next(error);
  }
}

function signAdminToken(adminPassword) {
  const payload = Buffer.from(JSON.stringify({ admin: true, timestamp: Date.now() })).toString("base64url");
  const signature = crypto.createHmac("sha256", adminPassword).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyAdminToken(token, adminPassword) {
  if (!token || !adminPassword) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = crypto.createHmac("sha256", adminPassword).update(payload).digest("base64url");
  return signature === expectedSignature;
}

async function requireAdminSession(req) {
  const settings = await scanService.getSystemSettings();
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!verifyAdminToken(token, settings.adminPassword)) {
    throw new HttpError(401, "Admin session required.");
  }

  return settings;
}

async function deleteAllLogs(req, res, next) {
  try {
    const devPassword = req.headers["x-dev-password"];
    if (devPassword !== DEV_PASSWORD) throw new HttpError(401, "Dev password required.");
    const count = await scanService.deleteAllScanLogs();
    res.json({ deleted: count, type: "scan-logs" });
  } catch (error) {
    next(error);
  }
}

async function deleteAllSessions(req, res, next) {
  try {
    const devPassword = req.headers["x-dev-password"];
    if (devPassword !== DEV_PASSWORD) throw new HttpError(401, "Dev password required.");
    const count = await scanService.deleteAllScanSessions();
    res.json({ deleted: count, type: "scan-sessions" });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  adminLogin,
  deleteAllLogs,
  deleteAllSessions,
  generateThermalReport,
  getComparativeSessions,
  getScanLogs,
  getSystemSettings,
  updateSystemSettings
};
