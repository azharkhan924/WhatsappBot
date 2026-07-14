// providers/GeminiProvider.js
// Google Gemini implementation of AIProvider, using the REST generateContent API directly via axios
// (avoids adding the @google/generative-ai SDK as a dependency, keeping the stack minimal).

const axios = require('axios');
const AIProvider = require('./AIProvider');
const config = require('../config');
const logger = require('../utils/logger');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiProvider extends AIProvider {
  constructor() {
    super();
    this.apiKeys = config.ai.gemini.apiKeys || [];
    // For backward compatibility, fallback to apiKey if apiKeys is empty
    if (this.apiKeys.length === 0 && config.ai.gemini.apiKey) {
      this.apiKeys.push(config.ai.gemini.apiKey);
    }
    this.model = config.ai.gemini.model;
    this.currentKeyIndex = 0;

    if (this.apiKeys.length === 0) {
      logger.error('No Gemini API keys are configured. Gemini provider will fail at request time.');
    } else {
      logger.info(`Gemini provider initialized with ${this.apiKeys.length} API keys.`);
    }
  }

  getName() {
    return `gemini:${this.model}`;
  }

  async generateReply({ systemPrompt, history, userMessage, maxTokens }) {
    if (this.apiKeys.length === 0) {
      throw new Error('No Gemini API keys are configured.');
    }

    // Map our internal history format to Gemini's "contents" format.
    const contents = [];
    for (const item of history) {
      contents.push({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content }],
      });
    }
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const payload = {
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: config.ai.temperature,
        maxOutputTokens: maxTokens || config.ai.maxTokens,
      },
    };

    let lastError = null;
    const startIdx = this.currentKeyIndex;

    for (let i = 0; i < this.apiKeys.length; i++) {
      const idx = (startIdx + i) % this.apiKeys.length;
      const apiKey = this.apiKeys[idx];
      const url = `${BASE_URL}/${this.model}:generateContent?key=${apiKey}`;

      try {
        const response = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: config.ai.timeoutMs,
        });

        // Successful request: save current index for next time (or stick to it)
        this.currentKeyIndex = idx;

        const candidates = response.data && response.data.candidates;
        if (!candidates || candidates.length === 0) {
          throw new Error('Gemini API returned no candidates');
        }

        const parts = candidates[0].content && candidates[0].content.parts;
        if (!parts || parts.length === 0 || !parts[0].text) {
          throw new Error('Gemini API returned an empty response');
        }

        return parts.map((p) => p.text).join('').trim();
      } catch (err) {
        lastError = err;
        const isRateLimit = (err.response && err.response.status === 429) || (err.message && err.message.includes('429'));
        
        logger.warn(
          `Gemini API key index ${idx} failed (Rate limit error: ${isRateLimit}): ${err.message}`
        );

        // Move the index forward to rotate on next attempt
        this.currentKeyIndex = (idx + 1) % this.apiKeys.length;
      }
    }

    throw lastError || new Error('All Gemini API keys failed');
  }
}

module.exports = GeminiProvider;
