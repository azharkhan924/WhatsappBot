// services/imageGenService.js
// AI Image Generation service using Gemini API (gemini-2.5-flash-preview-image-generation).
// Uses all configured Gemini API keys with rotation for resilience.
// Generates image + caption together in a single API call for efficiency.

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const botConfigService = require('./botConfigService');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const IMAGE_MODEL = 'gemini-2.5-flash-preview-image-generation';

// Temp directory for generated images
const TEMP_DIR = path.join(config.dataDir, 'generated_images');

// Track key rotation
let currentKeyIndex = 0;

/**
 * Ensure the temp directory exists.
 */
function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Get all available Gemini API keys.
 */
function getApiKeys() {
  return config.ai.gemini.apiKeys || [];
}

/**
 * Generate an image + caption using Gemini's image generation model.
 * 
 * @param {Object} options
 * @param {string} options.commonPrompt - The main prompt describing what to generate
 * @param {string} [options.imageHint] - Optional specific instructions for image style/content
 * @param {string} [options.captionHint] - Optional specific instructions for caption style
 * @returns {Promise<{ filePath: string, caption: string, mimeType: string, filename: string }>}
 */
async function generateImageWithCaption({ commonPrompt, imageHint, captionHint }) {
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    throw new Error('No Gemini API keys configured for image generation.');
  }

  ensureTempDir();

  const systemContext = botConfigService.getSystemPrompt();

  // 1. Generate Caption using active text AI provider (Groq / Gemini / NVIDIA)
  // This is highly flexible and avoids hallucination by leveraging full system context.
  const aiService = require('./aiService');
  let caption = '';
  try {
    logger.info('ImageGen: Generating caption using active text AI provider...');
    const captionSystemPrompt = `System Context / Business Info:\n${systemContext}\n\nInstructions:\nYou are a copywriter. Write a short, highly engaging caption for a daily image update. Do NOT write greetings, notes, quotes, intro, or explanations. Output ONLY the caption itself.\n\nIMPORTANT: Stay strictly factual based on the business context. Do not make up information that is not explicitly in the context.`;
    
    let captionUserMessage = `Write a caption based on this prompt: "${commonPrompt}"`;
    if (captionHint) {
      captionUserMessage += `\nSpecific formatting/style instructions: ${captionHint}`;
    }

    caption = await aiService.generateOneShot({
      systemPrompt: captionSystemPrompt,
      userMessage: captionUserMessage,
      maxTokens: 1024,
    });
    logger.info('ImageGen: Caption generated successfully.');
  } catch (err) {
    logger.error(`ImageGen: Caption generation failed (${err.message}). Falling back to simple fallback caption.`);
    caption = commonPrompt;
  }

  // 2. Generate Image using Gemini's dedicated Imagen 3 model via :predict REST endpoint
  let imagePrompt = `Theme: ${systemContext.substring(0, 300)}... Prompt: ${commonPrompt}`;
  if (imageHint) {
    imagePrompt += ` Style instructions: ${imageHint}`;
  }

  const payload = {
    instances: [
      {
        prompt: imagePrompt,
      },
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
      outputMimeType: 'image/jpeg',
    },
  };

  let lastError = null;
  const startIdx = currentKeyIndex;

  for (let i = 0; i < apiKeys.length; i++) {
    const idx = (startIdx + i) % apiKeys.length;
    const apiKey = apiKeys[idx];
    const url = `${BASE_URL}/imagen-3.0-generate-002:predict?key=${apiKey}`;

    try {
      logger.info(`ImageGen: Attempting image generation with API key index ${idx}...`);

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000, // 60s timeout for image generation
      });

      // Update rotation index on success
      currentKeyIndex = (idx + 1) % apiKeys.length;

      const predictions = response.data && response.data.predictions;
      if (!predictions || predictions.length === 0 || !predictions[0].bytesBase64Encoded) {
        throw new Error('Imagen 3 API did not return predictions or bytes');
      }

      const imageData = predictions[0].bytesBase64Encoded;
      const imageMimeType = 'image/jpeg';
      const ext = '.jpg';

      // Save image to temp file
      const filename = `ai_generated_${Date.now()}${ext}`;
      const filePath = path.join(TEMP_DIR, filename);
      const imageBuffer = Buffer.from(imageData, 'base64');
      fs.writeFileSync(filePath, imageBuffer);

      logger.info(`ImageGen: Successfully generated image (${(imageBuffer.length / 1024).toFixed(1)}KB)`);

      return {
        filePath,
        caption: caption.trim(),
        mimeType: imageMimeType,
        filename,
      };
    } catch (err) {
      lastError = err;
      const isRateLimit =
        (err.response && err.response.status === 429) ||
        (err.message && err.message.includes('429'));

      logger.warn(
        `ImageGen: Gemini API key index ${idx} failed (Rate limit: ${isRateLimit}): ${err.message}`
      );

      // Rotate to next key
      currentKeyIndex = (idx + 1) % apiKeys.length;

      if (
        err.response &&
        err.response.status >= 400 &&
        err.response.status < 500 &&
        !isRateLimit
      ) {
        const errorBody = err.response.data
          ? JSON.stringify(err.response.data).substring(0, 500)
          : 'No error body';
        logger.error(`ImageGen: Client error (${err.response.status}): ${errorBody}`);
      }
    }
  }

  throw lastError || new Error('All Gemini API keys failed for image generation');
}

/**
 * Clean up old generated images (older than 1 hour).
 * Called periodically or after sending.
 */
function cleanupTempImages() {
  try {
    if (!fs.existsSync(TEMP_DIR)) return;

    const files = fs.readdirSync(TEMP_DIR);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < oneHourAgo) {
          fs.unlinkSync(filePath);
          logger.debug(`ImageGen: Cleaned up old temp image: ${file}`);
        }
      } catch (e) {
        // Ignore individual file errors
      }
    }
  } catch (err) {
    logger.warn(`ImageGen: Cleanup failed: ${err.message}`);
  }
}

module.exports = {
  generateImageWithCaption,
  cleanupTempImages,
  TEMP_DIR,
};
