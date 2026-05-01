"use strict";

const photoService = require("../services/photo.service");

async function listPhotos(_req, res, next) {
  try {
    const photos = await photoService.listPhotos();
    res.set("Cache-Control", "no-store");
    res.json({ photos });
  } catch (error) {
    next(error);
  }
}

async function createPhoto(req, res, next) {
  try {
    const photo = await photoService.createPhoto({
      imageData: req.body?.imageData,
      temperature: req.body?.temperature,
      ambiance: req.body?.ambiance
    });
    res.status(201).json(photo);
  } catch (error) {
    next(error);
  }
}

async function deletePhoto(req, res, next) {
  try {
    await photoService.deletePhoto(req.params.name);
    res.json({ deleted: true, name: req.params.name });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPhoto,
  deletePhoto,
  listPhotos
};
