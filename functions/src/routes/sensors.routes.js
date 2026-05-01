"use strict";

const { Router } = require("express");
const {
  getLatestReading,
  updateLatestReading
} = require("../controllers/sensors.controller");

const router = Router();

router.get("/latest", getLatestReading);
router.post("/latest", updateLatestReading);

module.exports = router;
