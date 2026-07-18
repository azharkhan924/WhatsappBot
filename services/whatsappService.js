// services/whatsappService.js
// Manages the whatsapp-web.js client: login, persistent session, reconnect logic,
// and the full incoming-message pipeline (validation -> memory -> AI -> human-like reply).

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QR = require('qrcode');
const path = require('path');

const config = require('../config');
const logger = require('../utils/logger');
const conversationMemory = require('../memory/conversationMemory');
const aiService = require('./aiService');
const botConfigService = require('./botConfigService');
const muteService = require('./muteService');
const { handleCommand, isCommand } = require('./commandService');

const SESSION_PATH = path.join(config.dataDir, 'session');

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

function formatJid(jidOrNumber) {
  if (!jidOrNumber) return '';
  const str = String(jidOrNumber).trim();
  if (
    str.includes('@c.us') ||
    str.includes('@g.us') ||
    str.includes('@newsletter') ||
    str.includes('@lid') ||
    str.includes('@s.whatsapp.net')
  ) {
    return str;
  }
  return `${str}@c.us`;
}

// ── LID Abstraction Helpers ─────────────────────────────────────────
// Centralized identifier checks. Update these if WhatsApp adds new formats.

function getChatJid(chat) {
  if (!chat) return '';
  if (typeof chat === 'string') return chat;
  if (typeof chat.id === 'string') return chat;
  if (chat.id && typeof chat.id._serialized === 'string') return chat.id._serialized;
  if (chat.id && typeof chat.id.user === 'string' && typeof chat.id.server === 'string') {
    return `${chat.id.user}@${chat.id.server}`;
  }
  return '';
}

function isLidJid(jid) {
  return typeof jid === 'string' && jid.includes('@lid');
}

function isDirectChat(chat) {
  const jid = getChatJid(chat);
  return jid.endsWith('@c.us') || jid.endsWith('@lid') || jid.endsWith('@s.whatsapp.net');
}

function isGroupChat(chat) {
  if (chat && chat.isGroup) return true;
  const jid = getChatJid(chat);
  return jid.endsWith('@g.us');
}

function isChannel(chat) {
  if (chat && chat.isChannel) return true;
  const jid = getChatJid(chat);
  return jid.endsWith('@newsletter');
}

// ── Enhanced Puppeteer Crash Detection ──────────────────────────────
// Inspects error.message, error.name, error.code, and stack traces
// so new Chromium versions don't silently bypass detection.

function isPuppeteerCrash(err) {
  if (!err) return false;
  let msg = err.message || '';
  if (typeof err === 'string') msg = err;
  
  // Clean null bytes, invisible characters, and whitespace for accurate length checking
  const cleanMsg = msg.replace(/[\x00-\x20\u200B-\u200D\uFEFF]/g, '');

  const name = err.name || '';
  const stack = err.stack || '';
  const code = err.code || '';

  const isCrash = (
    msg.includes('detached Frame') ||
    msg.includes('Target closed') ||
    msg.includes('Execution context was destroyed') ||
    msg.includes('Session closed') ||
    msg.includes('Protocol error') ||
    msg.includes('Connection closed') ||
    msg.includes('WebSocket is not open') ||
    (cleanMsg.length > 0 && cleanMsg.length <= 3) || // minified Puppeteer errors like "r" or "t"
    name === 'ProtocolError' ||
    name === 'TargetCloseError' ||
    code === 'ERR_CONNECTION_CLOSED' ||
    stack.includes('ExecutionContext.js') ||
    stack.includes('CDPSession')
  );

  if (isCrash && typeof stats !== 'undefined' && stats) {
    stats.puppeteerCrashes += 1;
  }
  return isCrash;
}

// ── LID-to-Phone Cache with TTL ────────────────────────────────────
// Entries store { phone, updatedAt } and expire after 24 hours.
// Persisted to data/lidCache.json so restarts don't lose mappings.

const lidCache = new Map();
const LID_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LID_CACHE_FILE = path.join(config.dataDir, 'lidCache.json');
let lidCacheSaveTimer = null;

function lidCacheGet(lid) {
  const entry = lidCache.get(lid);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > LID_CACHE_TTL_MS) {
    lidCache.delete(lid);
    return null;
  }
  stats.lidCacheHits += 1;
  return entry.phone;
}

function lidCacheSet(lid, phone) {
  lidCache.set(lid, { phone, updatedAt: Date.now() });
  scheduleLidCacheSave();
}

function loadLidCache() {
  try {
    const fs = require('fs');
    if (fs.existsSync(LID_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(LID_CACHE_FILE, 'utf-8'));
      const now = Date.now();
      let loaded = 0;
      for (const [lid, entry] of Object.entries(data)) {
        if (entry && entry.phone && (now - entry.updatedAt) < LID_CACHE_TTL_MS) {
          lidCache.set(lid, entry);
          loaded++;
        }
      }
      if (loaded > 0) {
        logger.info(`Loaded ${loaded} LID→phone mappings from disk cache.`);
      }
    }
  } catch (err) {
    logger.warn(`Failed to load LID cache from disk: ${err.message}`);
  }
}

function saveLidCacheToDisk() {
  try {
    const fs = require('fs');
    const obj = {};
    for (const [lid, entry] of lidCache) {
      obj[lid] = entry;
    }
    const dir = path.dirname(LID_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LID_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`Failed to save LID cache to disk: ${err.message}`);
  }
}

// Debounce disk writes to at most once per 30s
function scheduleLidCacheSave() {
  if (lidCacheSaveTimer) return;
  lidCacheSaveTimer = setTimeout(() => {
    lidCacheSaveTimer = null;
    saveLidCacheToDisk();
  }, 30_000);
}

// ── Automatic LID Cache Cleanup (every 6 hours) ────────────────────
const LID_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lidCleanupInterval = null;

function startLidCacheCleanup() {
  stopLidCacheCleanup();
  lidCleanupInterval = setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [lid, entry] of lidCache) {
      if (now - entry.updatedAt > LID_CACHE_TTL_MS) {
        lidCache.delete(lid);
        removed++;
      }
    }
    if (removed > 0) {
      saveLidCacheToDisk();
      logger.info(`LID cache cleanup: removed ${removed} expired entries. ${lidCache.size} remaining.`);
    }
  }, LID_CLEANUP_INTERVAL_MS);
}

function stopLidCacheCleanup() {
  if (lidCleanupInterval) {
    clearInterval(lidCleanupInterval);
    lidCleanupInterval = null;
  }
}

