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

  // Build the generation prompt with system context for accuracy
  const systemContext = botConfigService.getSystemPrompt();

  let fullPrompt = `You are an AI assistant that generates images and captions for WhatsApp messages.\n\n`;
  fullPrompt += `## Business/Brand Context (use this for accuracy — do NOT hallucinate details):\n${systemContext}\n\n`;
  fullPrompt += `## Task:\nGenerate an image and a short engaging caption based on the following instructions.\n\n`;
  fullPrompt += `## Main Instructions:\n${commonPrompt}\n\n`;

  if (imageHint) {
    fullPrompt += `## Specific Image Instructions:\n${imageHint}\n\n`;
  }

  if (captionHint) {
    fullPrompt += `## Specific Caption Instructions:\n${captionHint}\n\n`;
  }

  fullPrompt += `## Output Format:\nGenerate a high-quality, visually appealing image that matches the instructions above. Also output a short WhatsApp-friendly caption (2-4 lines max, can include emojis). Output the caption as plain text BEFORE the image.\n\nIMPORTANT: Stay strictly factual based on the business context provided. Do not make up information that isn't in the context.`;

  const payload = {
    contents: [
      {
        parts: [{ text: fullPrompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      temperature: 0.8,
    },
  };

  let lastError = null;
  const startIdx = currentKeyIndex;

  for (let i = 0; i < apiKeys.length; i++) {
    const idx = (startIdx + i) % apiKeys.length;
    const apiKey = apiKeys[idx];
    const url = `${BASE_URL}/${IMAGE_MODEL}:generateContent?key=${apiKey}`;

    try {
      logger.info(`ImageGen: Attempting with Gemini API key index ${idx}...`);

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000, // Image generation can take longer — 60s timeout
      });

      // Update rotation index on success
      currentKeyIndex = (idx + 1) % apiKeys.length;

      const candidates = response.data && response.data.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('Gemini Image API returned no candidates');
      }

      const parts = candidates[0].content && candidates[0].content.parts;
      if (!parts || parts.length === 0) {
        throw new Error('Gemini Image API returned empty response');
      }

      // Parse the response: extract text (caption) and image (base64)
      let caption = '';
      let imageData = null;
      let imageMimeType = 'image/png';

      for (const part of parts) {
        if (part.text) {
          caption += part.text;
        }
        if (part.inlineData) {
          imageData = part.inlineData.data; // base64 string
          imageMimeType = part.inlineData.mimeType || 'image/png';
        }
      }

      if (!imageData) {
        throw new Error('Gemini Image API did not return an image in the response');
      }

      // Determine file extension from mime type
      const extMap = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
      };
      const ext = extMap[imageMimeType] || '.png';

      // Save image to temp file
      const filename = `ai_generated_${Date.now()}${ext}`;
      const filePath = path.join(TEMP_DIR, filename);
      const imageBuffer = Buffer.from(imageData, 'base64');
      fs.writeFileSync(filePath, imageBuffer);

      logger.info(`ImageGen: Successfully generated image (${(imageBuffer.length / 1024).toFixed(1)}KB) with caption.`);

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

      // If it's not a rate limit, and it's a 4xx client error, log details
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
