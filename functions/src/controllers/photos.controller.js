"use strict";

const photoService = require("../services/photo.service");
const scanService = require("../services/scan.service");

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

    const source = req.body?.source;
    const mode = req.body?.mode;
    const shouldLogKioskScan = source === "kiosk" && (mode === "single" || mode === "comparative");
    let responsePhoto = photo;

    try {
      const settings = shouldLogKioskScan
        ? await scanService.getSystemSettings()
        : null;
      const loggingEnabled = settings?.enableLogs !== false;

      if (shouldLogKioskScan && loggingEnabled && mode === "single") {
        const log = await scanService.createScanLog({
          mode: "single",
          source: "kiosk",
          temperature: photo.temperature,
          ambiance: photo.ambiance,
          photoPath: photo.path,
          equipment: req.body?.equipment || "Unknown",
          location: req.body?.location || "Unknown",
          hotspotCount: 0
        });
        responsePhoto = {
          ...photo,
          scanLogId: log.id,
          classification: log.classification,
          loggedAt: log.timestamp
        };
      } else if (shouldLogKioskScan && loggingEnabled && mode === "comparative") {
        let sessionId = req.body?.sessionId;
        if (!sessionId) {
          const session = await scanService.createScanSession({
            source: "kiosk",
            equipment: req.body?.equipment || "Unknown",
            location: req.body?.location || "Unknown",
            notes: req.body?.notes || ""
          });
          sessionId = session.id;
        }

        const log = await scanService.createScanLog({
          mode: "comparative",
          source: "kiosk",
          temperature: photo.temperature,
          ambiance: photo.ambiance,
          photoPath: photo.path,
          sessionId,
          equipment: req.body?.equipment || "Unknown",
          location: req.body?.location || "Unknown",
          hotspotCount: 0
        });
        await scanService.addScanToSession(sessionId, log.id);
        responsePhoto = {
          ...photo,
          scanLogId: log.id,
          sessionId,
          classification: log.classification,
          loggedAt: log.timestamp
        };
      }
    } catch (_err) {
      // Logging error shouldn't fail the photo save.
    }

    res.status(201).json(responsePhoto);
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
