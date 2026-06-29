// services/whatsappService.js
// Manages the whatsapp-web.js client: login, persistent session, reconnect logic,
// and the full incoming-message pipeline (validation -> memory -> AI -> human-like reply).

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QR = require('qrcode');
const path = require('path');

const config = require('../config');
const logger = require('../utils/logger');
const conversationMemory = require('../memory/conversationMemory');
const aiService = require('./aiService');
const botConfigService = require('./botConfigService');
const { handleCommand, isCommand } = require('./commandService');

const SESSION_PATH = path.join(__dirname, '..', 'session');

// Dedupe set for incoming message IDs (guards against duplicate events from whatsapp-web.js).
const processedMessageIds = new Set();
const MAX_DEDUPE_SIZE = 1000;

// Dedupe set for outgoing message IDs sent by the bot (guards against identifying bot replies as human interventions).
const botSentMessageIds = new Set();
const MAX_BOT_DEDUPE_SIZE = 1000;

function rememberBotMessageId(id) {
  if (!id) return;
  botSentMessageIds.add(id);
  if (botSentMessageIds.size > MAX_BOT_DEDUPE_SIZE) {
    const first = botSentMessageIds.values().next().value;
    botSentMessageIds.delete(first);
  }
}

const stats = {
  startedAt: Date.now(),
  messagesReceived: 0,
  messagesReplied: 0,
  aiFailures: 0,
  reconnects: 0,
};

let client = null;
let isReady = false;
let lastQr = null;
let lastQrDataUrl = null;
let isReconnecting = false;
let healthCheckInterval = null;

let ioInstance = null;

function setSocketIO(io) {
  ioInstance = io;
}

function broadcastState() {
  if (!ioInstance) return;
  const status = getDashboardStatus();
  ioInstance.emit('state', status);
}

function getDashboardStatus() {
  if (isReady && client && client.info) {
    const rawNum = client.info.wid ? client.info.wid.user : null;
    return {
      status: 'connected',
      connectedNumber: rawNum,
    };
  }
  if (lastQrDataUrl && !isReady) {
    return {
      status: 'qr',
      qrDataUrl: lastQrDataUrl,
    };
  }
  if (isReconnecting) {
    return {
      status: 'initializing',
    };
  }
  return {
    status: isReady ? 'connected' : 'disconnected',
  };
}

// ── Heartbeat / Health-check ────────────────────────────────────────
// After the Mac wakes from sleep the Puppeteer browser that
// whatsapp-web.js relies on is usually dead or frozen.  A periodic
// heartbeat detects this and automatically recreates the client so
// you don't have to restart the bot manually.
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
const HEALTH_FAIL_THRESHOLD = 2; // require 2 consecutive failures before reconnect
let consecutiveHealthFailures = 0;

