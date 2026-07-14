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
    quoteMode: botCfg.schedulerQuoteMode || 'local',
    quotePrompt: botCfg.schedulerQuotePrompt || '',
    captionMode: botCfg.schedulerCaptionMode || 'static',
    captionPrompt: botCfg.schedulerCaptionPrompt || '',
  };
}

/**
 * Format the quote into a nice WhatsApp message.
 */
function formatQuoteMessage(quote) {
  // Send the raw text as-is — the .txt file can contain any message, not just quotes
  return quote.text;
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
    if (
      trimmed.includes('@g.us') ||
      trimmed.includes('@newsletter') ||
      trimmed.includes('@c.us') ||
      trimmed.includes('@lid') ||
      trimmed.includes('@s.whatsapp.net')
    ) {
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

  const aiService = require('./aiService');

  // 1. Fetch or generate quote/message
  let quoteMessage = '';
  if (schedulerCfg.quoteMode === 'ai_prompt' && schedulerCfg.quotePrompt) {
    try {
      logger.info('Scheduler: Quote mode is AI Prompt. Generating with main system prompt context...');
      const systemPrompt = `System Context / Business Info:\n${botConfigService.getSystemPrompt()}\n\nInstructions:\nYou are a copywriter. Write a daily inspiring message or quote as requested. Do NOT include greetings, intro, notes, explanations, or quotes. Output ONLY the generated message/quote text itself.`;
      
      quoteMessage = await aiService.generateOneShot({
        systemPrompt,
        userMessage: `Based on the system context, write a message or quote matching this request: ${schedulerCfg.quotePrompt}`,
        maxTokens: 2048, // Support long messages and avoid thinking truncations
      });
      logger.info('Scheduler: AI quote message successfully generated.');
    } catch (err) {
      logger.error(`Scheduler: AI quote generation failed (${err.message}). Falling back to local quote service.`);
      // Fallback to quoteService
      try {
        const quote = await quoteService.getQuoteOfTheDay();
        quoteMessage = formatQuoteMessage(quote);
      } catch (fallbackErr) {
        quoteMessage = 'Every day is a new beginning.';
      }
    }
  } else {
    // Local / quoteService mode
    try {
      const quote = await quoteService.getQuoteOfTheDay();
      quoteMessage = formatQuoteMessage(quote);
    } catch (err) {
      logger.error(`Failed to fetch daily quote: ${err.message}`);
      quoteMessage = 'Every day is a new beginning.';
    }
  }

  // 2. Get all ad images in insertion order
  const allImages = adService.getAllAdImagesInOrder(schedulerCfg.adImageDir);
  
  // 3. Resolve captions (static vs AI generated)
  let captions = [];
  if (allImages.length > 0) {
    if (schedulerCfg.captionMode === 'ai_prompt' && schedulerCfg.captionPrompt) {
      try {
        logger.info('Scheduler: Caption mode is AI Prompt. Generating with main system prompt context...');
        const systemPrompt = `System Context / Business Info:\n${botConfigService.getSystemPrompt()}\n\nInstructions:\nYou are a marketing assistant. Write a short, highly engaging caption for the daily ad image based on the request. Do NOT write greetings, notes, quotes, or explanations. Output ONLY the caption itself.`;
        
        const generatedCaption = await aiService.generateOneShot({
          systemPrompt,
          userMessage: `Based on the system context, write an ad caption matching this request: ${schedulerCfg.captionPrompt}`,
          maxTokens: 2048, // Support long captions and avoid thinking truncations
        });
        
        captions = Array(allImages.length).fill(generatedCaption.trim());
        logger.info('Scheduler: AI ad caption successfully generated.');
      } catch (err) {
        logger.error(`Scheduler: AI ad caption generation failed (${err.message}). Falling back to static caption.`);
        captions = adService.getCaptionsForImages(schedulerCfg.adImageDir, allImages.length, schedulerCfg.adCaption || '');
      }
    } else {
      // Standard static mode
      captions = adService.getCaptionsForImages(schedulerCfg.adImageDir, allImages.length, schedulerCfg.adCaption || '');
    }
  }

  // 4. Resolve all targets (groups + channels)
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

  // 5. Send to each target
  for (const target of allTargets) {
    const targetDetail = { target: target.name || target.id, status: 'pending' };

    // Send quote/message text
    try {
      await whatsappServiceRef.sendMessage(target.id, quoteMessage);
      targetDetail.quoteSent = true;
      logger.info(`Scheduler: message sent to ${target.name || target.id}`);
    } catch (err) {
      targetDetail.quoteSent = false;
      targetDetail.quoteError = err.message;
      overallStatus = 'partial_failure';
      logger.error(`Scheduler: failed to send message to ${target.name || target.id}: ${err.message}`);
    }

    // Send all ad images in order, each with its own caption
    if (allImages.length > 0) {
      let imagesSent = 0;
      let imagesFailed = 0;
      for (let i = 0; i < allImages.length; i++) {
        const img = allImages[i];
        const caption = captions[i] || '';
        try {
          await whatsappServiceRef.sendMediaMessage(target.id, img.filePath, caption);
          imagesSent++;
          logger.info(`Scheduler: image ${i + 1}/${allImages.length} sent to ${target.name || target.id}: ${img.filename}`);
        } catch (err) {
          imagesFailed++;
          overallStatus = 'partial_failure';
          logger.error(`Scheduler: failed to send image ${img.filename} to ${target.name || target.id}: ${err.message}`);
        }
        // Small delay between images to avoid rate limiting
        if (i < allImages.length - 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      targetDetail.adSent = imagesSent > 0;
      targetDetail.adCount = `${imagesSent}/${allImages.length}`;
      if (imagesFailed > 0) {
        targetDetail.adError = `${imagesFailed} image(s) failed`;
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
    quoteMode: schedulerCfg.quoteMode,
    quotePrompt: schedulerCfg.quotePrompt,
    captionMode: schedulerCfg.captionMode,
    captionPrompt: schedulerCfg.captionPrompt,
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
