"use strict";

const { Router } = require("express");
const {
  adminLogin,
  generateThermalReport,
  getComparativeSessions,
  getScanLogs,
  getSystemSettings,
  updateSystemSettings
} = require("../controllers/admin.controller");

const router = Router();

router.post("/login", adminLogin);
router.get("/settings", getSystemSettings);
router.put("/settings", updateSystemSettings);
router.get("/logs", getScanLogs);
router.get("/comparative-sessions", getComparativeSessions);
router.get("/reports/:scanId", generateThermalReport);

module.exports = router;