function startHealthCheck() {
  stopHealthCheck(); // clear any previous interval
  consecutiveHealthFailures = 0;
  healthCheckInterval = setInterval(async () => {
    if (!client || !isReady || isReconnecting) return;
    try {
      const state = await Promise.race([
        client.getState(),
        // If getState() hangs (common after sleep), time it out.
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health-check timed out')), 10_000)
        ),
      ]);
      if (state === null || state === undefined) {
        consecutiveHealthFailures += 1;
        logger.warn(`Health-check: client state is ${state} (fail ${consecutiveHealthFailures}/${HEALTH_FAIL_THRESHOLD})`);
      } else {
        consecutiveHealthFailures = 0; // reset on success
        logger.debug?.(`Health-check OK – state: ${state}`) ||
          void 0;
      }
    } catch (err) {
      consecutiveHealthFailures += 1;
      logger.warn(`Health-check failed (${consecutiveHealthFailures}/${HEALTH_FAIL_THRESHOLD}): ${err.message}`);
    }

    if (consecutiveHealthFailures >= HEALTH_FAIL_THRESHOLD) {
      consecutiveHealthFailures = 0;
      await destroyAndRecreateClient('Health-check: consecutive failures exceeded threshold');
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

function rememberMessageId(id) {
  processedMessageIds.add(id);
  if (processedMessageIds.size > MAX_DEDUPE_SIZE) {
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }
}

function randomDelay() {
  const { typingDelayMinMs, typingDelayMaxMs } = config.humanBehaviour;
  return Math.floor(Math.random() * (typingDelayMaxMs - typingDelayMinMs + 1)) + typingDelayMinMs;
}

function computeHumanDelay(replyLength = 0, incomingLength = 0) {
  const { typingDelayMinMs, typingDelayMaxMs } = config.humanBehaviour;
  const safeReplyLen = Math.max(0, Number(replyLength) || 0);
  const safeIncomingLen = Math.max(0, Number(incomingLength) || 0);

  // Base random jitter between min and max
  const jitterRange = Math.max(1000, typingDelayMaxMs - typingDelayMinMs);
  const baseJitter = typingDelayMinMs + Math.floor(Math.random() * Math.min(jitterRange, 2000));

  // Length scaling: ~25ms per character of reply, plus ~10ms per character of incoming message
  const lengthBonus = Math.floor(safeReplyLen * 25 + safeIncomingLen * 10);

  // Cap the length bonus at 12000ms (12 seconds) so replies don't take unreasonably long
  const cappedBonus = Math.min(lengthBonus, 12000);

  return baseJitter + cappedBonus;
}

async function hasHumanReplied(chat, message) {
  try {
    const recentMessages = await chat.fetchMessages({ limit: 15 });
    const targetTimestamp = message.timestamp;

    for (const m of recentMessages) {
      if (m.id && message.id && m.id._serialized !== message.id._serialized && m.timestamp >= targetTimestamp) {
        if (m.fromMe && !botSentMessageIds.has(m.id._serialized)) {
          return true;
        }
      }
    }
  } catch (err) {
    logger.warn(`Error checking if human replied: ${err.message}`);
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { execSync } = require('child_process');

const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempt = 0;

async function destroyAndRecreateClient(reason) {
  if (isReconnecting) {
    logger.info(`Reconnection already in progress. Ignoring request: ${reason}`);
    return;
  }
  isReconnecting = true;
  isReady = false;
  stopHealthCheck();
  logger.warn(`Initiating client recreation. Reason: ${reason}`);
  stats.reconnects += 1;

  // ── 1. Try graceful destroy ──
  try {
    if (client) {
      logger.info('Destroying existing client...');
      // Try to kill the underlying Puppeteer browser directly first
      try {
        const browser = client.pupBrowser;
        if (browser && browser.process()) {
          logger.info('Force-killing Puppeteer browser process...');
          browser.process().kill('SIGKILL');
        }
      } catch (killErr) {
        logger.warn(`Could not kill browser process directly: ${killErr.message}`);
      }
      await Promise.race([
        client.destroy(),
        sleep(5000), // Don't let destroy() hang forever
      ]);
    }
  } catch (err) {
    logger.error(`Error destroying client: ${err.message}`);
  }

  // ── 2. Force-kill any leftover Chromium using the session dir ──
  try {
    // Find and kill any chrome/chromium processes that reference our session
    execSync(
      `pkill -f "${SESSION_PATH}" 2>/dev/null || true`,
      { timeout: 5000 }
    );
    logger.info('Killed any leftover browser processes tied to session.');
  } catch (_) {
    // pkill may fail if no processes found — that's fine
  }

  // ── 3. Also remove the SingletonLock file that Chromium leaves behind ──
  try {
    const fs = require('fs');
    const lockFiles = [
      path.join(SESSION_PATH, 'session-whatsapp-bot-session', 'SingletonLock'),
      path.join(SESSION_PATH, 'session-whatsapp-bot-session', 'SingletonCookie'),
      path.join(SESSION_PATH, 'session-whatsapp-bot-session', 'SingletonSocket'),
    ];
    for (const lockFile of lockFiles) {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        logger.info(`Removed lock file: ${lockFile}`);
      }
    }
  } catch (err) {
    logger.warn(`Error removing lock files: ${err.message}`);
  }

  client = null;
  reconnectAttempt += 1;

  if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
    logger.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up. Restart the bot manually.`);
    isReconnecting = false;
    reconnectAttempt = 0;
    return;
  }

  const delay = Math.min(5000 * reconnectAttempt, 30000); // exponential-ish backoff, max 30s
  logger.info(`Will attempt reconnect #${reconnectAttempt} in ${delay / 1000}s...`);

  setTimeout(() => {
    initializeWhatsApp()
      .then(() => {
        isReconnecting = false;
        reconnectAttempt = 0; // reset on success
        logger.info('Client successfully recreated.');
      })
      .catch((err) => {
        logger.error(`Recreation attempt #${reconnectAttempt} failed: ${err.message}`);
        isReconnecting = false;
        // Retry with backoff
        setTimeout(() => destroyAndRecreateClient('Retry recreation after failure'), 3000);
      });
  }, delay);
}

function createClient() {
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: config.whatsapp.clientId,
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: true,
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : require('fs').existsSync('/usr/bin/chromium')
        ? { executablePath: '/usr/bin/chromium' }
        : require('fs').existsSync('/usr/bin/chromium-browser')
        ? { executablePath: '/usr/bin/chromium-browser' }
        : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--single-process',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
      ],
    },
  });

  registerEventHandlers();
  return client;
}

