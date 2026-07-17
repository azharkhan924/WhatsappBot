// controllers/botController.js
// Business logic for each REST endpoint. Routes stay thin; logic lives here.

const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const botConfigService = require('../services/botConfigService');
const schedulerService = require('../services/schedulerService');
const authService = require('../services/authService');
const conversationMemory = require('../memory/conversationMemory');
const provider = require('../providers');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const config = require('../config');
const VERSION = require('../package.json').version;
const START_TIME = Date.now();
const QUOTES_FILE = path.join(config.dataDir, 'quotes.txt');

async function getRoot(req, res) {
  res.json({
    success: true,
    name: 'WhatsApp AI Bot',
    version: VERSION,
    status: 'running',
  });
}

async function getHealth(req, res) {
  const status = whatsappService.getStatus();
  res.json({
    success: true,
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    whatsapp: status,
    aiProvider: provider.getName(),
  });
}

async function postSend(req, res, next) {
  try {
    const { to, message } = req.body;
    const result = await whatsappService.sendMessage(to, message);
    res.json({ success: true, messageId: result.id ? result.id._serialized : null });
  } catch (err) {
    logger.error(`postSend failed: ${err.message}`);
    next(Object.assign(err, { statusCode: 502, publicMessage: 'Failed to send WhatsApp message' }));
  }
}

async function postChat(req, res, next) {
  try {
    const { userId, message } = req.body;
    const history = conversationMemory.getHistory(userId);
    conversationMemory.addMessage(userId, 'user', message);

    const { reply, latencyMs, failed } = await aiService.generateReply(userId, message, history);
    conversationMemory.addMessage(userId, 'assistant', reply);

    res.json({ success: true, reply, latencyMs, failed, provider: provider.getName() });
  } catch (err) {
    next(Object.assign(err, { statusCode: 500, publicMessage: 'Failed to generate AI reply' }));
  }
}

async function postReset(req, res) {
  const { userId } = req.body;
  conversationMemory.resetHistory(userId);
  res.json({ success: true, message: `Conversation history cleared for ${userId}` });
}

async function getStats(req, res) {
  res.json({ success: true, stats: whatsappService.getStats() });
}

// ── Control Room Dashboard Endpoints ──

async function getDashboardStatus(req, res) {
  const status = whatsappService.getDashboardStatus();
  res.json(status);
}

async function postReconnect(req, res, next) {
  try {
    await whatsappService.reconnect();
    res.json({ success: true, message: 'Reconnection triggered' });
  } catch (err) {
    logger.error(`postReconnect failed: ${err.message}`);
    next(err);
  }
}

async function getConfig(req, res) {
  const cfg = botConfigService.getConfig();
  res.json(cfg);
}

async function putConfig(req, res) {
  const updates = req.body || {};
  const updated = botConfigService.updateConfig(updates);

  // Restart scheduler if any scheduler-related settings changed
  const schedulerKeys = [
    'schedulerEnabled', 'schedulerCron', 'schedulerTimezone',
    'schedulerTargetGroups', 'schedulerTargetChannels',
    'schedulerAdImageDir', 'schedulerAdCaption',
    'schedulerImageSource', 'schedulerCommonPrompt',
    'schedulerImagePromptHint', 'schedulerCaptionPromptHint',
  ];
  const hasSchedulerChange = schedulerKeys.some((k) => updates[k] !== undefined);
  if (hasSchedulerChange) {
    try {
      schedulerService.restartScheduler();
    } catch (err) {
      logger.warn(`Failed to restart scheduler after config update: ${err.message}`);
    }
  }

  // Save multi-line or numbered captions to captions.txt in the ad images directory
  const { parseNumberedList } = require('../utils/parser');
  const isMultiCaption = typeof updates.schedulerAdCaption === 'string' &&
    (updates.schedulerAdCaption.includes('\n') || parseNumberedList(updates.schedulerAdCaption) !== null);

  if (isMultiCaption) {
    try {
      const adService = require('../services/adService');
      const adDir = updates.schedulerAdImageDir || updated.schedulerAdImageDir || adService.getAdImageDir();
      if (!fs.existsSync(adDir)) {
        fs.mkdirSync(adDir, { recursive: true });
      }
      const captionsFile = path.join(adDir, 'captions.txt');
      fs.writeFileSync(captionsFile, updates.schedulerAdCaption, 'utf-8');
      logger.info(`Saved per-image captions to ${captionsFile}`);
    } catch (err) {
      logger.warn(`Failed to save captions.txt: ${err.message}`);
    }
  }

  res.json(updated);
}

async function getSchedulerStatus(req, res) {
  const status = schedulerService.getStatus();
  res.json({ success: true, ...status });
}

async function postTriggerScheduler(req, res, next) {
  try {
    const result = await schedulerService.sendNow();
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`postTriggerScheduler failed: ${err.message}`);
    let publicMessage = 'Failed to trigger scheduler';
    if (err.message.includes('not connected') || err.message.includes('not ready')) {
      publicMessage = 'WhatsApp client is disconnected. Please scan the QR code in the dashboard to log in first.';
    }
    next(Object.assign(err, { statusCode: 400, publicMessage }));
  }
}

