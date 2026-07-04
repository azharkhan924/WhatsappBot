// services/quoteService.js
// Fetches a daily motivational quote from ZenQuotes API with a local .txt fallback.
// Caches the result for the current day to avoid redundant API calls.

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const QUOTES_FILE = path.join(__dirname, '..', 'data', 'quotes.txt');
const API_URL = 'https://zenquotes.io/api/today';
const API_TIMEOUT_MS = 8000;

let cachedQuote = null;
let cachedDate = null;

/**
 * Load quotes from the local .txt fallback file.
 * Expected format: one quote per line, "text | author"
 */
function loadLocalQuotes() {
  try {
    if (!fs.existsSync(QUOTES_FILE)) {
      logger.warn(`Quotes fallback file not found: ${QUOTES_FILE}`);
      return [];
    }
    const raw = fs.readFileSync(QUOTES_FILE, 'utf-8');
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    return lines.map((line) => {
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
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Return cached quote if it's still the same day
  if (cachedQuote && cachedDate === today) {
    return cachedQuote;
  }

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
    cachedQuote = available[idx];
    
    // Track as sent
    state.sentQuotes.push(cachedQuote.text);
    saveState(state);

    cachedDate = today;
    logger.info(`Using unique local quote: "${cachedQuote.text}" — ${cachedQuote.author}`);
    return cachedQuote;
  }

  // 2. Fallback to API if local file is empty
  try {
    const response = await axios.get(API_URL, { timeout: API_TIMEOUT_MS });
    const data = response.data;

    if (Array.isArray(data) && data.length > 0 && data[0].q) {
      cachedQuote = {
        text: data[0].q,
        author: data[0].a || 'Unknown',
      };
      cachedDate = today;
      logger.info(`Fetched daily quote from API: "${cachedQuote.text}" — ${cachedQuote.author}`);
      return cachedQuote;
    }
  } catch (err) {
    logger.warn(`ZenQuotes API failed: ${err.message}`);
  }

  // 3. Absolute fallback
  cachedQuote = {
    text: 'Every day is a new beginning. Take a deep breath, smile, and start again.',
    author: 'Unknown',
  };
  cachedDate = today;
  return cachedQuote;
}

/**
 * Force-clear the cache so the next call fetches fresh.
 */
function clearCache() {
  cachedQuote = null;
  cachedDate = null;
}

module.exports = {
  getQuoteOfTheDay,
  clearCache,
};
