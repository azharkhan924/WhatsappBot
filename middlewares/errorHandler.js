// middlewares/errorHandler.js
// Centralized error handler. Ensures the process never crashes due to an unhandled route error.

const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(`Unhandled route error: ${err.stack || err.message}`);

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.statusCode || 500).json({
    success: false,
    error: err.publicMessage || 'Internal server error',
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: 'Route not found' });
}

module.exports = { errorHandler, notFoundHandler };
