// services/schedulerService.js
// Cron-based scheduler that sends a daily motivational quote and an advertisement
// image to configured WhatsApp groups and channels (newsletters).

const cron = require('node-cron');
const { MessageMedia } = require('whatsapp-web.js');
const logger = require('../utils/logger');
const config = require('../config');
const quoteService = require('./quoteService');
const adService = require('./adService');
const botConfigService = require('./botConfigService');

let cronJob = null;
let whatsappServiceRef = null;
let lastRunAt = null;
let lastRunStatus = null;
let lastRunDetails = [];

/**
 * Start the scheduler with a reference to the WhatsApp service.
 */
function startScheduler(whatsappService) {
  whatsappServiceRef = whatsappService;

  const schedulerCfg = getSchedulerConfig();
  if (!schedulerCfg.enabled) {
    logger.info('Scheduler is disabled in config. Skipping cron setup.');
    return;
  }

  const cronExpr = schedulerCfg.cron || '0 9 * * *';
  const timezone = schedulerCfg.timezone || 'Asia/Kolkata';

  if (!cron.validate(cronExpr)) {
    logger.error(`Invalid scheduler cron expression: "${cronExpr}". Scheduler not started.`);
    return;
  }

  stopScheduler(); // clear any previous job

  cronJob = cron.schedule(cronExpr, () => {
    logger.info('Scheduler triggered — sending daily quote + ad image...');
    sendScheduledMessages().catch((err) => {
      logger.error(`Scheduler execution failed: ${err.message}`);
    });
  }, {
    scheduled: true,
    timezone,
  });

  logger.info(`Scheduler started: cron="${cronExpr}", timezone="${timezone}"`);
}

/**
 * Stop the scheduler.
 */
function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('Scheduler stopped.');
  }
}

/**
 * Restart the scheduler with current config (called when config changes from dashboard).
 */
function restartScheduler() {
  if (whatsappServiceRef) {
    startScheduler(whatsappServiceRef);
  }
}

/**
 * Get the merged scheduler config from botConfigService + config/index.js.
 * Dashboard-set values in botConfig override .env defaults.
 */
function getSchedulerConfig() {
  const botCfg = botConfigService.getConfig();
  const envCfg = config.scheduler;

  return {
    enabled: botCfg.schedulerEnabled !== undefined ? botCfg.schedulerEnabled : envCfg.enabled,
    cron: botCfg.schedulerCron || envCfg.cron,
    timezone: botCfg.schedulerTimezone || envCfg.timezone,
    targetGroups: botCfg.schedulerTargetGroups || envCfg.targetGroups,
    targetChannels: botCfg.schedulerTargetChannels || envCfg.targetChannels,
    adImageDir: botCfg.schedulerAdImageDir || envCfg.adImageDir,
    adCaption: botCfg.schedulerAdCaption || '',
  };
}

/**
 * Format the quote into a nice WhatsApp message.
 */
function formatQuoteMessage(quote) {
  return [
    '🌅 *Quote of the Day*',
    '',
    `_"${quote.text}"_`,
    `— *${quote.author}*`,
    '',
    'Have a great day! ✨',
  ].join('\n');
}

/**
 * Resolve target chat IDs from names or IDs.
 * Handles: group IDs (@g.us), channel/newsletter IDs (@newsletter), or chat names.
 */
async function resolveTargets(targets, type) {
  if (!whatsappServiceRef) return [];
  if (!targets || targets.length === 0) return [];

  const client = whatsappServiceRef.getClient();
  if (!client) return [];

  const resolved = [];

  for (const target of targets) {
    const trimmed = target.trim();
    if (!trimmed) continue;

    // Already a full WhatsApp ID
    if (trimmed.includes('@g.us') || trimmed.includes('@newsletter')) {
      resolved.push({ id: trimmed, name: trimmed });
      continue;
    }

    // Try to find by name
    try {
      const chat = await whatsappServiceRef.findChatByName(trimmed);
      if (chat) {
        resolved.push({ id: chat.id._serialized, name: chat.name || trimmed });
      } else {
        logger.warn(`Scheduler: could not find ${type} by name: "${trimmed}"`);
      }
    } catch (err) {
      logger.warn(`Scheduler: error resolving ${type} "${trimmed}": ${err.message}`);
    }
  }

  return resolved;
}

