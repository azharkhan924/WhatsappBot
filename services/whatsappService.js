// services/whatsappService.js
// Manages the whatsapp-web.js client: login, persistent session, reconnect logic,
// and the full incoming-message pipeline (validation -> memory -> AI -> human-like reply).

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

const config = require('../config');
const logger = require('../utils/logger');
const conversationMemory = require('../memory/conversationMemory');
const aiService = require('./aiService');
const { handleCommand, isCommand } = require('./commandService');

const SESSION_PATH = path.join(__dirname, '..', 'session');

// Dedupe set for incoming message IDs (guards against duplicate events from whatsapp-web.js).
const processedMessageIds = new Set();
const MAX_DEDUPE_SIZE = 1000;

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

function computeHumanDelay(messageLength) {
  // Base random delay, scaled slightly by message length, clamped to configured bounds.
  const { typingDelayMinMs, typingDelayMaxMs } = config.humanBehaviour;
  const base = randomDelay();
  const lengthBonus = Math.min(messageLength * 20, 1500);
  return Math.min(typingDelayMaxMs, Math.max(typingDelayMinMs, base + lengthBonus / 3));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient() {
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: config.whatsapp.clientId,
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
  });

  registerEventHandlers();
  return client;
}

function registerEventHandlers() {
  client.on('qr', (qr) => {
    lastQr = qr;
    logger.info('QR Generated. Scan it with WhatsApp (Linked Devices > Link a device).');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    logger.info('Authenticated successfully.');
  });

  client.on('ready', () => {
    isReady = true;
    lastQr = null;
    logger.info('WhatsApp client is Ready.');
  });

  client.on('disconnected', (reason) => {
    isReady = false;
    logger.info(`Disconnected: ${reason}. Attempting auto-reconnect...`);
    stats.reconnects += 1;
    setTimeout(() => {
      initializeWhatsApp().catch((err) =>
        logger.error(`Reconnect attempt failed: ${err.message}`)
      );
    }, 5000);
  });

  client.on('change_state', (state) => {
    logger.info(`Connection state changed: ${state}`);
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

  // AI generation (handles its own retries/timeout/fallback internally).
  const { reply, failed } = await aiService.generateReply(userId, text, history);
  if (failed) stats.aiFailures += 1;

  conversationMemory.addMessage(userId, 'assistant', reply);

  await sendHumanLikeReply(chat, message, reply);
}

async function sendHumanLikeReply(chat, message, replyText) {
  try {
    if (typeof chat.sendStateTyping === 'function') {
      await chat.sendStateTyping();
    }
    const delay = computeHumanDelay(replyText.length);
    await sleep(delay);
    await message.reply(replyText);
    stats.messagesReplied += 1;
    logger.info(`Replied to ${message.from} after ${Math.round(delay)}ms delay`);
  } catch (err) {
    logger.error(`Failed to send reply to ${message.from}: ${err.message}`);
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
  return client.sendMessage(chatId, text);
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

module.exports = {
  initializeWhatsApp,
  sendMessage,
  getStatus,
  getStats,
};
