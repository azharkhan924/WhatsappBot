// config/index.js
// Centralized configuration loaded from environment variables.
// Everything in the app should read config from here, never from process.env directly.

require('dotenv').config();

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toFloat(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),

  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
    temperature: toFloat(process.env.TEMPERATURE, 0.7),
    maxTokens: toInt(process.env.MAX_TOKENS, 512),
    timeoutMs: toInt(process.env.AI_TIMEOUT_MS, 15000),
    maxRetries: toInt(process.env.AI_MAX_RETRIES, 2),
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      apiKeys: (() => {
        const keys = [];
        if (process.env.GEMINI_API_KEYS) {
          keys.push(...process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean));
        }
        if (process.env.GEMINI_API_KEY) {
          keys.push(...process.env.GEMINI_API_KEY.split(',').map(k => k.trim()).filter(Boolean));
        }
        let i = 2;
        while (process.env[`GEMINI_API_KEY_${i}`]) {
          keys.push(process.env[`GEMINI_API_KEY_${i}`].trim());
          i++;
        }
        return [...new Set(keys)];
      })(),
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY || '',
      apiKeys: (() => {
        const keys = [];
        if (process.env.GROQ_API_KEYS) {
          keys.push(...process.env.GROQ_API_KEYS.split(',').map(k => k.trim()).filter(Boolean));
        }
        if (process.env.GROQ_API_KEY) {
          keys.push(...process.env.GROQ_API_KEY.split(',').map(k => k.trim()).filter(Boolean));
        }
        let i = 2;
        while (process.env[`GROQ_API_KEY_${i}`]) {
          keys.push(process.env[`GROQ_API_KEY_${i}`].trim());
          i++;
        }
        return [...new Set(keys)];
      })(),
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    },
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY || '',
      model: process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
    },
  },

  memory: {
    limit: toInt(process.env.MEMORY_LIMIT, 20),
    timeoutMinutes: toInt(process.env.MEMORY_TIMEOUT_MINUTES, 30),
  },

  humanBehaviour: {
    typingDelayMinMs: toInt(process.env.TYPING_DELAY_MIN_MS, 2000),
    typingDelayMaxMs: toInt(process.env.TYPING_DELAY_MAX_MS, 5000),
  },

  security: {
    rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    rateLimitMaxRequests: toInt(process.env.RATE_LIMIT_MAX_REQUESTS, 30),
    apiKey: process.env.API_KEY || '',
    dashboardKey: process.env.DASHBOARD_KEY || process.env.API_KEY || '',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  whatsapp: {
    clientId: process.env.WA_CLIENT_ID || 'whatsapp-bot-session',
    ignoreGroups: toBool(process.env.IGNORE_GROUPS, false),
  },
};

module.exports = config;
