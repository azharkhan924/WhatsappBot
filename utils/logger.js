// utils/logger.js
// Winston-based logger writing to logs/info.log, logs/error.log, logs/combined.log and console.

const path = require('path');
const winston = require('winston');
const config = require('../config');

const logsDir = path.join(__dirname, '..', 'logs');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${stack || message}`;
  })
);

const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'info.log'),
      level: 'info',
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
    }),
  ],
});

// Always log to console too (useful for QR codes, Docker logs, Railway/Koyeb logs).
logger.add(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat
    ),
  })
);

module.exports = logger;
