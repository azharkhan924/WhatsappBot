// services/adService.js
// Picks a random advertisement image from a configurable directory.
// Supports jpg, jpeg, png, webp, gif formats.

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/**
 * Get the configured ad images directory path.
 * Falls back to public/ads if not configured.
 */
function getAdImageDir() {
  return config.scheduler.adImageDir || path.join(__dirname, '..', 'public', 'ads');
}

/**
 * List all supported image files in the ad directory.
 */
function listAdImages(dirPath) {
  const dir = dirPath || getAdImageDir();
  try {
    if (!fs.existsSync(dir)) {
      logger.warn(`Ad images directory does not exist: ${dir}`);
      return [];
    }
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext) && !f.startsWith('.');
      })
      .map((f) => path.join(dir, f));
  } catch (err) {
    logger.error(`Failed to list ad images: ${err.message}`);
    return [];
  }
}

const { getState, saveState } = require('./schedulerState');

/**
 * Get a random ad image from the configured directory, ensuring uniqueness until all are sent.
 * Returns { filePath, mimeType, filename } or null if no images found.
 */
function getRandomAdImage(dirPath) {
  const images = listAdImages(dirPath);
  if (images.length === 0) {
    logger.warn('No advertisement images found in the ads directory.');
    return null;
  }

  const state = getState();
  let available = images.filter(img => !state.sentImages.includes(img));

  // If all images have been sent, recycle them
  if (available.length === 0) {
    logger.info('All ad images have been sent. Recycling images list.');
    state.sentImages = [];
    available = images;
  }

  const filePath = available[Math.floor(Math.random() * available.length)];
  
  // Track as sent
  state.sentImages.push(filePath);
  saveState(state);

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };

  return {
    filePath,
    mimeType: mimeMap[ext] || 'image/jpeg',
    filename: path.basename(filePath),
  };
}

module.exports = {
  getRandomAdImage,
  listAdImages,
  getAdImageDir,
};
