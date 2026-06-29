// server.js
// Application entrypoint. Starts the Express REST server and the WhatsApp client,
// and wires up graceful shutdown + global crash protection.

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const whatsappService = require('./services/whatsappService');

let httpServer;

async function start() {
  logger.info('Starting WhatsApp AI Bot...');
  logger.info(`Environment: ${config.env}`);
  logger.info(`AI Provider: ${config.ai.provider}`);

  httpServer = app.listen(config.port, () => {
    logger.info(`HTTP server listening on port ${config.port}`);
  });

  try {
    await whatsappService.initializeWhatsApp();
  } catch (err) {
    logger.error(`Failed to initialize WhatsApp client: ${err.message}`);
    logger.info('HTTP server will keep running; WhatsApp will retry via reconnect logic.');
  }
}

function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  if (httpServer) {
    httpServer.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Never crash the whole process on unexpected errors.
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

start();
