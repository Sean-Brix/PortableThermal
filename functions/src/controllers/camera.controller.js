"use strict";

const cameraService = require("../services/camera.service");

async function createShootRequest(req, res, next) {
  try {
    const request = await cameraService.createShootRequest(req.body);
    res.status(201).json(request);
  } catch (error) {
    next(error);
  }
}

async function getShootRequest(_req, res, next) {
  try {
    const request = await cameraService.getShootRequest();
    res.set("Cache-Control", "no-store");

    if (!request) {
      res.status(204).end();
      return;
    }

    res.json(request);
  } catch (error) {
    next(error);
  }
}

async function completeShootRequest(req, res, next) {
  try {
    await cameraService.completeShootRequest(req.body?.requestId);
    res.json({ completed: true });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  completeShootRequest,
  createShootRequest,
  getShootRequest
};
