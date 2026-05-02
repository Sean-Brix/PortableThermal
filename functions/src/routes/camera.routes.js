"use strict";

const { Router } = require("express");
const {
  completeShootRequest,
  createShootRequest,
  getShootRequest
} = require("../controllers/camera.controller");

const router = Router();

router.get("/shoot", getShootRequest);
router.post("/shoot", createShootRequest);
router.post("/shoot/complete", completeShootRequest);

module.exports = router;
