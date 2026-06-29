// app.js
// Express application setup: security, parsing, logging, routes, error handling.

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const routes = require('./routes');
const requestLogger = require('./middlewares/requestLogger');
const rateLimiter = require('./middlewares/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

const app = express();

// Trust reverse proxies (required for express-rate-limit to work on Railway)
app.set('trust proxy', 1);

// Security headers (disable CSP so CDN scripts & fonts load smoothly in dashboard)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS (allow all origins & credentials for cross-domain dashboard connections)
app.use(cors({ origin: true, credentials: true }));

// Gzip compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging
app.use(requestLogger);

// Rate limiting on all API routes
app.use(rateLimiter);

// API routes (registered before static assets so GET / returns JSON)
app.use('/', routes);

// Serve static public control room dashboard under /dashboard and /static
app.use('/dashboard', express.static('public'));
app.use('/static', express.static('public'));

// 404 + centralized error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
