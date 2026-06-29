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
    this.apiKey = config.ai.groq.apiKey;
    this.model = config.ai.groq.model;

    if (!this.apiKey) {
      logger.error('GROQ_API_KEY is not set. Groq provider will fail at request time.');
    }
  }

  getName() {
    return `groq:${this.model}`;
  }

  async generateReply({ systemPrompt, history, userMessage }) {
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
      max_tokens: config.ai.maxTokens,
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
      throw new Error('Groq API returned no choices');
    }

    return choices[0].message.content.trim();
  }
}

module.exports = GroqProvider;
