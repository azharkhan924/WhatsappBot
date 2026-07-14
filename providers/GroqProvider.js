// providers/GroqProvider.js
// Groq implementation of AIProvider, using the OpenAI-compatible chat completions endpoint.

const axios = require('axios');
const AIProvider = require('./AIProvider');
const config = require('../config');
const logger = require('../utils/logger');

const BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

class GroqProvider extends AIProvider {
  constructor() {
    super();
    this.apiKeys = config.ai.groq.apiKeys || [];
    // For backward compatibility, fallback to apiKey if apiKeys is empty
    if (this.apiKeys.length === 0 && config.ai.groq.apiKey) {
      this.apiKeys.push(config.ai.groq.apiKey);
    }
    this.model = config.ai.groq.model;
    this.currentKeyIndex = 0;

    if (this.apiKeys.length === 0) {
      logger.error('No Groq API keys are configured. Groq provider will fail at request time.');
    } else {
      logger.info(`Groq provider initialized with ${this.apiKeys.length} API keys.`);
    }
  }

  getName() {
    return `groq:${this.model}`;
  }

  async generateReply({ systemPrompt, history, userMessage, maxTokens }) {
    if (this.apiKeys.length === 0) {
      throw new Error('No Groq API keys are configured.');
    }

    const messages = [{ role: 'system', content: systemPrompt }];

    for (const item of history) {
      messages.push({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: item.content,
      });
    }
    messages.push({ role: 'user', content: userMessage });

    const payload = {
      model: this.model,
      messages,
      temperature: config.ai.temperature,
      max_tokens: maxTokens || config.ai.maxTokens,
    };

    let lastError = null;
    const startIdx = this.currentKeyIndex;

    for (let i = 0; i < this.apiKeys.length; i++) {
      const idx = (startIdx + i) % this.apiKeys.length;
      const apiKey = this.apiKeys[idx];

      try {
        const response = await axios.post(BASE_URL, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: config.ai.timeoutMs,
        });

        // Successful request: save current index for next time (or stick to it)
        this.currentKeyIndex = idx;

        const choices = response.data && response.data.choices;
        if (!choices || choices.length === 0 || !choices[0].message) {
          throw new Error('Groq API returned no choices');
        }

        return choices[0].message.content.trim();
      } catch (err) {
        lastError = err;
        const isRateLimit = (err.response && err.response.status === 429) || (err.message && err.message.includes('429'));

        logger.warn(
          `Groq API key index ${idx} failed (Rate limit error: ${isRateLimit}): ${err.message}`
        );

        // Move the index forward to rotate on next attempt
        this.currentKeyIndex = (idx + 1) % this.apiKeys.length;
      }
    }

    throw lastError || new Error('All Groq API keys failed');
  }
}

module.exports = GroqProvider;
