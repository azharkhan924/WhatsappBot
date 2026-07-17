// services/aiService.js
// Wraps the active AI provider with retry logic, timeout handling, and consistent error fallback.
// When the primary provider is rate-limited (429), automatically falls back to the secondary provider.

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const primaryProvider = require('../providers');

// ── Fallback providers setup ──
// Ordered by performance: Gemini 2.5 Flash > Groq Llama 3.3 70B > NVIDIA Llama 3.1 70B
// When the primary is rate-limited, fallbacks are tried in order.
let fallbackProviders = [];
try {
  const GeminiProvider = require('../providers/GeminiProvider');
  const GroqProvider = require('../providers/GroqProvider');
  const NvidiaProvider = require('../providers/NvidiaProvider');

  // Performance-ranked for TEXT generation: Groq (fastest) → Gemini → NVIDIA
  // Gemini keys are primarily reserved for image generation
  const ranked = [
    { name: 'groq',    check: () => config.ai.groq.apiKey && config.ai.groq.apiKey !== 'your_groq_api_key_here', create: () => new GroqProvider() },
    { name: 'gemini',  check: () => config.ai.gemini.apiKey, create: () => new GeminiProvider() },
    { name: 'nvidia',  check: () => config.ai.nvidia.apiKey && config.ai.nvidia.apiKey !== 'your_nvidia_api_key_here', create: () => new NvidiaProvider() },
  ];

  for (const entry of ranked) {
    if (entry.name !== config.ai.provider && entry.check()) {
      fallbackProviders.push(entry.create());
    }
  }

  if (fallbackProviders.length > 0) {
    logger.info(`Fallback AI providers (in order): ${fallbackProviders.map(p => p.getName()).join(' → ')}`);
  }
} catch (err) {
  logger.warn(`Could not set up fallback providers: ${err.message}`);
}

const botConfigService = require('./botConfigService');
const FALLBACK_REPLY = "Sorry, I'm unable to answer right now. Please try again later.";

function loadSystemPrompt() {
  let basePrompt = botConfigService.getSystemPrompt();
  const cfg = botConfigService.getConfig();
  if (cfg.holdingReply) {
    basePrompt = `${basePrompt}\n\n# Dynamic Holding Reply Instructions\nIf the user asks about meetings, money, personal commitments, or anything requiring personal confirmation, reply with: "${cfg.holdingReply}"`;
  }
  // Append instruction to offer #human option if user is confused or AI cannot solve the problem
  basePrompt = `${basePrompt}\n\n# Confusion / Human Agent Handover Instructions\nIf the user seems confused, keeps repeating questions, is frustrated, or explicitly asks to speak with a human agent directly, you MUST politely offer them the choice to pause the AI and request a human response. Instruct them to reply with exactly the word "#human" (with the hash symbol) to pause the bot and notify the admin. Example: "If you want to pause this AI bot and chat with an admin directly, please reply with #human."`;
  return basePrompt;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  if (err.response && err.response.status === 429) return true;
  if (err.message && err.message.includes('429')) return true;
  return false;
}

/**
 * Try generating a reply with the given provider.
 * On 429 (rate limit), immediately gives up so the fallback chain kicks in fast.
 */
async function tryProvider(providerInstance, userId, systemPrompt, history, userMessage) {
  const totalAttempts = config.ai.maxRetries + 1;

  let lastError = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const reply = await providerInstance.generateReply({ systemPrompt, history, userMessage });
      return { reply, failed: false };
    } catch (err) {
      lastError = err;
      logger.error(
        `AI provider (${providerInstance.getName()}) attempt ${attempt}/${totalAttempts} failed for ${userId}: ${err.message}`
      );

      // 429 = rate limited. Don't waste time retrying — jump to fallback immediately.
      if (isRateLimitError(err)) {
        logger.warn(`Rate limited (429) on ${providerInstance.getName()}. Skipping to next provider.`);
        return { reply: null, failed: true, lastError: err, rateLimited: true };
      }

      if (attempt < totalAttempts) {
        await sleep(500 * attempt);
      }
    }
  }

  return { reply: null, failed: true, lastError, rateLimited: false };
}