function registerEventHandlers() {
  client.on('qr', async (qr) => {
    lastQr = qr;
    logger.info('QR Generated. Scan it with WhatsApp (Linked Devices > Link a device).');
    qrcode.generate(qr, { small: true });
    try {
      lastQrDataUrl = await QR.toDataURL(qr);
    } catch (err) {
      logger.error(`Failed to generate QR data URL: ${err.message}`);
    }
    broadcastState();
  });

  client.on('authenticated', () => {
    logger.info('Authenticated successfully.');
    broadcastState();
  });

  client.on('ready', () => {
    isReady = true;
    lastQr = null;
    lastQrDataUrl = null;
    logger.info('WhatsApp client is Ready.');
    startHealthCheck();
    broadcastState();
  });

  client.on('disconnected', async (reason) => {
    logger.info(`Disconnected event: ${reason}`);
    isReady = false;
    lastQrDataUrl = null;
    broadcastState();
    stopHealthCheck();
    await destroyAndRecreateClient(`Disconnected: ${reason}`);
  });

  client.on('change_state', async (state) => {
    logger.info(`Connection state changed: ${state}`);
    broadcastState();
    // CONFLICT = phone connected elsewhere; UNLAUNCHED = browser died
    if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
      logger.warn(`Unhealthy state detected: ${state}. Triggering reconnect.`);
      await destroyAndRecreateClient(`change_state: ${state}`);
    }
  });

  client.on('message', async (message) => {
    try {
      await handleIncomingMessage(message);
    } catch (err) {
      logger.error(`Unhandled error while processing message: ${err.stack || err.message}`);
      // Never crash the process on a per-message error.
    }
  });
}

async function handleIncomingMessage(message) {
  stats.messagesReceived += 1;

  // Ignore messages sent by the bot itself.
  if (message.fromMe) return;

  // Ignore status updates (stories).
  if (message.isStatus) return;

  // Ignore broadcast messages and newsletters.
  if (message.broadcast || message.from === 'status@broadcast' || message.from.includes('@newsletter')) return;

  // Optionally ignore group messages.
  const chat = await message.getChat();
  if (config.whatsapp.ignoreGroups && chat.isGroup) return;

  // Ignore duplicate events (whatsapp-web.js can occasionally emit the same message twice).
  if (message.id && message.id._serialized) {
    if (processedMessageIds.has(message.id._serialized)) return;
    rememberMessageId(message.id._serialized);
  }

  const userId = message.from;
  const text = (message.body || '').trim();

  if (!text) return; // ignore non-text (media-only) messages for now

  // Fetch actual contact details for precise phone number matching
  let contactDigits = userId.replace(/[^0-9]/g, '');
  try {
    const contact = await message.getContact();
    if (contact && (contact.number || (contact.id && contact.id.user))) {
      contactDigits = (contact.number || contact.id.user).replace(/[^0-9]/g, '');
    }
  } catch (_) {}

  // Check dashboard bot config (botEnabled & whitelistEnabled)
  const botCfg = botConfigService.getConfig();
  if (!botCfg.botEnabled) {
    logger.info(`Bot is disabled in control room. Skipping reply to ${userId}`);
    return;
  }

  if (botCfg.whitelistEnabled) {
    const whitelist = Array.isArray(botCfg.whitelist) ? botCfg.whitelist : [];
    if (whitelist.length === 0) {
      logger.info(`Whitelist mode active but whitelist is empty. Skipping bot reply to ${userId}`);
      return;
    }

    const isWhitelisted = whitelist.some((num) => {
      const cleanNum = String(num).replace(/[^0-9]/g, '');
      if (!cleanNum) return false;
      if (contactDigits === cleanNum || userId.replace(/[^0-9]/g, '') === cleanNum) return true;
      if (contactDigits.length >= 10 && cleanNum.length >= 10) {
        if (contactDigits.slice(-10) === cleanNum.slice(-10)) return true;
      }
      return contactDigits.endsWith(cleanNum) || cleanNum.endsWith(contactDigits);
    });

    if (!isWhitelisted) {
      logger.info(`Sender ${userId} (contact: ${contactDigits}) is not on the whitelist. Skipping bot reply.`);
      return;
    }
  }

  logger.info(`Incoming message from ${userId}: ${text}`);

  // Slash commands bypass the AI pipeline entirely.
  if (isCommand(text)) {
    const reply = handleCommand(text, { userId, stats, isReady });
    await sendHumanLikeReply(chat, message, reply);
    return;
  }

  // Conversation memory: fetch history, then append the user's message.
  const history = conversationMemory.getHistory(userId);
  conversationMemory.addMessage(userId, 'user', text);

  if (await hasHumanReplied(chat, message)) {
    logger.info(`Human already replied to ${userId} before AI generation. Skipping bot reply.`);
    return;
  }

  // AI generation (handles its own retries/timeout/fallback internally).
  const { reply, failed } = await aiService.generateReply(userId, text, history);
  if (failed) stats.aiFailures += 1;

  const sent = await sendHumanLikeReply(chat, message, reply);
  if (sent) {
    conversationMemory.addMessage(userId, 'assistant', reply);
  }
}