// ── Metrics ─────────────────────────────────────────────────────────
const stats = {
  startedAt: Date.now(),
  messagesReceived: 0,
  messagesReplied: 0,
  aiFailures: 0,
  reconnects: 0,
  puppeteerCrashes: 0,
  lidResolutions: 0,
  lidCacheHits: 0,
  failedSends: 0,
  queuedMessages: 0,
  reconnectDurationMs: 0,
  lastReconnectAt: null,
};

// ── Outgoing Message Queue ──────────────────────────────────────────
// Buffers sends when client is reconnecting; drains on 'ready'.
const outgoingQueue = [];
const MAX_QUEUE_SIZE = 50;

// ── Incoming Message Queue ──────────────────────────────────────────
// Buffers messages received during reconnect; drains on 'ready'.
const incomingQueue = [];

let client = null;
let isReady = false;
let lastQr = null;
let lastQrDataUrl = null;
let reconnectPromise = null; // replaces isReconnecting boolean
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

function logToDashboard(message, type = 'info') {
  if (!ioInstance) return;
  ioInstance.emit('dashboard_log', {
    timestamp: new Date().toISOString(),
    message,
    type
  });
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
  if (reconnectPromise) {
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
const HEALTH_CHECK_INTERVAL_MS = 60_000; // 60 seconds
const HEALTH_FAIL_THRESHOLD = 3; // require 3 consecutive failures before reconnect
let consecutiveHealthFailures = 0;
let healthCheckCount = 0;

function startHealthCheck() {
  stopHealthCheck(); // clear any previous interval
  consecutiveHealthFailures = 0;
  healthCheckCount = 0;
  healthCheckInterval = setInterval(async () => {
    if (!client || !isReady || reconnectPromise) return;
    try {
      const state = await Promise.race([
        client.getState(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health-check timed out')), 8_000)
        ),
      ]);
      if (state === null || state === undefined) {
        consecutiveHealthFailures += 1;
        logger.warn(`Health-check: client state is ${state} (fail ${consecutiveHealthFailures}/${HEALTH_FAIL_THRESHOLD})`);
      } else {
        // Also probe client.info to catch zombie browser that responds to getState but can't send
        const infoOk = !!(client.info && client.info.wid);
        if (!infoOk) {
          consecutiveHealthFailures += 1;
          logger.warn(`Health-check: getState OK but client.info missing (fail ${consecutiveHealthFailures}/${HEALTH_FAIL_THRESHOLD})`);
        } else {
          consecutiveHealthFailures = 0;
          healthCheckCount += 1;
          // Log at info level every 5 minutes (10 checks at 30s interval) for Railway visibility
          if (healthCheckCount % 10 === 0) {
            logger.info(`Health-check OK – state: ${state}, uptime: ${Math.floor((Date.now() - stats.startedAt) / 1000)}s`);
          }
        }
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

  // Length scaling: ~10ms per character of reply, plus ~5ms per character of incoming message
  const lengthBonus = Math.floor(safeReplyLen * 10 + safeIncomingLen * 5);

  // Cap the length bonus at 4000ms so replies stay fast
  const cappedBonus = Math.min(lengthBonus, 4000);

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
    if (isPuppeteerCrash(err)) {
      logger.warn('Puppeteer crashed during hasHumanReplied(). Chat may be stale.');
    }
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
  // Reconnect deduplication: if already reconnecting, coalesce onto the existing promise
  if (reconnectPromise) {
    logger.info(`Reconnection already in progress. Ignoring request: ${reason}`);
    return reconnectPromise;
  }
  reconnectPromise = _doReconnect(reason);
  try {
    await reconnectPromise;
  } finally {
    reconnectPromise = null;
  }
}

async function _doReconnect(reason) {
  const reconnectStart = Date.now();
  isReady = false;
  stopHealthCheck();
  logger.warn(`Initiating client recreation. Reason: ${reason}`);
  stats.reconnects += 1;
  stats.lastReconnectAt = new Date().toISOString();
  broadcastState();

  // ── 1. Try graceful destroy ──
  try {
    if (client) {
      logger.info('Removing all listeners from existing client...');
      try {
        client.removeAllListeners();
      } catch (err) {
        logger.warn(`Could not remove listeners: ${err.message}`);
      }
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
    reconnectAttempt = 0;
    return;
  }

  const delay = Math.min(5000 * reconnectAttempt, 30000); // exponential-ish backoff, max 30s
  logger.info(`Will attempt reconnect #${reconnectAttempt} in ${delay / 1000}s...`);

  await sleep(delay);

  try {
    await initializeWhatsApp();
    reconnectAttempt = 0;
    stats.reconnectDurationMs = Date.now() - reconnectStart;
    logger.info(`Client successfully recreated in ${stats.reconnectDurationMs}ms.`);
  } catch (err) {
    logger.error(`Recreation attempt #${reconnectAttempt} failed: ${err.message}`);
    // Clean up the failed client so it doesn't leak or fire events
    if (client) {
      try {
        client.removeAllListeners();
        await Promise.race([
          client.destroy(),
          sleep(5000),
        ]);
      } catch (destroyErr) {
        logger.warn(`Could not destroy client after initialization failure: ${destroyErr.message}`);
      }
      client = null;
    }
    // Retry with backoff
    await sleep(3000);
    await _doReconnect('Retry recreation after failure');
  }
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
        '--js-flags=--max-old-space-size=256',
        '--disable-extensions',
        '--disable-default-apps',
        '--mute-audio'
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
    logToDashboard('New QR generated. Scan it with WhatsApp to connect.', 'status');
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
    logToDashboard('Authenticated successfully.', 'success');
    broadcastState();
  });

  client.on('auth_failure', async (msg) => {
    logger.error(`Authentication failure: ${msg}`);
    logToDashboard(`Authentication failed: ${msg}. Clearing session and restarting...`, 'error');
    isReady = false;
    lastQrDataUrl = null;
    broadcastState();
    
    // Clear session so the user can scan QR again
    try {
      const fs = require('fs');
      if (fs.existsSync(SESSION_PATH)) {
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        logger.info('Cleared session directory after authentication failure.');
      }
    } catch (err) {
      logger.error(`Failed to clear session directory: ${err.message}`);
    }
    
    await destroyAndRecreateClient(`Auth failure: ${msg}`);
  });

  client.on('ready', async () => {
    isReady = true;
    lastQr = null;
    lastQrDataUrl = null;
    logger.info('WhatsApp client is Ready.');
    logToDashboard('WhatsApp client is ready and connected.', 'success');
    
    // Monkey patch the msg.avParams method on ready to prevent media-sending errors
    try {
      if (client.pupPage) {
        await client.pupPage.evaluate(() => {
          try {
            // 1. Patch WAWebCollections Msg model Class
            const collections = window.require('WAWebCollections');
            if (collections && collections.Msg && collections.Msg.modelClass) {
              const proto = collections.Msg.modelClass.prototype;
              if (!proto.avParams) {
                proto.avParams = function() { return null; };
                console.log('Successfully monkey-patched WAWebCollections Msg prototype on ready');
              }
            }
          } catch (e) {}

          try {
            // 2. Patch window.Store Msg Class
            if (window.Store && window.Store.Msg) {
              const proto = window.Store.Msg.prototype;
              if (!proto.avParams) {
                proto.avParams = function() { return null; };
                console.log('Successfully monkey-patched window.Store.Msg.prototype.avParams on ready');
              }
            }
          } catch (e) {}
        });
      }
    } catch (err) {
      logger.warn(`Failed to apply avParams monkey patch on ready: ${err.message}`);
    }

    startHealthCheck();
    startLidCacheCleanup();
    broadcastState();

    // Drain any messages that were queued while reconnecting
    drainOutgoingQueue();
    drainIncomingQueue();
  });

  client.on('disconnected', async (reason) => {
    logger.info(`Disconnected event: ${reason}`);
    logToDashboard(`Disconnected: ${reason}`, 'error');
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

function getStringSimilarity(s1, s2) {
  const clean = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const w1 = clean(s1);
  const w2 = clean(s2);
  if (w1.length === 0 && w2.length === 0) return 1;
  const set1 = new Set(w1);
  const set2 = new Set(w2);
  const intersection = [...set1].filter(x => set2.has(x)).length;
  const union = new Set([...set1, ...set2]).size;
  return intersection / union;
}

function isJidMatchList(jid, list) {
  if (!jid || !Array.isArray(list) || list.length === 0) return false;

  const cleanJid = String(jid).replace(/[^0-9]/g, '');
  if (!cleanJid) return false;

  return list.some((num) => {
    const cleanNum = String(num).replace(/[^0-9]/g, '');
    if (!cleanNum) return false;

    if (cleanJid === cleanNum) return true;

    // Suffix match both ways (handles different lengths due to country codes, area codes, etc.)
    if (cleanNum.length >= 7 && cleanJid.endsWith(cleanNum)) return true;
    if (cleanJid.length >= 7 && cleanNum.endsWith(cleanJid)) return true;

    const cleanNumNoZero = cleanNum.replace(/^0+/, '');
    const cleanJidNoZero = cleanJid.replace(/^0+/, '');
    if (cleanNumNoZero.length >= 7 && cleanJidNoZero.endsWith(cleanNumNoZero)) return true;
    if (cleanJidNoZero.length >= 7 && cleanNumNoZero.endsWith(cleanJidNoZero)) return true;

    return false;
  });
}

async function getChatMessageChat(message, senderNumber) {
  // Strategy 1: Direct getChat via whatsapp-web.js
  try {
    return await message.getChat();
  } catch (err) {
    logger.warn(`Failed to get chat directly for ${message.from}: ${err.message}. Trying fallback.`);
  }

  // For LID senders, skip the @c.us lookup (it always fails) and go straight to LID lookup
  if (isLidJid(message.from)) {
    try {
      return await client.getChatById(message.from);
    } catch (lidErr) {
      logger.warn(`Fallback getChatById(LID) also failed for ${message.from}: ${lidErr.message}`);
    }
  } else {
    // For non-LID, try the resolved phone number JID
    try {
      const resolvedJid = formatJid(senderNumber);
      if (resolvedJid && resolvedJid !== message.from) {
        return await client.getChatById(resolvedJid);
      }
    } catch (fallbackErr) {
      logger.warn(`Fallback getChatById(@c.us) also failed for ${message.from}: ${fallbackErr.message}`);
    }
  }

  // Return null — caller must handle this gracefully
  logger.warn(`Could not resolve chat object for ${message.from}. Will use direct sendMessage fallback.`);
  return null;
}

async function handleIncomingMessage(message) {
  // Early exit guard: queue incoming messages if client is not ready
  if (!client || !isReady || reconnectPromise) {
    // Basic validations so we only queue actual user chats (skip group if ignored, status, etc.)
    if (message.fromMe || message.isStatus || message.broadcast || message.from === 'status@broadcast' || message.from.includes('@newsletter')) {
      return;
    }
    const isGroup = message.from.endsWith('@g.us');
    if (config.whatsapp.ignoreGroups && isGroup) return;

    const msgId = message.id?._serialized || String(Math.random());
    
    // Duplicate protection: check if message is already in queue
    if (incomingQueue.some(item => item.id && item.id._serialized === msgId)) {
      logger.info(`Ignoring duplicate incoming message ${msgId} (already in queue).`);
      return;
    }

    // Queue size cap: prevent unbounded memory growth
    const MAX_INCOMING_QUEUE = 200;
    if (incomingQueue.length >= MAX_INCOMING_QUEUE) {
      logger.warn(`Incoming message queue is full (${MAX_INCOMING_QUEUE}). Discarding message from ${message.from}`);
      return;
    }

    logger.info(`Queuing incoming message from ${message.from} during client reconnect.`);
    
    // Store only simple/cloned data to avoid keeping references to the old Puppeteer page
    const serializedId = message.id ? { ...message.id } : { _serialized: msgId };
    const fromStr = String(message.from);
    const authorStr = message.author ? String(message.author) : null;
    const bodyStr = String(message.body || '');
    const timestampVal = Number(message.timestamp || Math.floor(Date.now() / 1000));
    const fromMeVal = !!message.fromMe;
    const isStatusVal = !!message.isStatus;
    const broadcastVal = !!message.broadcast;

    incomingQueue.push({
      from: fromStr,
      author: authorStr,
      body: bodyStr,
      timestamp: timestampVal,
      id: serializedId,
      fromMe: fromMeVal,
      isStatus: isStatusVal,
      broadcast: broadcastVal,
      
      // Methods dynamically rebuild context using the new client
      getContact: async function() {
        if (client && isReady) {
          try { return await client.getContactById(this.author || this.from); } catch (_) {}
        }
        return null;
      },
      getChat: async function() {
        if (client && isReady) {
          try { return await client.getChatById(this.from); } catch (_) {}
        }
        return null;
      },
      reply: async function(replyText) {
        if (client && isReady) {
          return await client.sendMessage(this.from, replyText);
        }
        throw new Error('Client not ready for reply');
      }
    });
    return;
  }

  stats.messagesReceived += 1;

  // Ignore messages sent by the bot itself.
  if (message.fromMe) return;

  // Ignore status updates (stories).
  if (message.isStatus) return;

  // Ignore broadcast messages and newsletters.
  if (message.broadcast || message.from === 'status@broadcast' || message.from.includes('@newsletter')) return;

  // Optionally ignore group messages.
  const isGroup = message.from.endsWith('@g.us');
  if (config.whatsapp.ignoreGroups && isGroup) return;

  // Ignore duplicate events (whatsapp-web.js can occasionally emit the same message twice).
  if (message.id && message.id._serialized) {
    if (processedMessageIds.has(message.id._serialized)) return;
    rememberMessageId(message.id._serialized);
  }

  const text = (message.body || '').trim();

  if (!text) return; // ignore non-text (media-only) messages for now

  // Resolve actual phone number from contact info to handle internal unique IDs (LIDs)
  let senderNumber = '';
  let contactName = '';
  const senderId = message.author || message.from;
  const senderIsLid = isLidJid(senderId);

  try {
    const contact = await message.getContact();
    if (contact) {
      if (contact.pushname || contact.name) {
        contactName = contact.pushname || contact.name;
      }
      // contact.number returns LID digits for LID-based contacts, NOT the real phone number.
      // Only trust it if the JID is NOT a LID.
      if (contact.number && !senderIsLid) {
        senderNumber = contact.number;
      }
    }
  } catch (err) {
    logger.warn(`Failed to resolve contact info: ${err.message}`);
    if (isPuppeteerCrash(err)) {
      logger.warn('Puppeteer crashed during getContact(). Triggering client recreation...');
      destroyAndRecreateClient('getContact failed: ' + err.message).catch(() => {});
      return;
    }
  }

  // Check the LID-to-phone cache first
  if (senderIsLid) {
    const cached = lidCacheGet(senderId);
    if (cached) {
      senderNumber = cached;
    }
  }

  // For LID-based JIDs, resolve the real phone number via WhatsApp's internal API if not cached
  if (!senderNumber && senderIsLid && client && client.pupPage) {
    try {
      const resolved = await client.pupPage.evaluate(async (lid) => {
        const result = await window.WWebJS.enforceLidAndPnRetrieval(lid);
        if (result && result.phone) {
          return result.phone.user || result.phone._serialized?.split('@')[0] || '';
        }
        return '';
      }, senderId);
      if (resolved) {
        senderNumber = resolved;
        lidCacheSet(senderId, resolved);
        stats.lidResolutions += 1;
        logger.info(`Resolved LID ${senderId} to phone number ${senderNumber} (and cached)`);
      }
    } catch (err) {
      logger.warn(`Failed to resolve LID to phone number: ${err.message}`);
      if (isPuppeteerCrash(err)) {
        logger.warn('Puppeteer crashed during LID resolution. Triggering client recreation...');
        destroyAndRecreateClient('LID resolution failed: ' + err.message).catch(() => {});
        return;
      }
    }
  }

  // Fallback to extracting digits from JID if above methods fail
  if (!senderNumber) {
    senderNumber = senderId.replace(/[^0-9]/g, '');
    if (senderIsLid) {
      logger.warn(`Could not resolve LID ${senderId} to real phone number, using LID digits as fallback: ${senderNumber}`);
    }
  }

  const logIdentifier = contactName ? `${contactName} (+${senderNumber})` : `+${senderNumber}`;

  // Compute a canonical userId based on the phone number so that conversation memory,
  // mute state, and AI context are keyed on a STABLE identifier — not the raw LID which
  // can change between sessions or coexist with a @c.us JID for the same person.
  const userId = senderIsLid && senderNumber
    ? formatJid(senderNumber)  // e.g. "919981604427@c.us"
    : message.from;            // already @c.us or @g.us

  // Pre-compute the resolved JID for LID fallback sending
  const sendToJid = formatJid(senderNumber);

  // Check dashboard bot config (botEnabled & whitelistEnabled)
  const botCfg = botConfigService.getConfig();
  if (!botCfg.botEnabled) {
    logger.info(`Bot is disabled in control room. Skipping reply to ${userId}`);
    logToDashboard(`Incoming message from ${logIdentifier}: "${text.length > 50 ? text.slice(0, 50) + '...' : text}" (ignored: bot disabled)`, 'warning');
    return;
  }

  // Check if contact AI replies are muted
  if (muteService.isUserMuted(userId)) {
    const muteType = muteService.getMuteType(userId);
    if (muteType === 'admin_handover') {
      logger.info(`User ${userId} is in admin_handover mute. Sending automated holding reply.`);
      const chat = await getChatMessageChat(message, senderNumber);
      await sendHumanLikeReply(chat, message, "An admin has been notified and will handle your request personally.", sendToJid);
    } else {
      logger.info(`AI replies muted for ${userId}. Skipping reply.`);
    }
    return;
  }

  // Verify blacklist first if enabled
  if (botCfg.blacklistEnabled) {
    const blacklist = Array.isArray(botCfg.blacklist) ? botCfg.blacklist : [];
    if (blacklist.length > 0) {
      const isSenderBlacklisted = isJidMatchList(senderNumber, blacklist);
      const isChatBlacklisted = isJidMatchList(message.from, blacklist);

      if (isSenderBlacklisted || isChatBlacklisted) {
        logger.info(`Sender ${senderNumber} or Chat ${message.from} is on the blacklist. Skipping reply.`);
        logToDashboard(`Incoming message from ${logIdentifier}: "${text.length > 50 ? text.slice(0, 50) + '...' : text}" (ignored: blacklisted)`, 'warning');
        return;
      }
    }
  }

  // Verify whitelist first if enabled
  if (botCfg.whitelistEnabled) {
    const whitelist = Array.isArray(botCfg.whitelist) ? botCfg.whitelist : [];
    if (whitelist.length === 0) {
      logger.info(`Whitelist mode active but whitelist is empty. Skipping bot reply to ${userId}`);
      logToDashboard(`Incoming message from ${logIdentifier}: "${text.length > 50 ? text.slice(0, 50) + '...' : text}" (ignored: whitelist is empty)`, 'warning');
      return;
    }

    const isSenderWhitelisted = isJidMatchList(senderNumber, whitelist);
    const isChatWhitelisted = isJidMatchList(message.from, whitelist);

    if (!isSenderWhitelisted && !isChatWhitelisted) {
      logger.info(`Neither Sender ${senderNumber} nor Chat ${message.from} is on the whitelist. Whitelist: [${whitelist.join(', ')}]`);
      logToDashboard(`Incoming message from ${logIdentifier}: "${text.length > 50 ? text.slice(0, 50) + '...' : text}" (ignored: not whitelisted)`, 'warning');
      return;
    }
    logger.info(`Sender/Chat matched whitelist.`);
  }

  logger.info(`Incoming message from ${userId} (${logIdentifier}): ${text}`);
  logToDashboard(`Incoming message from ${logIdentifier}: "${text.length > 50 ? text.slice(0, 50) + '...' : text}"`, 'info');

  // Handle #human command to request personal contact and pause AI
  if (text.toLowerCase() === '#human') {
    const pauseHours = botCfg.autoPauseDurationHours || 12;
    muteService.muteUser(userId, pauseHours);

    // Send confirmation to the user (fetch chat lazily here)
    const chat = await getChatMessageChat(message, senderNumber);
    const userConfirm = `I have paused automated AI replies for the next ${pauseHours} hours. An admin has been notified and will reply to you personally.`;
    await sendHumanLikeReply(chat, message, userConfirm, sendToJid);

    logToDashboard(`User ${logIdentifier} requested a human. AI paused for ${pauseHours} hours.`, 'warning');

    // Notify the admin if notification number is set
    if (botCfg.adminNotifyNumber) {
      const adminJid = formatJid(botCfg.adminNotifyNumber);
      const adminAlert = `⚠️ *[Admin Alert]*\nUser *${logIdentifier}* has requested a human agent.\nAI automated replies have been paused for this user for the next *${pauseHours} hours*.`;
      try {
        await sendMessage(adminJid, adminAlert);
        logger.info(`Notified admin at ${adminJid} about human request.`);
      } catch (err) {
        logger.error(`Failed to send admin notification to ${adminJid}: ${err.message}`);
      }
    }
    return;
  }

  // Fetch the chat object lazily for commands/replies
  const chat = await getChatMessageChat(message, senderNumber);

  // Slash commands bypass the AI pipeline entirely.
  if (isCommand(text)) {
    const reply = handleCommand(text, { userId, stats, isReady });
    const sent = await sendHumanLikeReply(chat, message, reply, sendToJid);
    if (sent) {
      logToDashboard(`Sent Command Reply to ${logIdentifier}: "${reply.length > 50 ? reply.slice(0, 50) + '...' : reply}"`, 'success');
    }
    return;
  }

  // Conversation memory: fetch history, then append the user's message.
  const history = conversationMemory.getHistory(userId);

  // Check if user is repeatedly asking the same question (potential frustration / failure of AI)
  const userMessages = history.filter(h => h.role === 'user');
  if (userMessages.length >= 2) {
    const lastContent = userMessages[userMessages.length - 1].content || '';
    const secondLastContent = userMessages[userMessages.length - 2].content || '';
    
    if (
      text.length >= 5 &&
      lastContent.length >= 5 &&
      secondLastContent.length >= 5
    ) {
      const sim1 = getStringSimilarity(text, lastContent);
      const sim2 = getStringSimilarity(lastContent, secondLastContent);
      
      if (sim1 >= 0.75 && sim2 >= 0.75) {
        logger.warn(`User ${userId} has sent 3 consecutive highly similar messages. Triggering admin handover.`);
        
        // Mute AI automated replies for 10 minutes (10 / 60 hours) with type 'admin_handover'
        muteService.muteUser(userId, 10 / 60, 'admin_handover');
        
        // Send admin notification
        if (botCfg.adminNotifyNumber) {
          const adminJid = formatJid(botCfg.adminNotifyNumber);
          const adminAlert = `⚠️ *[System Alert]*\nUser *${logIdentifier}* appears to be frustrated or repeating the same question:\n_"${text}"_\n\nAI automated replies have been paused for this user for 10 minutes. Please intervene personally.`;
          try {
            await sendMessage(adminJid, adminAlert);
            logger.info(`Notified admin at ${adminJid} about repeated questions.`);
          } catch (err) {
            logger.error(`Failed to send admin notification to ${adminJid}: ${err.message}`);
          }
        }
        
        // Send immediate holding reply
        await sendHumanLikeReply(chat, message, "An admin has been notified and will handle your request personally.", sendToJid);
        return;
      }
    }
  }

  conversationMemory.addMessage(userId, 'user', text);

  // AI generation (handles its own retries/timeout/fallback internally).
  // Note: hasHumanReplied check is done ONCE inside sendHumanLikeReply (after typing delay) to minimize Puppeteer calls.
  const { reply, failed } = await aiService.generateReply(userId, text, history);
  if (failed) stats.aiFailures += 1;

  const sent = await sendHumanLikeReply(chat, message, reply, sendToJid);
  if (sent) {
    conversationMemory.addMessage(userId, 'assistant', reply);
    logToDashboard(`Sent AI reply to ${logIdentifier}: "${reply.length > 50 ? reply.slice(0, 50) + '...' : reply}"`, 'success');
  }
}

async function sendHumanLikeReply(chat, message, replyText, sendToJid) {
  try {
    // If reconnecting, queue reply immediately instead of failing
    if (!client || !isReady || reconnectPromise) {
      logger.info(`Client reconnecting before typing delay. Queuing reply for ${message.from}.`);
      await sendMessage(sendToJid || message.from, replyText);
      return true;
    }

    // Send typing indicator if we have a valid chat object
    if (chat && typeof chat.sendStateTyping === 'function') {
      try { await chat.sendStateTyping(); } catch (_) { /* ignore typing errors */ }
    }

    const incomingText = (message.body || '').trim();
    const delay = computeHumanDelay(replyText.length, incomingText.length);
    await sleep(delay);

    // If reconnecting after typing delay, queue reply immediately
    if (!client || !isReady || reconnectPromise) {
      logger.info(`Client reconnecting after typing delay. Queuing reply for ${message.from}.`);
      await sendMessage(sendToJid || message.from, replyText);
      return true;
    }

    if (chat) {
      if (await hasHumanReplied(chat, message)) {
        logger.info(`Human replied during typing delay in chat ${message.from}. Cancelling bot reply.`);
        if (typeof chat.clearState === 'function') {
          try { await chat.clearState(); } catch (_) { /* ignore */ }
        }
        return false;
      }
    }

    // Try sending the message
    let sentMsg;
    let sent = false;
    let lastSendError = null;

    // Strategy 1: quoted reply via message.reply()
    try {
      sentMsg = await message.reply(replyText);
      sent = true;
    } catch (replyErr) {
      lastSendError = replyErr;
      logger.warn(`message.reply() failed for ${message.from}: ${replyErr.message}. Trying direct send.`);
    }

    // Strategy 2: send via chat object (uses wrapped sendMessage to support queueing fallback)
    if (!sent && chat && chat.id && chat.id._serialized) {
      try {
        sentMsg = await sendMessage(chat.id._serialized, replyText);
        sent = true;
      } catch (chatSendErr) {
        lastSendError = chatSendErr;
        logger.warn(`sendMessage(chat) failed for ${message.from}: ${chatSendErr.message}`);
      }
    }

    // Strategy 3: send via resolved phone number JID (uses wrapped sendMessage to support queueing fallback)
    if (!sent && sendToJid) {
      try {
        sentMsg = await sendMessage(sendToJid, replyText);
        sent = true;
        logger.info(`Sent reply via resolved JID ${sendToJid} for LID user ${message.from}`);
      } catch (jidSendErr) {
        lastSendError = jidSendErr;
        logger.error(`sendMessage(resolvedJid) failed for ${sendToJid}: ${jidSendErr.message}`);
      }
    }

    if (!sent) {
      logger.error(`All send strategies failed for ${message.from}. Could not deliver reply.`);
      stats.failedSends += 1;
      // Check if the browser is dead and trigger auto-reconnect
      if (isPuppeteerCrash(lastSendError)) {
        logger.warn(`Browser appears dead. Triggering client recreation: ${lastSendError?.message}`);
        const reconnecting = destroyAndRecreateClient('All send strategies failed: ' + lastSendError?.message);
        // Message retry: wait for reconnect and try once more
        try {
          await reconnecting;
          if (client && isReady) {
            const retryTarget = sendToJid || message.from;
            sentMsg = await client.sendMessage(retryTarget, replyText);
            sent = true;
            logger.info(`Retry after reconnect succeeded for ${message.from}`);
          }
        } catch (retryErr) {
          logger.error(`Retry after reconnect also failed for ${message.from}: ${retryErr.message}`);
        }
      }
      if (!sent) return false;
    }

    if (sentMsg && sentMsg.id && sentMsg.id._serialized) {
      rememberBotMessageId(sentMsg.id._serialized);
    }
    stats.messagesReplied += 1;
    logger.info(`Replied to ${message.from} after ${Math.round(delay)}ms delay`);
    return true;
  } catch (err) {
    logger.error(`Failed to send reply to ${message.from}: ${err.message}`);
    if (isPuppeteerCrash(err)) {
      await destroyAndRecreateClient(err.message);
    }
    return false;
  }
}

async function initializeWhatsApp() {
  muteService.loadMutes();
  loadLidCache();
  if (!client) {
    createClient();
  }
  logger.info('Initializing WhatsApp client...');
  await client.initialize();
}

async function drainOutgoingQueue() {
  if (outgoingQueue.length === 0) return;
  logger.info(`Draining ${outgoingQueue.length} queued outgoing messages...`);
  while (outgoingQueue.length > 0) {
    const { to, text, resolve, reject } = outgoingQueue.shift();
    try {
      const result = await sendMessage(to, text);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }
}

async function drainIncomingQueue() {
  if (incomingQueue.length === 0) return;
  logger.info(`Draining ${incomingQueue.length} queued incoming messages...`);
  
  const QUEUE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  
  while (incomingQueue.length > 0) {
    const msg = incomingQueue.shift();
    
    // Queue expiration (TTL check): skip if message is older than 5 minutes
    const msgTimeMs = msg.timestamp * 1000;
    if (Date.now() - msgTimeMs > QUEUE_TTL_MS) {
      logger.warn(`Discarding expired queued message from ${msg.from} (received ${Math.round((Date.now() - msgTimeMs) / 1000)}s ago).`);
      continue;
    }
    
    try {
      await handleIncomingMessage(msg);
    } catch (err) {
      logger.error(`Error processing queued incoming message from ${msg.from}: ${err.message}`);
    }
  }
}

async function sendMessage(to, text) {
  // Queue messages if client is reconnecting instead of failing immediately
  if (!client || !isReady || reconnectPromise) {
    if (reconnectPromise && outgoingQueue.length < MAX_QUEUE_SIZE) {
      stats.queuedMessages += 1;
      logger.info(`Client reconnecting. Queuing message to ${to} (queue size: ${outgoingQueue.length + 1})`);
      return new Promise((resolve, reject) => {
        outgoingQueue.push({ to, text, resolve, reject });
      });
    }
    throw new Error('WhatsApp client is not ready yet.');
  }
  try {
    const chatId = formatJid(to);
    const isNewsletter = chatId.endsWith('@newsletter');
    const options = isNewsletter ? { sendSeen: false } : {};
    const sentMsg = await client.sendMessage(chatId, text, options);
    if (sentMsg && sentMsg.id && sentMsg.id._serialized) {
      rememberBotMessageId(sentMsg.id._serialized);
    }
    return sentMsg;
  } catch (err) {
    logger.error(`sendMessage failed: ${err.message}`);
    stats.failedSends += 1;
    if (isPuppeteerCrash(err)) {
      await destroyAndRecreateClient(err.message);
    }
    throw err;
  }
}

async function sendMediaMessage(to, filePath, caption = '') {
  if (!client || !isReady) {
    throw new Error('WhatsApp client is not ready yet.');
  }
  try {
    const chatId = formatJid(to);
    const media = MessageMedia.fromFilePath(filePath);
    const isNewsletter = chatId.endsWith('@newsletter');
    const options = isNewsletter ? { caption, sendSeen: false } : (caption ? { caption } : {});

    // Ensure the msg.avParams monkey patch is active right before sending media
    if (client.pupPage) {
      try {
        await client.pupPage.evaluate(() => {
          try {
            // 1. Patch WAWebCollections Msg model Class
            const collections = window.require('WAWebCollections');
            if (collections && collections.Msg && collections.Msg.modelClass) {
              const proto = collections.Msg.modelClass.prototype;
              if (!proto.avParams) {
                proto.avParams = function() { return null; };
                console.log('Successfully monkey-patched WAWebCollections Msg prototype before send');
              }
            }
          } catch (e) {}

          try {
            // 2. Patch window.Store Msg Class
            if (window.Store && window.Store.Msg) {
              const proto = window.Store.Msg.prototype;
              if (!proto.avParams) {
                proto.avParams = function() { return null; };
                console.log('Successfully monkey-patched window.Store.Msg.prototype.avParams before send');
              }
            }
          } catch (e) {}
        });
      } catch (err) {
        logger.warn(`Failed to apply avParams monkey patch before send: ${err.message}`);
      }
    }

    const sentMsg = await client.sendMessage(chatId, media, options);
    if (sentMsg && sentMsg.id && sentMsg.id._serialized) {
      rememberBotMessageId(sentMsg.id._serialized);
    }
    return sentMsg;
  } catch (err) {
    logger.error(`sendMediaMessage failed: ${err.message}`);
    stats.failedSends += 1;
    if (isPuppeteerCrash(err)) {
      await destroyAndRecreateClient(err.message);
    }
    throw err;
  }
}

function getClient() {
  return client;
}

async function findChatByName(name) {
  if (!client || !isReady) return null;
  try {
    const lowerName = name.toLowerCase();
    
    // 1. Try to find using getAvailableChats cache
    if (_cachedChats && _cachedChats.raw) {
      const found = _cachedChats.raw.find((c) => c.name && c.name.toLowerCase() === lowerName);
      if (found) {
        return {
          id: { _serialized: found.id },
          name: found.name
        };
      }
    }

    // 2. Fallback: Query directly from the browser window using lightweight evaluate
    const foundJid = await client.pupPage.evaluate((targetName) => {
      try {
        const collections = window.require('WAWebCollections');
        if (!collections || !collections.Chat) return null;
        const models = typeof collections.Chat.getModelsArray === 'function'
          ? collections.Chat.getModelsArray()
          : collections.Chat.models;
        if (!models || !Array.isArray(models)) return null;
        const lower = targetName.toLowerCase();
        const found = models.find(c => c.name && c.name.toLowerCase() === lower);
        if (found) {
          return found.id ? (found.id._serialized || found.id) : null;
        }
      } catch (e) {}
      return null;
    }, name);

    if (foundJid) {
      return {
        id: { _serialized: foundJid },
        name: name
      };
    }

    return null;
  } catch (err) {
    logger.warn(`findChatByName error: ${err.message}`);
    if (isPuppeteerCrash(err)) {
      destroyAndRecreateClient('findChatByName failed: ' + err.message).catch(() => {});
    }
    return null;
  }
}

// ── Cached getAvailableChats (60-second TTL) ────────────────────────
let _cachedChats = null;
let _cachedChatsAt = 0;
const CHATS_CACHE_TTL_MS = 60_000; // 60 seconds

async function getAvailableChats(forceRefresh = false) {
  if (!client || !isReady) return { groups: [], channels: [], directChats: [], totalChats: 0 };

  // Return cached result if fresh and not forced
  if (!forceRefresh && _cachedChats && (Date.now() - _cachedChatsAt) < CHATS_CACHE_TTL_MS) {
    return _cachedChats;
  }

  try {
    // Lightweight extraction: fetch only JID, name, and classification flags.
    // This avoids JSON serialization of huge Backbone model trees (messages list, participants, etc.)
    // which consumes huge RAM and CPU, causing frequent detached frame or protocol 'r' crashes.
    let chats = [];
    try {
      if (client.pupPage) {
        chats = await client.pupPage.evaluate(() => {
          try {
            const collections = window.require('WAWebCollections');
            if (!collections || !collections.Chat) return null;
            const models = typeof collections.Chat.getModelsArray === 'function'
              ? collections.Chat.getModelsArray()
              : collections.Chat.models;
            if (!models || !Array.isArray(models)) return null;
            return models.map(chat => {
              const jid = chat.id ? (chat.id._serialized || chat.id) : '';
              return {
                id: typeof jid === 'string' ? jid : '',
                name: chat.name || '',
                isGroup: !!(chat.isGroup || (chat.id && chat.id.server === 'g.us') || chat.groupMetadata),
                isReadOnly: !!(chat.isReadOnly || (chat.groupMetadata && chat.groupMetadata.announce)),
                isChannel: !!(chat.isChannel || (chat.id && chat.id.server === 'newsletter'))
              };
            });
          } catch (e) {
            console.error('Error in lightweight evaluate:', e);
            return null;
          }
        });
      }
      if (!chats || chats.length === 0) {
        chats = await client.getChats();
      }
    } catch (lightweightErr) {
      logger.warn(`Lightweight getChats failed: ${lightweightErr.message}. Falling back to standard getChats.`);
      
      if (isPuppeteerCrash(lightweightErr)) {
        // Trigger a background restart but don't block the UI
        logger.error(`Puppeteer crashed during evaluate. Triggering background restart.`);
        setTimeout(() => {
          if (typeof destroyAndRecreateClient === 'function') {
            destroyAndRecreateClient();
          }
        }, 1000);
        
        // Return stale cache immediately to avoid failing the request
        if (_cachedChats) return _cachedChats;
        return { groups: [], channels: [], directChats: [] };
      }
      
      logger.warn(`lightweightErr was NOT identified as a crash by isPuppeteerCrash. Attempting fallback...`);
      logger.error(lightweightErr.stack || 'No stack trace available for lightweightErr');
      try {
        const util = require('util');
        logger.error(util.inspect(lightweightErr, { depth: 5 }));
      } catch (e) {}

      chats = await client.getChats();
    }

    const groups = [];
    const channels = [];
    const directChats = [];
    for (const chat of chats) {
      const jid = getChatJid(chat);
      if (!jid) continue;

      const name = chat.name || (chat.id && chat.id.user) || jid.split('@')[0] || 'Unnamed';

      if (isGroupChat(chat)) {
        groups.push({ id: jid, name: name || 'Unnamed Group' });
      } else if (isChannel(chat)) {
        channels.push({ id: jid, name: name || 'Unnamed Channel' });
      } else if (isDirectChat(chat)) {
        directChats.push({ id: jid, name: name || 'Unnamed Contact' });
      }
    }
    const raw = chats.map(c => {
      const jid = getChatJid(c);
      return { name: c.name || 'Unnamed', id: jid || 'unknown' };
    });
    logger.info(`getAvailableChats: Found ${chats.length} total chats. Filtered down to ${groups.length} groups, ${channels.length} channels, and ${directChats.length} direct chats.`);
    _cachedChats = { groups, channels, directChats, totalChats: chats.length, raw };
    _cachedChatsAt = Date.now();
    return _cachedChats;
  } catch (err) {
    logger.error(`Error getting available chats: ${err.message}`);
    logger.error(err.stack || 'No stack trace available');
    try {
      const util = require('util');
      logger.error(util.inspect(err, { depth: 5 }));
    } catch (e) {}
    
    if (isPuppeteerCrash(err)) {
      logger.error(`Puppeteer crashed in fallback getChats. Triggering background restart.`);
      setTimeout(() => {
        if (typeof destroyAndRecreateClient === 'function') {
          destroyAndRecreateClient();
        }
      }, 1000);
    }
    
    if (_cachedChats) return _cachedChats;
    return { groups: [], channels: [], directChats: [] };
  }
}

async function fetchChatMessages(chatId, limit = 80) {
  if (!client || !isReady) {
    throw new Error('WhatsApp client is not ready.');
  }
  let chat;
  try {
    chat = await client.getChatById(chatId);
  } catch (err) {
    logger.error(`fetchChatMessages: getChatById failed for ${chatId}: ${err.message}`);
    if (isPuppeteerCrash(err)) {
      logger.warn('Puppeteer crashed during fetchChatMessages. Triggering client recreation...');
      destroyAndRecreateClient('fetchChatMessages failed: ' + err.message).catch(() => {});
      throw new Error('WhatsApp browser session crashed. Reconnecting...');
    }
    return [];
  }
  if (!chat) {
    throw new Error(`Chat with ID ${chatId} not found.`);
  }
  try {
    const messages = await chat.fetchMessages({ limit });
    return messages.map((m) => {
      // Determine a clean display name for the sender
      let senderName = 'Contact';
      if (m.fromMe) {
        senderName = 'Me';
      } else if (m._data && m._data.notifyName) {
        senderName = m._data.notifyName;
      } else if (chat.name) {
        senderName = chat.name;
      }

      return {
        body: m.body || '',
        fromMe: !!m.fromMe,
        senderName,
        timestamp: m.timestamp,
      };
    });
  } catch (err) {
    logger.error(`fetchChatMessages: fetchMessages failed for ${chatId}: ${err.message}`);
    if (isPuppeteerCrash(err)) {
      destroyAndRecreateClient('fetchMessages failed: ' + err.message).catch(() => {});
    }
    return [];
  }
}

async function getChannelIdFromLink(inviteLink) {
  if (!client || !isReady) throw new Error('WhatsApp client is not ready. Please scan QR code first.');
  try {
    let inviteCode = inviteLink;
    if (inviteLink.includes('/')) {
      inviteCode = inviteLink.split('/').pop();
    }
    if (!inviteCode) throw new Error('Invalid invite link format');
    
    // WhatsApp Web recently updated their internal API which breaks whatsapp-web.js's native wrappers.
    // We execute a custom evaluate script to safely bypass the broken getRoleByIdentifier module.
    let channelId = await client.pupPage.evaluate(async (code) => {
      // 1. Try to directly call the internal query job (bypassing broken RoleUtils)
      try {
        const queryJob = window.require('WAWebNewsletterMetadataQueryJob');
        if (queryJob && queryJob.queryNewsletterMetadataByInviteCode) {
           // 'GUEST' is the default role for someone inspecting an invite link
           const response = await queryJob.queryNewsletterMetadataByInviteCode(code, 'GUEST');
           if (response && response.idJid) return response.idJid;
        }
      } catch (e) {}
      
      // 2. Try the built-in WWebJS wrapper as fallback
      try {
        if (window.WWebJS && typeof window.WWebJS.getChannelMetadata === 'function') {
           const response = await window.WWebJS.getChannelMetadata(code);
           if (response && response.idJid) return response.idJid;
        }
      } catch (e) {}

      return null;
    }, inviteCode);
    
    if (!channelId) throw new Error('Channel not found, invalid link, or WhatsApp Web API has changed.');
    return channelId;
  } catch (err) {
    logger.error(`Error getting channel from link: ${err.message}`);
    if (isPuppeteerCrash(err)) {
      destroyAndRecreateClient('getChannelIdFromLink failed: ' + err.message).catch(() => {});
    }
    throw err;
  }
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
    lidCacheSize: lidCache.size,
    outgoingQueueSize: outgoingQueue.length,
  };
}

async function reconnect() {
  logger.info('Reconnect requested from Control Room.');
  await destroyAndRecreateClient('Requested via dashboard reconnect endpoint');
}

async function requestPairingCode(rawPhone) {
  if (!client || !client.pupPage) {
    throw new Error('WhatsApp client is not initialized yet.');
  }
  const phone = String(rawPhone || '').replace(/[^0-9]/g, '');
  if (!phone || phone.length < 10) {
    throw new Error('Please enter a valid phone number with country code (e.g. 14155551234).');
  }
  logger.info(`Requesting WhatsApp pairing code for ${phone}...`);
  try {
    const code = await client.requestPairingCode(phone);
    return code;
  } catch (err) {
    logger.error(`Failed to request pairing code: ${err.message}`);
    if (isPuppeteerCrash(err)) {
      logger.warn('Puppeteer frame is corrupted. Triggering client recreation...');
      destroyAndRecreateClient('Pairing code request failed: ' + err.message).catch(() => {});
      throw new Error('WhatsApp browser session expired. The bot is reconnecting — please try again in 30 seconds.');
    }
    throw err;
  }
}

async function hardReset() {
  logger.warn('Hard reset requested. Cleaning up and deleting session...');
  stopHealthCheck();
  stopLidCacheCleanup();
  saveLidCacheToDisk(); // persist before shutdown
  isReady = false;
  
  if (client) {
    try {
      logger.info('Removing all listeners from client...');
      client.removeAllListeners();
      
      const browser = client.pupBrowser;
      if (browser && browser.process()) {
        logger.info('Force-killing Puppeteer browser process...');
        browser.process().kill('SIGKILL');
      }
      
      await Promise.race([
        client.destroy(),
        sleep(5000), // Don't let destroy() hang forever
      ]);
    } catch (err) {
      logger.warn(`Could not destroy client cleanly during hard reset: ${err.message}`);
    }
  }
  
  client = null;

  // Kill any leftover chrome/chromium referencing session path
  try {
    const { execSync } = require('child_process');
    execSync(`pkill -f "${SESSION_PATH}" 2>/dev/null || true`, { timeout: 5000 });
    logger.info('Killed any leftover browser processes referencing session path.');
  } catch (_) {}

  // Delete session files
  const fs = require('fs');
  if (fs.existsSync(SESSION_PATH)) {
    try {
      fs.rmSync(SESSION_PATH, { recursive: true, force: true });
      logger.info('Successfully deleted session directory.');
    } catch (err) {
      logger.error(`Failed to delete session directory during hard reset: ${err.message}`);
      throw err;
    }
  }
}

module.exports = {
  initializeWhatsApp,
  sendMessage,
  sendMediaMessage,
  getClient,
  findChatByName,
  getAvailableChats,
  getChannelIdFromLink,
  getStatus,
  getStats,
  setSocketIO,
  getDashboardStatus,
  reconnect,
  requestPairingCode,
  hardReset,
  formatJid,
  fetchChatMessages,
  // LID abstraction helpers (available for other modules)
  isLidJid,
  isDirectChat,
  isGroupChat,
  isChannel,
};
