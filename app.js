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

// Security headers
app.use(helmet());

// CORS
app.use(cors());

// Gzip compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging
app.use(requestLogger);

// Rate limiting on all API routes
app.use(rateLimiter);

// API routes (registered before static assets so GET / returns JSON, not the HTML status page)
app.use('/', routes);

// Serve static public assets (e.g. a simple status page) under /static
app.use('/static', express.static('public'));

// 404 + centralized error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
