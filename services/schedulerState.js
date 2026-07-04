// services/schedulerState.js
// Tracks which quotes and images have been sent to ensure uniqueness until all are exhausted.

const fs = require('fs');
const path = require('path');
const config = require('../config');

const STATE_FILE = path.join(config.dataDir, 'schedulerState.json');

function getState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch (err) {
      // Return default if file is corrupted
    }
  }
  return { sentQuotes: [], sentImages: [] };
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save scheduler state:', err);
  }
}

module.exports = {
  getState,
  saveState,
};
