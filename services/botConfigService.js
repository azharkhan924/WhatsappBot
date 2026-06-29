// services/botConfigService.js
// Manages dynamic configuration for the dashboard (botEnabled, holdingReply, whitelist, systemPrompt).
// Persists settings to memory/botConfig.json and syncs systemPrompt with prompts/systemPrompt.txt.

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const CONFIG_FILE = path.join(__dirname, '..', 'memory', 'botConfig.json');
const SYSTEM_PROMPT_FILE = path.join(__dirname, '..', 'prompts', 'systemPrompt.txt');

const defaultConfig = {
  botEnabled: true,
  whitelistEnabled: true,
  holdingReply: 'Yeh wala main personally dekh ke reply karunga, thoda wait karo',
  whitelist: [],
};

let currentConfig = { ...defaultConfig };

function initConfig() {
  try {
    const memoryDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      currentConfig = { ...defaultConfig, ...parsed };
    } else {
      saveConfigFile();
    }
  } catch (err) {
    logger.error(`Failed to load botConfig.json: ${err.message}`);
  }
}

function saveConfigFile() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`Failed to save botConfig.json: ${err.message}`);
  }
}

function getSystemPrompt() {
  try {
    if (fs.existsSync(SYSTEM_PROMPT_FILE)) {
      return fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf-8').trim();
    }
  } catch (err) {
    logger.error(`Failed to read system prompt file: ${err.message}`);
  }
  return 'You are a helpful WhatsApp assistant.';
}

function updateSystemPrompt(newPrompt) {
  try {
    const dir = path.dirname(SYSTEM_PROMPT_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SYSTEM_PROMPT_FILE, newPrompt, 'utf-8');
  } catch (err) {
    logger.error(`Failed to update system prompt file: ${err.message}`);
  }
}

initConfig();

function getConfig() {
  return {
    ...currentConfig,
    systemPrompt: getSystemPrompt(),
  };
}

function updateConfig(updates) {
  if (typeof updates.botEnabled === 'boolean') {
    currentConfig.botEnabled = updates.botEnabled;
  }
  if (typeof updates.whitelistEnabled === 'boolean') {
    currentConfig.whitelistEnabled = updates.whitelistEnabled;
  }
  if (typeof updates.holdingReply === 'string') {
    currentConfig.holdingReply = updates.holdingReply;
  }
  if (Array.isArray(updates.whitelist)) {
    // Ensure array of strings, clean phone numbers
    currentConfig.whitelist = updates.whitelist.map((num) => String(num).trim()).filter(Boolean);
  }
  if (typeof updates.systemPrompt === 'string') {
    updateSystemPrompt(updates.systemPrompt);
  }

  saveConfigFile();
  return getConfig();
}

module.exports = {
  getConfig,
  updateConfig,
  getSystemPrompt,
};
