"use strict";

const sensorService = require("../services/sensor.service");

async function getLatestReading(_req, res, next) {
  try {
    const reading = await sensorService.getLatestReading();
    res.set("Cache-Control", "no-store");
    res.json(reading);
  } catch (error) {
    next(error);
  }
}

async function updateLatestReading(req, res, next) {
  try {
    const reading = await sensorService.updateLatestReading(req.body);
    res.set("Cache-Control", "no-store");
    res.json(reading);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getLatestReading,
  updateLatestReading
};
