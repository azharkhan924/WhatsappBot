// services/muteService.js
// Handles temporary muting of the AI bot when users request a human.
// Persists the muted status to a JSON file in the data/ directory.

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const MUTE_FILE = path.join(__dirname, '..', 'data', 'mutedUsers.json');
let mutedUsers = {};

function loadMutes() {
  try {
    if (fs.existsSync(MUTE_FILE)) {
      const data = fs.readFileSync(MUTE_FILE, 'utf-8');
      mutedUsers = JSON.parse(data);
      
      // Clean up any expired mutes on startup
      const now = Date.now();
      let updated = false;
      for (const [userId, expiresAt] of Object.entries(mutedUsers)) {
        if (now > expiresAt) {
          delete mutedUsers[userId];
          updated = true;
        }
      }
      if (updated) {
        saveMutes();
      }
    }
  } catch (err) {
    logger.error(`Failed to load muted users: ${err.message}`);
  }
}

function saveMutes() {
  try {
    const dir = path.dirname(MUTE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MUTE_FILE, JSON.stringify(mutedUsers, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`Failed to save muted users: ${err.message}`);
  }
}

function muteUser(userId, hours) {
  const expiresAt = Date.now() + hours * 60 * 60 * 1000;
  mutedUsers[userId] = expiresAt;
  saveMutes();
  logger.info(`AI muted for user ${userId} for ${hours} hours (expires at ${new Date(expiresAt).toISOString()})`);
}

function unmuteUser(userId) {
  if (mutedUsers[userId]) {
    delete mutedUsers[userId];
    saveMutes();
    logger.info(`AI unmuted for user ${userId}`);
  }
}

function isUserMuted(userId) {
  const expiresAt = mutedUsers[userId];
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    delete mutedUsers[userId];
    saveMutes();
    return false;
  }
  return true;
}

function getMutedUsers() {
  const now = Date.now();
  const list = [];
  for (const [userId, expiresAt] of Object.entries(mutedUsers)) {
    if (now <= expiresAt) {
      list.push({ userId, expiresAt });
    }
  }
  return list;
}

module.exports = {
  loadMutes,
  muteUser,
  unmuteUser,
  isUserMuted,
  getMutedUsers,
};
