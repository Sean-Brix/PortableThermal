"use strict";

const { Router } = require("express");
const adminRoutes = require("./admin.routes");
const cameraRoutes = require("./camera.routes");
const healthRoutes = require("./health.routes");
const photoRoutes = require("./photos.routes");
const sensorRoutes = require("./sensors.routes");
const testRoutes = require("./test.routes");

const router = Router();

router.use("/admin", adminRoutes);
router.use("/camera", cameraRoutes);
router.use("/health", healthRoutes);
router.use("/photos", photoRoutes);
router.use("/sensors", sensorRoutes);
router.use("/test", testRoutes);

module.exports = router;
