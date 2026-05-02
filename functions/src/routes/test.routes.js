"use strict";

const { Router } = require("express");
const { getSystemInfo } = require("../controllers/test.controller");

const router = Router();

router.get("/", getSystemInfo);

module.exports = router;
