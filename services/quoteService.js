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

/**
 * Fetch the quote of the day from the ZenQuotes API.
 * Falls back to a random local quote on failure.
 */
async function getQuoteOfTheDay() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Return cached quote if it's still the same day
  if (cachedQuote && cachedDate === today) {
    return cachedQuote;
  }

  // Try API first
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
    logger.warn(`ZenQuotes API failed, falling back to local quotes: ${err.message}`);
  }

  // Fallback to local .txt file
  const localQuotes = loadLocalQuotes();
  if (localQuotes.length === 0) {
    cachedQuote = {
      text: 'Every day is a new beginning. Take a deep breath, smile, and start again.',
      author: 'Unknown',
    };
  } else {
    const idx = Math.floor(Math.random() * localQuotes.length);
    cachedQuote = localQuotes[idx];
  }
  cachedDate = today;
  logger.info(`Using local fallback quote: "${cachedQuote.text}" — ${cachedQuote.author}`);
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
