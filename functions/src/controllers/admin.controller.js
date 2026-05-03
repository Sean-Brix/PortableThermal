"use strict";

const scanService = require("../services/scan.service");
const { HttpError } = require("../utils/httpError");

async function adminLogin(req, res, next) {
  try {
    const password = req.body?.password;
    if (!password) {
      throw new HttpError(400, "Password is required.");
    }

    const settings = await scanService.getSystemSettings();
    
    if (password !== settings.adminPassword) {
      throw new HttpError(401, "Invalid password.");
    }

    // In production, issue a JWT token here
    res.json({
      authenticated: true,
      token: Buffer.from(JSON.stringify({ admin: true, timestamp: Date.now() })).toString("base64"),
      message: "Admin authenticated"
    });
  } catch (error) {
    next(error);
  }
}

async function getSystemSettings(req, res, next) {
  try {
    const settings = await scanService.getSystemSettings();
    res.json(settings);
  } catch (error) {
    next(error);
  }
}

async function updateSystemSettings(req, res, next) {
  try {
    const settings = await scanService.updateSystemSettings(req.body);
    res.json(settings);
  } catch (error) {
    next(error);
  }
}

async function getScanLogs(req, res, next) {
  try {
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

module.exports = {
  adminLogin,
  generateThermalReport,
  getComparativeSessions,
  getScanLogs,
  getSystemSettings,
  updateSystemSettings
};
