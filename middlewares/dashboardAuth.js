// middlewares/dashboardAuth.js
// Authenticates requests from the Control Room dashboard using the `x-dashboard-key` header.
// If DASHBOARD_KEY (or API_KEY) is not set in environment, auth is skipped in dev but logged once.

const config = require('../config');
const logger = require('../utils/logger');

let warned = false;

function dashboardAuth(req, res, next) {
  const expectedKey = config.security.dashboardKey;
  if (!expectedKey) {
    if (!warned) {
      logger.warn('DASHBOARD_KEY / API_KEY is not set in .env — Dashboard endpoints are UNPROTECTED.');
      warned = true;
    }
    return next();
  }

  const providedKey = req.header('x-dashboard-key');
  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized: invalid or missing dashboard key' });
  }

  next();
}

module.exports = dashboardAuth;
