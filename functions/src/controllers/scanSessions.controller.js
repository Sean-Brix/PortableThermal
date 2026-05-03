"use strict";

const scanService = require("../services/scan.service");
const { HttpError } = require("../utils/httpError");

async function completeComparativeSession(req, res, next) {
  try {
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      throw new HttpError(400, "Session ID is required.");
    }

    const session = await scanService.completeScanSession(sessionId, req.body?.analysis || null);
    res.json(session);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  completeComparativeSession
};
