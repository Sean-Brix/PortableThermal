"use strict";

function getSystemInfo(_req, res, _next) {
  res.json({
    service: "PortableThermal API",
    version: "1.0.0",
    environment: process.env.NODE_ENV || "production",
    routes: {
      health: "/api/health",
      photos: "/api/photos",
      sensors: "/api/sensors",
      camera: "/api/camera",
      admin: "/api/admin",
      kiosk: "/kiosk"
    },
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  getSystemInfo
};
