"use strict";

const { initializeApp } = require("firebase-admin/app");
const { onRequest } = require("firebase-functions/v2/https");
const app = require("./src/app");

initializeApp();

exports.api = onRequest(
  {
    region: "asia-southeast2",
    invoker: "public",
    timeoutSeconds: 60,
    memory: "512MiB"
  },
  app
);
