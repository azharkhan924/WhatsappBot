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
    this.apiKey = config.ai.gemini.apiKey;
    this.model = config.ai.gemini.model;

    if (!this.apiKey) {
      logger.error('GEMINI_API_KEY is not set. Gemini provider will fail at request time.');
    }
  }

  getName() {
    return `gemini:${this.model}`;
  }

  async generateReply({ systemPrompt, history, userMessage }) {
    const url = `${BASE_URL}/${this.model}:generateContent?key=${this.apiKey}`;

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
        maxOutputTokens: config.ai.maxTokens,
      },
    };

    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: config.ai.timeoutMs,
    });

    const candidates = response.data && response.data.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error('Gemini API returned no candidates');
    }

    const parts = candidates[0].content && candidates[0].content.parts;
    if (!parts || parts.length === 0 || !parts[0].text) {
      throw new Error('Gemini API returned an empty response');
    }

    return parts.map((p) => p.text).join('').trim();
  }
}

module.exports = GeminiProvider;
