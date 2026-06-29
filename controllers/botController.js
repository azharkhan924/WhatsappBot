// controllers/botController.js
// Business logic for each REST endpoint. Routes stay thin; logic lives here.

const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const botConfigService = require('../services/botConfigService');
const conversationMemory = require('../memory/conversationMemory');
const provider = require('../providers');
const logger = require('../utils/logger');

const VERSION = require('../package.json').version;
const START_TIME = Date.now();

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
  const updated = botConfigService.updateConfig(req.body || {});
  res.json(updated);
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
};
