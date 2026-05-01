"use strict";

const { Router } = require("express");
const healthRoutes = require("./health.routes");
const photoRoutes = require("./photos.routes");
const sensorRoutes = require("./sensors.routes");

const router = Router();

router.use("/health", healthRoutes);
router.use("/photos", photoRoutes);
router.use("/sensors", sensorRoutes);

module.exports = router;
