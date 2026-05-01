"use strict";

function errorHandler(error, _req, res, _next) {
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    error: statusCode >= 500 ? "Server error." : error.message
  });
}

module.exports = {
  errorHandler
};