async function getAvailableChats(req, res, next) {
  try {
    const force = req.query.force === 'true' || req.query.refresh === 'true';
    const chats = await whatsappService.getAvailableChats(force);
    res.json({ success: true, ...chats });
  } catch (err) {
    next(err);
  }
}

async function postExtractChannelId(req, res, next) {
  try {
    const { link } = req.body;
    if (!link) return res.status(400).json({ error: 'Missing link' });
    const id = await whatsappService.getChannelIdFromLink(link);
    res.json({ success: true, id });
  } catch (err) {
    let publicMessage = 'Failed to extract channel ID. Make sure it is a valid link.';
    if (err.message) publicMessage = err.message;
    next(Object.assign(err, { statusCode: 400, publicMessage }));
  }
}

async function getQuotes(req, res, next) {
  try {
    if (!fs.existsSync(QUOTES_FILE)) {
      return res.json({ success: true, content: '' });
    }
    const content = fs.readFileSync(QUOTES_FILE, 'utf-8');
    res.json({ success: true, content });
  } catch (err) {
    next(err);
  }
}

async function putQuotes(req, res, next) {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') throw new Error('Invalid content');
    const dir = path.dirname(QUOTES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUOTES_FILE, content, 'utf-8');
    
    // Clear quote service cache so new quotes are immediately used
    require('../services/quoteService').clearCache();
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function postRequestOtp(req, res, next) {
  try {
    const { phone } = req.body || {};
    const result = await authService.requestOtp(phone);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function postVerifyOtp(req, res, next) {
  try {
    const { phone, otp } = req.body || {};
    const result = await authService.verifyOtp(phone, otp);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function postPairingCode(req, res, next) {
  try {
    const { phone } = req.body || {};
    const code = await whatsappService.requestPairingCode(phone);
    res.json({ success: true, pairingCode: code });
  } catch (err) {
    next(err);
  }
}

async function postHardReset(req, res, next) {
  try {
    // Call the safe hard reset helper from whatsappService
    await whatsappService.hardReset();
    
    res.json({ success: true, message: 'Hard reset triggered. The server is restarting...' });
    
    // Crash the process intentionally so Railway/Docker restarts it
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (err) {
    logger.error(`postHardReset failed: ${err.message}`);
    next(err);
  }
}

async function postAdminLogin(req, res, next) {
  try {
    const { username, password } = req.body || {};
    const result = await authService.adminLogin(username, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── Bulk Messaging Endpoints ──

const bulkService = require('../services/bulkService');

async function postBulkUpload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const result = bulkService.parseFile(req.file.buffer, req.file.originalname);
    res.json({
      success: true,
      headers: result.headers,
      normalizedHeaders: result.normalizedHeaders,
      rows: result.rows,
      totalRows: result.rows.length,
      phoneColumn: result.phoneColumn,
      nameColumn: result.nameColumn,
    });
  } catch (err) {
    logger.error(`postBulkUpload failed: ${err.message}`);
    res.status(400).json({ success: false, error: err.message });
  }
}

async function postBulkGenerateTemplate(req, res, next) {
  try {
    const { purpose, columns, sampleRow } = req.body || {};
    if (!purpose || !columns || !sampleRow) {
      return res.status(400).json({ success: false, error: 'Missing purpose, columns, or sampleRow' });
    }
    const template = await bulkService.generateTemplate(purpose, columns, sampleRow);
    res.json({ success: true, template });
  } catch (err) {
    logger.error(`postBulkGenerateTemplate failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function postBulkSend(req, res, next) {
  try {
    const { template, rows, phoneColumn, countryCode } = req.body || {};
    if (!template || !rows || !phoneColumn) {
      return res.status(400).json({ success: false, error: 'Missing template, rows, or phoneColumn' });
    }
    const result = await bulkService.startBulkSend(
      template, rows, phoneColumn, countryCode || '91', whatsappService
    );
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`postBulkSend failed: ${err.message}`);
    res.status(400).json({ success: false, error: err.message });
  }
}

async function getBulkProgress(req, res) {
  const progress = bulkService.getProgress();
  res.json({ success: true, ...progress });
}

async function postBulkCancel(req, res) {
  const cancelled = bulkService.cancelJob();
  res.json({ success: true, cancelled });
}

// ── Writing Style Cloning ──
const styleCloneService = require('../services/styleCloneService');

async function postCloneChatStyle(req, res, next) {
  try {
    const { chatId, target } = req.body || {};
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'Missing chatId parameter' });
    }
    const generatedRules = await styleCloneService.cloneStyle(chatId, target || 'me');
    res.json({ success: true, generatedRules });
  } catch (err) {
    logger.error(`postCloneChatStyle failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getRoot,
  getHealth,
  postSend,
  postChat,
  postReset,
  getStats,
  getDashboardStatus,
  postReconnect,
  getConfig,
  putConfig,
  getSchedulerStatus,
  postTriggerScheduler,
  getAvailableChats,
  postExtractChannelId,
  getQuotes,
  putQuotes,
  postRequestOtp,
  postVerifyOtp,
  postPairingCode,
  postAdminLogin,
  postHardReset,
  postBulkUpload,
  postBulkGenerateTemplate,
  postBulkSend,
  getBulkProgress,
  postBulkCancel,
  postCloneChatStyle,
};
