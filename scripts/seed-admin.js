"use strict";

/**
 * Run with: node scripts/seed-admin.js
 *
 * Requires one of:
 *  - GOOGLE_APPLICATION_CREDENTIALS env var pointing to your service account JSON
 *  - A serviceAccountKey.json file in the functions/ directory
 *  - Running inside the Firebase emulator environment
 *
 * Set FIREBASE_STORAGE_BUCKET env var to your bucket (e.g. "your-project.appspot.com")
 * or edit DEFAULT_BUCKET below.
 */

const DEFAULT_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "";

async function main() {
  let admin;
  try {
    admin = require("firebase-admin");
  } catch {
    console.error("firebase-admin not found. Run: npm install firebase-admin");
    process.exit(1);
  }

  const bucket = DEFAULT_BUCKET;
  if (!bucket) {
    console.error("Set FIREBASE_STORAGE_BUCKET env var or edit DEFAULT_BUCKET in this script.");
    process.exit(1);
  }

  let serviceAccount;
  try {
    serviceAccount = require("../functions/serviceAccountKey.json");
  } catch {
    // Fall back to application default credentials
  }

  if (!admin.apps.length) {
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: bucket
      });
    } else {
      admin.initializeApp({ storageBucket: bucket });
    }
  }

  const storage = admin.storage().bucket();
  const fileName = "system-config/settings.json";
  const file = storage.file(fileName);

  const defaults = {
    enableLogs: true,
    showThermalMarkings: true,
    enableAdminMode: true,
    adminPassword: "123456",
    maxComparativeScans: 20
  };

  const [exists] = await file.exists();
  let settings = defaults;

  if (exists) {
    const [buffer] = await file.download();
    settings = JSON.parse(buffer.toString("utf8"));
    settings.adminPassword = "123456";
    console.log("Existing settings found — updating adminPassword.");
  } else {
    console.log("No settings file found — creating with defaults.");
  }

  await file.save(Buffer.from(JSON.stringify(settings, null, 2)), {
    contentType: "application/json",
    resumable: false,
    metadata: { cacheControl: "private, max-age=0, no-transform" }
  });

  console.log("Done. Admin password is now '123456'.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
