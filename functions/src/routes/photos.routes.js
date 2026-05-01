"use strict";

const { Router } = require("express");
const {
  createPhoto,
  deletePhoto,
  listPhotos
} = require("../controllers/photos.controller");

const router = Router();

router.get("/", listPhotos);
router.post("/", createPhoto);
router.delete("/:name", deletePhoto);

module.exports = router;
