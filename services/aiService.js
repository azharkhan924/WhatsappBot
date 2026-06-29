// services/aiService.js
// Wraps the active AI provider with retry logic, timeout handling, and consistent error fallback.

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const provider = require('../providers');

const FALLBACK_REPLY = "Sorry, I'm unable to answer right now. Please try again later.";
const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'systemPrompt.txt');

let cachedSystemPrompt = null;

function loadSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  try {
    cachedSystemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8').trim();
  } catch (err) {
    logger.error(`Failed to load system prompt, using default. ${err.message}`);
    cachedSystemPrompt = 'You are a helpful WhatsApp assistant.';
  }
  return cachedSystemPrompt;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate an AI reply with retry (up to config.ai.maxRetries extra attempts)
 * and a guaranteed safe fallback message on persistent failure. Never throws.
 *
 * @param {string} userId
 * @param {string} userMessage
 * @param {Array} history
 * @returns {Promise<{reply: string, latencyMs: number, failed: boolean}>}
 */
async function generateReply(userId, userMessage, history) {
  const systemPrompt = loadSystemPrompt();
  const startTime = Date.now();

  let lastError = null;
  const totalAttempts = config.ai.maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const reply = await provider.generateReply({ systemPrompt, history, userMessage });
      const latencyMs = Date.now() - startTime;

      logger.info(
        `AI reply generated for ${userId} via ${provider.getName()} in ${latencyMs}ms (attempt ${attempt})`
      );

      return { reply, latencyMs, failed: false };
    } catch (err) {
      lastError = err;
      logger.error(
        `AI provider (${provider.getName()}) attempt ${attempt}/${totalAttempts} failed for ${userId}: ${err.message}`
      );

      if (attempt < totalAttempts) {
        await sleep(500 * attempt); // small backoff before retrying
      }
    }
  }

  const latencyMs = Date.now() - startTime;
  logger.error(
    `AI provider exhausted all ${totalAttempts} attempts for ${userId}. Last error: ${lastError && lastError.message}`
  );

  return { reply: FALLBACK_REPLY, latencyMs, failed: true };
}

module.exports = {
  generateReply,
  loadSystemPrompt,
  FALLBACK_REPLY,
};
