"use strict";

const express = require("express");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3000;
const app = express();

// ─── In-memory state ──────────────────────────────────────────────────────────
// No data is persisted. Everything resets on server restart.

let shootRequest = null;  // { id, temp, ambient, createdAt, status: "pending" } | null
let sensorReading = null; // { temperature, ambiance, updatedAt } | null

// ─── Middleware ───────────────────────────────────────────────────────────────

// Inline CORS — allow the PWA (any origin) to reach this local server
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.use(express.json({ limit: "15mb" }));

// ─── Validation ───────────────────────────────────────────────────────────────

function parseThermalScale(rawTemp, rawAmbient) {
  const tempStr = `${rawTemp ?? ""}`.trim();
  const ambStr = `${rawAmbient ?? ""}`.trim();
  if (!tempStr || !ambStr) {
    const err = new Error("Temperature and ambient are required.");
    err.status = 400;
    throw err;
  }
  const temperature = Number(rawTemp);
  const ambiance = Number(rawAmbient);
  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) {
    const err = new Error("Temperature and ambient are required.");
    err.status = 400;
    throw err;
  }
  if (temperature <= ambiance) {
    const err = new Error("Temperature must be higher than ambient.");
    err.status = 400;
    throw err;
  }
  return { temperature, ambiance };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health — used by the PWA to detect if the local server is reachable
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// GET /api/camera/shoot — PWA polls this for pending shoot requests
app.get("/api/camera/shoot", (_req, res) => {
  res.set("Cache-Control", "no-store");
  if (!shootRequest) { res.sendStatus(204); return; }
  res.json(shootRequest);
});

// POST /api/camera/shoot — RasPi creates a shoot request
// Body: { temp, ambient } or aliases { temperature, ambiance }
app.post("/api/camera/shoot", (req, res, next) => {
  try {
    const body = req.body || {};
    const rawTemp = body.temp ?? body.temperature;
    const rawAmbient = body.ambient ?? body.ambiance;
    const { temperature, ambiance } = parseThermalScale(rawTemp, rawAmbient);

    shootRequest = {
      id: randomUUID(),
      temp: temperature,
      ambient: ambiance,
      createdAt: new Date().toISOString(),
      status: "pending"
    };

    res.status(201).json(shootRequest);
  } catch (err) {
    next(err);
  }
});

// POST /api/camera/shoot/complete — PWA marks the request done
// Body: { requestId }
app.post("/api/camera/shoot/complete", (req, res, next) => {
  try {
    const { requestId } = req.body || {};
    if (!requestId) {
      const err = new Error("requestId is required.");
      err.status = 400;
      throw err;
    }
    if (shootRequest && shootRequest.id !== requestId) {
      const err = new Error("Shoot request already changed.");
      err.status = 409;
      throw err;
    }
    shootRequest = null;
    res.json({ completed: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/sensors/latest — PWA fetches latest sensor reading
app.get("/api/sensors/latest", (_req, res, next) => {
  try {
    if (!sensorReading) {
      const err = new Error("No sensor reading has been received yet.");
      err.status = 404;
      throw err;
    }
    res.json(sensorReading);
  } catch (err) {
    next(err);
  }
});

// POST /api/sensors/latest — RasPi pushes current sensor data
// Body: { temperature, ambiance }
app.post("/api/sensors/latest", (req, res, next) => {
  try {
    const body = req.body || {};
    const { temperature, ambiance } = parseThermalScale(
      body.temperature ?? body.temp,
      body.ambiance ?? body.ambient
    );
    sensorReading = { temperature, ambiance, updatedAt: new Date().toISOString() };
    res.json(sensorReading);
  } catch (err) {
    next(err);
  }
});

// ─── Error handlers ───────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Server error." : err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[localserver] Listening on http://0.0.0.0:${PORT}`);
  console.log("[localserver] Endpoints: GET/POST /api/camera/shoot, POST /api/camera/shoot/complete, GET/POST /api/sensors/latest, GET /api/health");
});
