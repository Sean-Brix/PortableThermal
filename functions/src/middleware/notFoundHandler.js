"use strict";

function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

module.exports = {
  notFoundHandler
};
