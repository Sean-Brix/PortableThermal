"use strict";

const express = require("express");
const routes = require("./routes");
const { notFoundHandler } = require("./middleware/notFoundHandler");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "15mb" }));

app.use("/api", routes);
app.use("/", routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
