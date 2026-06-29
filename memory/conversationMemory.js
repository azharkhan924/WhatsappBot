// memory/conversationMemory.js
// In-RAM conversation memory using node-cache.
// Each user (WhatsApp chat id) has a rolling window of the last N messages.
// Entries automatically expire after MEMORY_TIMEOUT_MINUTES of inactivity.
// node-cache's built-in TTL + checkperiod handles automatic cleanup (no memory leak).

const NodeCache = require('node-cache');
const config = require('../config');
const logger = require('../utils/logger');

const ttlSeconds = config.memory.timeoutMinutes * 60;

const cache = new NodeCache({
  stdTTL: ttlSeconds,
  checkperiod: Math.max(60, Math.floor(ttlSeconds / 4)),
  useClones: false,
});

cache.on('expired', (key) => {
  logger.info(`Conversation memory expired for ${key}`);
});

/**
 * Get conversation history for a user.
 * @param {string} userId
 * @returns {Array<{role: 'user'|'assistant', content: string, timestamp: number}>}
 */
function getHistory(userId) {
  return cache.get(userId) || [];
}

/**
 * Append a message to a user's conversation history, trimming to MEMORY_LIMIT.
 * @param {string} userId
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
function addMessage(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content, timestamp: Date.now() });

  const trimmed = history.slice(-config.memory.limit);
  cache.set(userId, trimmed, ttlSeconds);
  return trimmed;
}

/**
 * Reset (clear) conversation history for a user.
 * @param {string} userId
 */
function resetHistory(userId) {
  cache.del(userId);
}

/**
 * Get basic stats about memory usage.
 */
function getStats() {
  return {
    activeConversations: cache.keys().length,
    ttlSeconds,
    memoryLimit: config.memory.limit,
  };
}

module.exports = {
  getHistory,
  addMessage,
  resetHistory,
  getStats,
};
