"use strict";

const { Router } = require("express");
const {
  completeComparativeSession
} = require("../controllers/scanSessions.controller");

const router = Router();

router.post("/:sessionId/complete", completeComparativeSession);

module.exports = router;
