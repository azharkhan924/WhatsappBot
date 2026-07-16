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
      .catch(async (err) => {
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
        '--js-flags=--max-old-space-size=150',
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
    broadcastState();
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
  try {
    return await message.getChat();
  } catch (err) {
    logger.warn(`Failed to get chat directly for ${message.from}: ${err.message}. Trying resolved JID.`);
  }

  // Fallback: try with the resolved phone number JID
  try {
    const resolvedJid = formatJid(senderNumber);
    if (resolvedJid && resolvedJid !== message.from) {
      return await client.getChatById(resolvedJid);
    }
  } catch (fallbackErr) {
    logger.warn(`Fallback getChatById also failed for ${message.from}: ${fallbackErr.message}`);
  }

  // Return null — caller must handle this gracefully
  logger.warn(`Could not resolve chat object for ${message.from}. Will use direct sendMessage fallback.`);
  return null;
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
  const isGroup = message.from.endsWith('@g.us');
  if (config.whatsapp.ignoreGroups && isGroup) return;

  // Ignore duplicate events (whatsapp-web.js can occasionally emit the same message twice).
  if (message.id && message.id._serialized) {
    if (processedMessageIds.has(message.id._serialized)) return;
    rememberMessageId(message.id._serialized);
  }

  const userId = message.from;
  const text = (message.body || '').trim();

  if (!text) return; // ignore non-text (media-only) messages for now

  // Resolve actual phone number from contact info to handle internal unique IDs (LIDs)
  let senderNumber = '';
  let contactName = '';
  const senderId = message.author || message.from;
  const isLidJid = senderId.includes('@lid');

  try {
    const contact = await message.getContact();
    if (contact) {
      if (contact.pushname || contact.name) {
        contactName = contact.pushname || contact.name;
      }
      // contact.number returns LID digits for LID-based contacts, NOT the real phone number.
      // Only trust it if the JID is NOT a LID.
      if (contact.number && !isLidJid) {
        senderNumber = contact.number;
      }
    }
  } catch (err) {
    logger.warn(`Failed to resolve contact info: ${err.message}`);
  }

  // For LID-based JIDs, resolve the real phone number via WhatsApp's internal API
  if (!senderNumber && isLidJid && client && client.pupPage) {
    try {
      const resolved = await client.pupPage.evaluate(async (lid) => {
        const result = await window.WWebJS.enforceLidAndPnRetrieval(lid);
        if (result && result.phone) {
          // result.phone is a WID object; extract the user part (the actual phone number)
          return result.phone.user || result.phone._serialized?.split('@')[0] || '';
        }
        return '';
      }, senderId);
      if (resolved) {
        senderNumber = resolved;
        logger.info(`Resolved LID ${senderId} to phone number ${senderNumber}`);
      }
    } catch (err) {
      logger.warn(`Failed to resolve LID to phone number: ${err.message}`);
    }
  }

  // Fallback to extracting digits from JID if above methods fail
  if (!senderNumber) {
    senderNumber = senderId.replace(/[^0-9]/g, '');
    if (isLidJid) {
      logger.warn(`Could not resolve LID ${senderId} to real phone number, using LID digits as fallback: ${senderNumber}`);
    }
  }

  const logIdentifier = contactName ? `${contactName} (+${senderNumber})` : `+${senderNumber}`;

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
    const userConfirm = `I have paused automated AI replies for the next ${pauseHours} hours. Azhar has been notified and will reply to you personally.`;
    await sendHumanLikeReply(chat, message, userConfirm, sendToJid);

    logToDashboard(`User ${logIdentifier} requested a human. AI paused for ${pauseHours} hours.`, 'warning');

    // Notify the admin if notification number is set
    if (botCfg.adminNotifyNumber) {
      const adminJid = formatJid(botCfg.adminNotifyNumber);
      const adminAlert = `⚠️ *[Admin Alert]*\nUser *${logIdentifier}* has requested a human agent.\nAI automated replies have been paused for this user for the next *${pauseHours} hours*.`;
      try {
        await client.sendMessage(adminJid, adminAlert);
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
            await client.sendMessage(adminJid, adminAlert);
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

  if (chat && await hasHumanReplied(chat, message)) {
    logger.info(`Human already replied to ${userId} before AI generation. Skipping bot reply.`);
    logToDashboard(`Cancelled AI reply to ${logIdentifier} (human replied first)`, 'warning');
    return;
  }

  // AI generation (handles its own retries/timeout/fallback internally).
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
    // If we have a valid chat object, do the full human-like flow
    if (chat) {
      if (await hasHumanReplied(chat, message)) {
        logger.info(`Human already replied in chat ${message.from}. Cancelling bot reply.`);
        return false;
      }

      if (typeof chat.sendStateTyping === 'function') {
        try { await chat.sendStateTyping(); } catch (_) { /* ignore typing errors */ }
      }
    }

    const incomingText = (message.body || '').trim();
    const delay = computeHumanDelay(replyText.length, incomingText.length);
    await sleep(delay);

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

    // Strategy 1: quoted reply via message.reply()
    try {
      sentMsg = await message.reply(replyText);
      sent = true;
    } catch (replyErr) {
      logger.warn(`message.reply() failed for ${message.from}: ${replyErr.message}. Trying direct send.`);
    }

    // Strategy 2: send via chat object
    if (!sent && chat && chat.id && chat.id._serialized) {
      try {
        sentMsg = await client.sendMessage(chat.id._serialized, replyText);
        sent = true;
      } catch (chatSendErr) {
        logger.warn(`client.sendMessage(chat) failed for ${message.from}: ${chatSendErr.message}`);
      }
    }

    // Strategy 3: send via resolved phone number JID
    if (!sent && sendToJid) {
      try {
        sentMsg = await client.sendMessage(sendToJid, replyText);
        sent = true;
        logger.info(`Sent reply via resolved JID ${sendToJid} for LID user ${message.from}`);
      } catch (jidSendErr) {
        logger.error(`client.sendMessage(resolvedJid) failed for ${sendToJid}: ${jidSendErr.message}`);
      }
    }

    if (!sent) {
      logger.error(`All send strategies failed for ${message.from}. Could not deliver reply.`);
      return false;
    }

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
  muteService.loadMutes();
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
    if (
      err.message.includes('detached Frame') ||
      err.message.includes('Execution context was destroyed') ||
      err.message.includes('Session closed') ||
      err.message.includes('Target closed')
    ) {
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
    if (
      err.message.includes('detached Frame') ||
      err.message.includes('Execution context was destroyed') ||
      err.message.includes('Session closed') ||
      err.message.includes('Target closed')
    ) {
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
    const chats = await client.getChats();
    const lowerName = name.toLowerCase();
    return chats.find((c) => c.name && c.name.toLowerCase() === lowerName) || null;
  } catch (err) {
    logger.warn(`findChatByName error: ${err.message}`);
    return null;
  }
}

async function getAvailableChats() {
  if (!client || !isReady) return { groups: [], channels: [], directChats: [], totalChats: 0 };
  try {
    const chats = await client.getChats();
    const groups = [];
    const channels = [];
    const directChats = [];
    for (const chat of chats) {
      if (chat.isGroup || (chat.id && chat.id.server === 'g.us')) {
        groups.push({ id: chat.id._serialized, name: chat.name || 'Unnamed Group' });
      } else if (chat.isChannel || (chat.id && chat.id.server === 'newsletter') || (chat.id && chat.id._serialized && chat.id._serialized.endsWith('@newsletter'))) {
        channels.push({ id: chat.id._serialized, name: chat.name || 'Unnamed Channel' });
      } else if (chat.id && chat.id.server === 'c.us') {
        directChats.push({ id: chat.id._serialized, name: chat.name || chat.id.user || 'Unnamed Contact' });
      }
    }
    const raw = chats.map(c => ({ name: c.name || 'Unnamed', id: c.id ? c.id._serialized : 'unknown' }));
    logger.info(`getAvailableChats: Found ${chats.length} total chats. Filtered down to ${groups.length} groups, ${channels.length} channels, and ${directChats.length} direct chats.`);
    return { groups, channels, directChats, totalChats: chats.length, raw };
  } catch (err) {
    logger.error(`Error getting available chats: ${err.message}`);
    return { groups: [], channels: [], directChats: [] };
  }
}

async function fetchChatMessages(chatId, limit = 80) {
  if (!client || !isReady) {
    throw new Error('WhatsApp client is not ready.');
  }
  const chat = await client.getChatById(chatId);
  if (!chat) {
    throw new Error(`Chat with ID ${chatId} not found.`);
  }
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
  };
}

async function reconnect() {
  logger.info('Reconnect requested from Control Room.');
  await destroyAndRecreateClient('Requested via dashboard reconnect endpoint');
}

async function requestPairingCode(rawPhone) {
  if (!client) {
    throw new Error('WhatsApp client is not initialized yet.');
  }
  const phone = String(rawPhone || '').replace(/[^0-9]/g, '');
  if (!phone || phone.length < 10) {
    throw new Error('Please enter a valid phone number with country code (e.g. 14155551234).');
  }
  logger.info(`Requesting WhatsApp pairing code for ${phone}...`);
  const code = await client.requestPairingCode(phone);
  return code;
}

async function hardReset() {
  logger.warn('Hard reset requested. Cleaning up and deleting session...');
  stopHealthCheck();
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
};
