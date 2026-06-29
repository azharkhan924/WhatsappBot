// middlewares/apiKeyAuth.js
// Protects sensitive REST endpoints (/send, /chat, /reset) with a shared API key,
// supplied via the `x-api-key` header. If API_KEY is not set in .env, auth is skipped
// (useful for local development) but a warning is logged once.

const config = require('../config');
const logger = require('../utils/logger');

let warned = false;

function apiKeyAuth(req, res, next) {
  if (!config.security.apiKey) {
    if (!warned) {
      logger.error('API_KEY is not set in .env — REST endpoints are UNPROTECTED. Set API_KEY for production.');
      warned = true;
    }
    return next();
  }

  const providedKey = req.header('x-api-key');
  if (!providedKey || providedKey !== config.security.apiKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized: invalid or missing API key' });
  }

  next();
}

module.exports = apiKeyAuth;