/**
 * Generate an AI reply with retry and automatic fallback.
 * Never throws.
 */
async function generateReply(userId, userMessage, history) {
  const systemPrompt = loadSystemPrompt();
  const startTime = Date.now();

  // ── Try primary provider ──
  const primary = await tryProvider(primaryProvider, userId, systemPrompt, history, userMessage);

  if (!primary.failed) {
    const latencyMs = Date.now() - startTime;
    logger.info(
      `AI reply generated for ${userId} via ${primaryProvider.getName()} in ${latencyMs}ms`
    );
    return { reply: primary.reply, latencyMs, failed: false };
  }

  logger.error(
    `Primary provider (${primaryProvider.getName()}) exhausted all attempts for ${userId}. Last error: ${primary.lastError && primary.lastError.message}`
  );

  // ── Try fallback providers in performance order ──
  if (primary.rateLimited && fallbackProviders.length > 0) {
    for (const fb of fallbackProviders) {
      logger.info(`Trying fallback provider: ${fb.getName()}`);
      const fallback = await tryProvider(fb, userId, systemPrompt, history, userMessage);

      if (!fallback.failed) {
        const latencyMs = Date.now() - startTime;
        logger.info(
          `AI reply generated for ${userId} via FALLBACK ${fb.getName()} in ${latencyMs}ms`
        );
        return { reply: fallback.reply, latencyMs, failed: false };
      }

      logger.error(
        `Fallback provider (${fb.getName()}) also failed for ${userId}: ${fallback.lastError && fallback.lastError.message}`
      );
    }
  }

  const latencyMs = Date.now() - startTime;
  return { reply: FALLBACK_REPLY, latencyMs, failed: true };
}

async function tryOneShotProvider(providerInstance, systemPrompt, userMessage, maxTokens) {
  const totalAttempts = config.ai.maxRetries + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const reply = await providerInstance.generateReply({
        systemPrompt,
        history: [],
        userMessage,
        maxTokens,
      });
      return { reply, failed: false };
    } catch (err) {
      lastError = err;
      logger.error(
        `One-shot provider (${providerInstance.getName()}) attempt ${attempt}/${totalAttempts} failed: ${err.message}`
      );

      // 429 = rate limited. Don't waste time retrying — jump to fallback immediately.
      if (isRateLimitError(err)) {
        logger.warn(`One-shot rate limit (429) on ${providerInstance.getName()}. Skipping provider.`);
        return { reply: null, failed: true, lastError: err, rateLimited: true };
      }

      if (attempt < totalAttempts) {
        await sleep(500 * attempt);
      }
    }
  }

  return { reply: null, failed: true, lastError, rateLimited: false };
}

/**
 * Generic single prompt completion with fallbacks and retry logic.
 * Useful for one-off generations like bulk templates, quote/caption prompts.
 * Automatically handles API key rotation/fallbacks.
 */
async function generateOneShot({ systemPrompt, userMessage, maxTokens }) {
  const startTime = Date.now();

  // Try primary provider first
  const primaryResult = await tryOneShotProvider(primaryProvider, systemPrompt, userMessage, maxTokens);
  if (!primaryResult.failed) {
    logger.info(`One-shot AI generated via primary ${primaryProvider.getName()} in ${Date.now() - startTime}ms`);
    return primaryResult.reply;
  }

  // Try fallbacks in order (even if not strictly a 429, retry on other failures)
  for (const fb of fallbackProviders) {
    logger.info(`One-shot AI trying fallback: ${fb.getName()}`);
    const fbResult = await tryOneShotProvider(fb, systemPrompt, userMessage, maxTokens);
    if (!fbResult.failed) {
      logger.info(`One-shot AI generated via fallback ${fb.getName()} in ${Date.now() - startTime}ms`);
      return fbResult.reply;
    }
  }

  throw primaryResult.lastError || new Error('All AI providers failed to generate response');
}

module.exports = {
  generateReply,
  loadSystemPrompt,
  FALLBACK_REPLY,
  generateOneShot,
};

