// providers/NvidiaProvider.js
// NVIDIA NIM implementation of AIProvider, using the OpenAI-compatible chat completions endpoint.
// Get your API key from https://build.nvidia.com

const axios = require('axios');
const AIProvider = require('./AIProvider');
const config = require('../config');
const logger = require('../utils/logger');

const BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

class NvidiaProvider extends AIProvider {
  constructor() {
    super();
    this.apiKey = config.ai.nvidia.apiKey;
    this.model = config.ai.nvidia.model;

    if (!this.apiKey) {
      logger.error('NVIDIA_API_KEY is not set. NVIDIA provider will fail at request time.');
    }
  }

  getName() {
    return `nvidia:${this.model}`;
  }

  async generateReply({ systemPrompt, history, userMessage, maxTokens }) {
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

    const response = await axios.post(BASE_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: config.ai.timeoutMs,
    });

    const choices = response.data && response.data.choices;
    if (!choices || choices.length === 0 || !choices[0].message) {
      throw new Error('NVIDIA API returned no choices');
    }

    return choices[0].message.content.trim();
  }
}

module.exports = NvidiaProvider;