async function sendHumanLikeReply(chat, message, replyText) {
  try {
    if (await hasHumanReplied(chat, message)) {
      logger.info(`Human already replied in chat ${message.from}. Cancelling bot reply.`);
      return false;
    }

    if (typeof chat.sendStateTyping === 'function') {
      await chat.sendStateTyping();
    }
    const incomingText = (message.body || '').trim();
    const delay = computeHumanDelay(replyText.length, incomingText.length);
    await sleep(delay);

    if (await hasHumanReplied(chat, message)) {
      logger.info(`Human replied during typing delay in chat ${message.from}. Cancelling bot reply.`);
      if (typeof chat.clearState === 'function') {
        await chat.clearState();
      }
      return false;
    }

    const sentMsg = await message.reply(replyText);
    if (sentMsg && sentMsg.id && sentMsg.id._serialized) {
      rememberBotMessageId(sentMsg.id._serialized);
    }
    stats.messagesReplied += 1;
    logger.info(`Replied to ${message.from} after ${Math.round(delay)}ms delay`);
    return true;
  } catch (err) {
    logger.error(`Failed to send reply to ${message.from}: ${err.message}`);
    if (
      err.message.includes('detached Frame') ||
      err.message.includes('Execution context was destroyed') ||
      err.message.includes('Session closed')
    ) {
      await destroyAndRecreateClient(err.message);
    }
    return false;
  }
}

async function initializeWhatsApp() {
  if (!client) {
    createClient();
  }
  logger.info('Initializing WhatsApp client...');
  await client.initialize();
}

async function sendMessage(to, text) {
  if (!client || !isReady) {
    throw new Error('WhatsApp client is not ready yet.');
  }
  const chatId = to.includes('@c.us') || to.includes('@g.us') ? to : `${to}@c.us`;
  const sentMsg = await client.sendMessage(chatId, text);
  if (sentMsg && sentMsg.id && sentMsg.id._serialized) {
    rememberBotMessageId(sentMsg.id._serialized);
  }
  return sentMsg;
}

function getStatus() {
  return {
    ready: isReady,
    hasQr: Boolean(lastQr),
    uptimeSeconds: Math.floor((Date.now() - stats.startedAt) / 1000),
  };
}

function getStats() {
  return {
    ...stats,
    ...getStatus(),
    memory: conversationMemory.getStats(),
  };
}

async function reconnect() {
  logger.info('Reconnect requested from Control Room.');
  await destroyAndRecreateClient('Requested via dashboard reconnect endpoint');
}

module.exports = {
  initializeWhatsApp,
  sendMessage,
  getStatus,
  getStats,
  setSocketIO,
  getDashboardStatus,
  reconnect,
};
