// server.js
// Application entrypoint. Starts the Express REST server with Socket.IO support and the WhatsApp client,
// and wires up graceful shutdown + global crash protection.

const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const whatsappService = require('./services/whatsappService');
const schedulerService = require('./services/schedulerService');

let httpServer;
let gcInterval;

async function start() {
  logger.info('Starting WhatsApp AI Bot...');
  logger.info(`Environment: ${config.env}`);
  logger.info(`AI Provider: ${config.ai.provider}`);

  httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.use((socket, next) => {
    const expectedKey = config.security.dashboardKey;
    if (!expectedKey) return next();
    const key = socket.handshake.auth?.dashboardKey;
    if (key === expectedKey) return next();
    return next(new Error('Unauthorized socket connection'));
  });

  io.on('connection', (socket) => {
    logger.info('WhatsApp AI Assistant dashboard connected via WebSocket.');
    socket.emit('state', whatsappService.getDashboardStatus());
  });

  whatsappService.setSocketIO(io);

  httpServer.listen(config.port, '0.0.0.0', () => {
    logger.info(`HTTP & WebSocket server listening on port ${config.port} (0.0.0.0)`);
    logger.info(`WhatsApp AI Assistant Dashboard available at http://localhost:${config.port}/dashboard`);
  });

  if (Number(config.port) !== 3000) {
    try {
      const fallbackServer = http.createServer(app);
      fallbackServer.listen(3000, '0.0.0.0', () => {
        logger.info(`Fallback server listening on port 3000 (0.0.0.0)`);
      });
    } catch (e) {
      logger.warn(`Could not start fallback listener on 3000: ${e.message}`);
    }
  }

  // Set up periodic garbage collection (every 10 minutes) if --expose-gc is enabled
  const GC_INTERVAL_MS = 10 * 60 * 1000;
  gcInterval = setInterval(() => {
    if (global.gc) {
      try {
        const memoryBefore = process.memoryUsage().heapUsed;
        global.gc();
        const memoryAfter = process.memoryUsage().heapUsed;
        const freed = memoryBefore - memoryAfter;
        logger.info(`[GC] Manual Garbage Collection run: Heap memory before: ${(memoryBefore / 1024 / 1024).toFixed(2)} MB, after: ${(memoryAfter / 1024 / 1024).toFixed(2)} MB. Freed ${(freed / 1024 / 1024).toFixed(2)} MB.`);
      } catch (err) {
        logger.error(`[GC] Failed to run manual GC: ${err.message}`);
      }
    } else {
      logger.warn('[GC] Manual Garbage Collection is not exposed. Run node with --expose-gc.');
    }
  }, GC_INTERVAL_MS);

  // Initialize WhatsApp in background so HTTP/WebSocket endpoints respond instantly
  whatsappService.initializeWhatsApp()
    .then(() => {
      // Start the scheduler once WhatsApp is connected
      schedulerService.startScheduler(whatsappService);
    })
    .catch((err) => {
      logger.error(`Failed to initialize WhatsApp client: ${err.message}`);
      logger.info('Initiating reconnection loop...');
      whatsappService.reconnect().catch((recErr) => {
        logger.error(`Failed to initiate reconnection loop: ${recErr.message}`);
      });
    });
}

function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  schedulerService.stopScheduler();
  if (gcInterval) {
    clearInterval(gcInterval);
  }
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
