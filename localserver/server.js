"use strict";

const express = require("express");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3000;
const app = express();

// ─── In-memory state ──────────────────────────────────────────────────────────

let shootRequest = null;  // { id, temp, ambient, createdAt, status: "pending" } | null
let sensorReading = null; // { temperature, ambiance, updatedAt } | null
let photos = [];          // { id, imageData, temperature, ambiance, createdAt, classification }

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(method, path, extra = "") {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${method.padEnd(6)} ${path}${extra ? "  →  " + extra : ""}`);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.use(express.json({ limit: "15mb" }));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifyReading(temp, ambient) {
  const diff = temp - ambient;
  const ratio = diff / ambient;
  if (ratio > 0.5 || diff > 50) return "Critical";
  if (ratio > 0.25 || diff > 25) return "Warning";
  return "Normal";
}

// ─── Validation ───────────────────────────────────────────────────────────────

function parseThermalScale(rawTemp, rawAmbient) {
  const tempStr = `${rawTemp ?? ""}`.trim();
  const ambStr  = `${rawAmbient ?? ""}`.trim();
  if (!tempStr || !ambStr) {
    const err = new Error("Temperature and ambient are required.");
    err.status = 400; throw err;
  }
  const temperature = Number(rawTemp);
  const ambiance    = Number(rawAmbient);
  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) {
    const err = new Error("Temperature and ambient must be numbers.");
    err.status = 400; throw err;
  }
  if (temperature <= ambiance) {
    const err = new Error("Temperature must be higher than ambient.");
    err.status = 400; throw err;
  }
  return { temperature, ambiance };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  log("GET", "/api/health", "ok");
  res.json({ ok: true });
});

// Debug — shows current in-memory state without the image data
app.get("/api/debug", (_req, res) => {
  log("GET", "/api/debug");
  res.json({
    shootRequest,
    sensorReading,
    photoCount: photos.length
  });
});

// GET /api/camera/shoot — PWA polls this every 2.5 s for pending requests
app.get("/api/camera/shoot", (_req, res) => {
  res.set("Cache-Control", "no-store");
  if (!shootRequest) {
    log("GET", "/api/camera/shoot", "no pending request (204)");
    res.sendStatus(204); return;
  }
  log("GET", "/api/camera/shoot", `returning pending id=${shootRequest.id} temp=${shootRequest.temp} ambient=${shootRequest.ambient}`);
  res.json(shootRequest);
});

// POST /api/camera/shoot — creates a shoot request (from RasPi / Postman)
app.post("/api/camera/shoot", (req, res, next) => {
  try {
    const body = req.body || {};
    const rawTemp    = body.temp    ?? body.temperature;
    const rawAmbient = body.ambient ?? body.ambiance;
    const { temperature, ambiance } = parseThermalScale(rawTemp, rawAmbient);

    shootRequest = {
      id: randomUUID(),
      temp: temperature,
      ambient: ambiance,
      createdAt: new Date().toISOString(),
      status: "pending"
    };

    log("POST", "/api/camera/shoot", `created id=${shootRequest.id} temp=${temperature} ambient=${ambiance}`);
    res.status(201).json(shootRequest);
  } catch (err) { next(err); }
});

// POST /api/camera/shoot/complete — PWA marks request done after capturing
app.post("/api/camera/shoot/complete", (req, res, next) => {
  try {
    const { requestId } = req.body || {};
    if (!requestId) {
      const err = new Error("requestId is required."); err.status = 400; throw err;
    }
    if (shootRequest && shootRequest.id !== requestId) {
      const err = new Error("Shoot request already changed."); err.status = 409; throw err;
    }
    log("POST", "/api/camera/shoot/complete", `completed id=${requestId}`);
    shootRequest = null;
    res.json({ completed: true });
  } catch (err) { next(err); }
});

// GET /api/sensors/latest
app.get("/api/sensors/latest", (_req, res, next) => {
  try {
    if (!sensorReading) {
      const err = new Error("No sensor reading yet."); err.status = 404; throw err;
    }
    log("GET", "/api/sensors/latest", `temp=${sensorReading.temperature} ambient=${sensorReading.ambiance}`);
    res.json(sensorReading);
  } catch (err) { next(err); }
});

// POST /api/sensors/latest
app.post("/api/sensors/latest", (req, res, next) => {
  try {
    const body = req.body || {};
    const { temperature, ambiance } = parseThermalScale(
      body.temperature ?? body.temp,
      body.ambiance    ?? body.ambient
    );
    sensorReading = { temperature, ambiance, updatedAt: new Date().toISOString() };
    log("POST", "/api/sensors/latest", `temp=${temperature} ambient=${ambiance}`);
    res.json(sensorReading);
  } catch (err) { next(err); }
});

// ─── Photo routes ─────────────────────────────────────────────────────────────

app.get("/api/photos", (_req, res) => {
  log("GET", "/api/photos", `${photos.length} photos`);
  res.json(photos.map(({ imageData, ...meta }) => ({ ...meta, url: imageData })));
});

app.post("/api/photos", (req, res, next) => {
  try {
    const { imageData, temperature, ambiance } = req.body || {};
    if (!imageData) {
      const err = new Error("imageData is required."); err.status = 400; throw err;
    }
    const temp = Number(temperature);
    const amb  = Number(ambiance);
    const photo = {
      id: randomUUID(),
      imageData,
      temperature: temp,
      ambiance: amb,
      createdAt: new Date().toISOString(),
      classification: classifyReading(temp, amb)
    };
    photos.push(photo);
    log("POST", "/api/photos", `saved id=${photo.id} temp=${temp} ambient=${amb} class=${photo.classification}`);
    const { imageData: _, ...meta } = photo;
    res.status(201).json({ ...meta, url: imageData });
  } catch (err) { next(err); }
});

app.delete("/api/photos/:id", (req, res) => {
  const { id } = req.params;
  const before = photos.length;
  photos = photos.filter((p) => p.id !== id);
  log("DELETE", `/api/photos/${id}`, before !== photos.length ? "deleted" : "not found");
  res.json({ deleted: true });
});

// ─── Error handlers ───────────────────────────────────────────────────────────

app.use((req, res) => {
  log(req.method, req.path, "404 no route");
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  else console.warn(`[warn] ${err.message}`);
  res.status(status).json({ error: status >= 500 ? "Server error." : err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n[localserver] Listening on http://0.0.0.0:${PORT}`);
  console.log("[localserver] Routes: GET/POST /api/camera/shoot  POST /api/camera/shoot/complete");
  console.log("              GET/POST /api/sensors/latest  GET/POST/DELETE /api/photos");
  console.log("              GET /api/health  GET /api/debug\n");
});
