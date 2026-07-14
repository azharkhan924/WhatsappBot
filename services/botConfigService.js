// services/botConfigService.js
// Manages dynamic configuration for the dashboard (botEnabled, holdingReply, whitelist, systemPrompt).
// Persists settings to memory/botConfig.json and syncs systemPrompt with prompts/systemPrompt.txt.

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

const CONFIG_FILE = path.join(config.dataDir, 'botConfig.json');
const SYSTEM_PROMPT_FILE = path.join(config.dataDir, 'systemPrompt.txt');

const defaultConfig = {
  botEnabled: true,
  whitelistEnabled: true,
  blacklistEnabled: false,
  holdingReply: 'Yeh wala main personally dekh ke reply karunga, thoda wait karo',
  whitelist: [],
  blacklist: [],
  // Scheduler settings (dashboard overrides for .env defaults)
  schedulerEnabled: undefined,
  schedulerCron: '',
  schedulerTimezone: '',
  schedulerTargetGroups: [],
  schedulerTargetChannels: [],
  schedulerAdImageDir: '',
  schedulerAdCaption: '',
  schedulerQuoteMode: 'local', // 'local' or 'ai_prompt'
  schedulerQuotePrompt: '',
  schedulerCaptionMode: 'static', // 'static' or 'ai_prompt'
  schedulerCaptionPrompt: '',
  // Admin alert & AI mute settings
  adminNotifyNumber: '',
  autoPauseDurationHours: 12,
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
      saveConfigFile();
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
  if (typeof updates.blacklistEnabled === 'boolean') {
    currentConfig.blacklistEnabled = updates.blacklistEnabled;
  }
  if (typeof updates.holdingReply === 'string') {
    currentConfig.holdingReply = updates.holdingReply;
  }
  if (Array.isArray(updates.whitelist)) {
    // Ensure array of strings, clean phone numbers
    currentConfig.whitelist = updates.whitelist.map((num) => String(num).trim()).filter(Boolean);
  }
  if (Array.isArray(updates.blacklist)) {
    // Ensure array of strings, clean phone numbers
    currentConfig.blacklist = updates.blacklist.map((num) => String(num).trim()).filter(Boolean);
  }
  if (typeof updates.systemPrompt === 'string') {
    updateSystemPrompt(updates.systemPrompt);
  }

  // Scheduler settings
  if (typeof updates.schedulerEnabled === 'boolean') {
    currentConfig.schedulerEnabled = updates.schedulerEnabled;
  }
  if (typeof updates.schedulerCron === 'string') {
    currentConfig.schedulerCron = updates.schedulerCron;
  }
  if (typeof updates.schedulerTimezone === 'string') {
    currentConfig.schedulerTimezone = updates.schedulerTimezone;
  }
  if (Array.isArray(updates.schedulerTargetGroups)) {
    currentConfig.schedulerTargetGroups = updates.schedulerTargetGroups.map((s) => String(s).trim()).filter(Boolean);
  }
  if (Array.isArray(updates.schedulerTargetChannels)) {
    currentConfig.schedulerTargetChannels = updates.schedulerTargetChannels.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof updates.schedulerAdImageDir === 'string') {
    currentConfig.schedulerAdImageDir = updates.schedulerAdImageDir;
  }
  if (typeof updates.schedulerAdCaption === 'string') {
    currentConfig.schedulerAdCaption = updates.schedulerAdCaption;
  }
  if (typeof updates.schedulerQuoteMode === 'string') {
    currentConfig.schedulerQuoteMode = updates.schedulerQuoteMode;
  }
  if (typeof updates.schedulerQuotePrompt === 'string') {
    currentConfig.schedulerQuotePrompt = updates.schedulerQuotePrompt;
  }
  if (typeof updates.schedulerCaptionMode === 'string') {
    currentConfig.schedulerCaptionMode = updates.schedulerCaptionMode;
  }
  if (typeof updates.schedulerCaptionPrompt === 'string') {
    currentConfig.schedulerCaptionPrompt = updates.schedulerCaptionPrompt;
  }
  if (typeof updates.adminNotifyNumber === 'string') {
    const trimmed = updates.adminNotifyNumber.trim();
    if (trimmed.includes('@')) {
      currentConfig.adminNotifyNumber = trimmed;
    } else {
      currentConfig.adminNotifyNumber = trimmed.replace(/[^0-9]/g, '');
    }
  }
  if (updates.autoPauseDurationHours !== undefined) {
    const num = parseInt(updates.autoPauseDurationHours, 10);
    currentConfig.autoPauseDurationHours = isNaN(num) ? 12 : num;
  }

  saveConfigFile();
  return getConfig();
}

module.exports = {
  getConfig,
  updateConfig,
  getSystemPrompt,
};
