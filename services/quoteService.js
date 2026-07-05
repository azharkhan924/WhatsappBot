// services/quoteService.js
// Fetches a daily motivational quote from ZenQuotes API with a local .txt fallback.
// Caches the result for the current day to avoid redundant API calls.

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

const QUOTES_FILE = path.join(config.dataDir, 'quotes.txt');
const API_URL = 'https://zenquotes.io/api/random';
const API_TIMEOUT_MS = 8000;

/**
 * Load quotes from the local .txt fallback file.
 * Expected format: one quote per line, "text | author"
 */
const { parseNumberedList } = require('../utils/parser');

/**
 * Load quotes from the local .txt fallback file.
 * Expected format: one quote per line, "text | author", OR a numbered list
 */
function loadLocalQuotes() {
  try {
    if (!fs.existsSync(QUOTES_FILE)) {
      logger.warn(`Quotes fallback file not found: ${QUOTES_FILE}`);
      return [];
    }
    const raw = fs.readFileSync(QUOTES_FILE, 'utf-8');
    
    // Parse using numbered list helper first if the pattern exists
    const numberedList = parseNumberedList(raw);
    let items = [];
    if (numberedList) {
      items = numberedList;
    } else {
      items = raw
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }

    return items.map((line) => {
      const parts = line.split('|');
      const text = (parts[0] || '').trim();
      const author = (parts[1] || 'Unknown').trim();
      return { text, author };
    });
  } catch (err) {
    logger.error(`Failed to load local quotes: ${err.message}`);
    return [];
  }
}

const { getState, saveState } = require('./schedulerState');

/**
 * Fetch the quote of the day.
 * Prioritizes local quotes to ensure uniqueness, falls back to API.
 */
async function getQuoteOfTheDay() {

  // 1. Try local .txt file first (guarantees uniqueness)
  const localQuotes = loadLocalQuotes();
  if (localQuotes.length > 0) {
    const state = getState();
    let available = localQuotes.filter(q => !state.sentQuotes.includes(q.text));
    
    // If all quotes have been sent, recycle them
    if (available.length === 0) {
      logger.info('All local quotes have been sent. Recycling quotes list.');
      state.sentQuotes = [];
      available = localQuotes;
    }
    
    // Pick first available sequentially or randomly?
    // Let's pick randomly to mix them up
    const idx = Math.floor(Math.random() * available.length);
    const selectedQuote = available[idx];
    
    // Track as sent
    state.sentQuotes.push(selectedQuote.text);
    saveState(state);

    logger.info(`Using unique local quote: "${selectedQuote.text}" — ${selectedQuote.author}`);
    return selectedQuote;
  }

  // 2. Fallback to API if local file is empty
  try {
    const response = await axios.get(API_URL, { timeout: API_TIMEOUT_MS });
    const data = response.data;

    if (Array.isArray(data) && data.length > 0 && data[0].q) {
      const apiQuote = {
        text: data[0].q,
        author: data[0].a || 'Unknown',
      };
      logger.info(`Fetched random quote from API: "${apiQuote.text}" — ${apiQuote.author}`);
      return apiQuote;
    }
  } catch (err) {
    logger.warn(`ZenQuotes API failed: ${err.message}`);
  }

  // 3. Absolute fallback
  const fallbacks = [
    { text: 'Every day is a new beginning. Take a deep breath, smile, and start again.', author: 'Unknown' },
    { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { text: 'It always seems impossible until it\'s done.', author: 'Nelson Mandela' },
    { text: 'Your limitation—it\'s only your imagination.', author: 'Unknown' },
    { text: 'Push yourself, because no one else is going to do it for you.', author: 'Unknown' }
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

/**
 * Force-clear the cache so the next call fetches fresh. (Deprecated/No-op)
 */
function clearCache() {
  // No-op
}

module.exports = {
  getQuoteOfTheDay,
  clearCache,
};