/**
 * Core function: send quote + ad to all configured targets.
 * Can be called by cron or manually via API.
 */
async function sendScheduledMessages() {
  const schedulerCfg = getSchedulerConfig();
  const details = [];
  let overallStatus = 'success';

  // 1. Fetch daily quote
  let quote;
  try {
    quote = await quoteService.getQuoteOfTheDay();
  } catch (err) {
    logger.error(`Failed to fetch daily quote: ${err.message}`);
    quote = { text: 'Every day is a new beginning.', author: 'Unknown' };
  }

  const quoteMessage = formatQuoteMessage(quote);

  // 2. Get ad image
  const adImage = adService.getRandomAdImage(schedulerCfg.adImageDir);

  // 3. Resolve all targets (groups + channels)
  const groupTargets = await resolveTargets(schedulerCfg.targetGroups, 'group');
  const channelTargets = await resolveTargets(schedulerCfg.targetChannels, 'channel');
  const allTargets = [...groupTargets, ...channelTargets];

  if (allTargets.length === 0) {
    logger.warn('Scheduler: no targets configured. Nothing to send.');
    lastRunAt = new Date().toISOString();
    lastRunStatus = 'no_targets';
    lastRunDetails = [{ target: 'none', status: 'skipped', reason: 'No targets configured' }];
    return { status: 'no_targets', details: lastRunDetails };
  }

  // 4. Send to each target
  for (const target of allTargets) {
    const targetDetail = { target: target.name || target.id, status: 'pending' };

    // Send quote text
    try {
      await whatsappServiceRef.sendMessage(target.id, quoteMessage);
      targetDetail.quoteSent = true;
      logger.info(`Scheduler: quote sent to ${target.name || target.id}`);
    } catch (err) {
      targetDetail.quoteSent = false;
      targetDetail.quoteError = err.message;
      overallStatus = 'partial_failure';
      logger.error(`Scheduler: failed to send quote to ${target.name || target.id}: ${err.message}`);
    }

    // Send ad image (if available)
    if (adImage) {
      try {
        await whatsappServiceRef.sendMediaMessage(
          target.id,
          adImage.filePath,
          schedulerCfg.adCaption || ''
        );
        targetDetail.adSent = true;
        logger.info(`Scheduler: ad image sent to ${target.name || target.id}: ${adImage.filename}`);
      } catch (err) {
        targetDetail.adSent = false;
        targetDetail.adError = err.message;
        overallStatus = 'partial_failure';
        logger.error(`Scheduler: failed to send ad to ${target.name || target.id}: ${err.message}`);
      }
    } else {
      targetDetail.adSent = false;
      targetDetail.adError = 'No ad images found in directory';
    }

    targetDetail.status = targetDetail.quoteSent ? 'sent' : 'failed';
    details.push(targetDetail);

    // Small delay between targets to avoid rate limiting
    await new Promise((r) => setTimeout(r, 2000));
  }

  lastRunAt = new Date().toISOString();
  lastRunStatus = overallStatus;
  lastRunDetails = details;

  logger.info(`Scheduler run completed: ${overallStatus}. Targets: ${allTargets.length}`);
  return { status: overallStatus, details };
}

/**
 * Manual trigger — sends right now regardless of cron schedule.
 */
async function sendNow() {
  if (!whatsappServiceRef) {
    throw new Error('WhatsApp service not initialized.');
  }
  const status = whatsappServiceRef.getStatus();
  if (!status.ready) {
    throw new Error('WhatsApp client is not connected.');
  }
  return sendScheduledMessages();
}

/**
 * Get scheduler status for the dashboard.
 */
function getStatus() {
  const schedulerCfg = getSchedulerConfig();
  return {
    enabled: schedulerCfg.enabled,
    cron: schedulerCfg.cron,
    timezone: schedulerCfg.timezone,
    targetGroups: schedulerCfg.targetGroups,
    targetChannels: schedulerCfg.targetChannels,
    adImageDir: schedulerCfg.adImageDir,
    adCaption: schedulerCfg.adCaption,
    isRunning: cronJob !== null,
    lastRunAt,
    lastRunStatus,
    lastRunDetails,
    availableAdImages: adService.listAdImages(schedulerCfg.adImageDir).length,
  };
}

module.exports = {
  startScheduler,
  stopScheduler,
  restartScheduler,
  sendNow,
  getStatus,
  getSchedulerConfig,
};
