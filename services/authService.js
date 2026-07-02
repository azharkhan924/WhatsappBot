// services/authService.js
// Handles automated Phone Number OTP login via the running WhatsApp engine.

const whatsappService = require('./whatsappService');
const config = require('../config');
const logger = require('../utils/logger');

// In-memory store for active OTP codes: phone -> { otp, expiresAt }
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cleanPhone(raw) {
  return String(raw || '').replace(/[^0-9]/g, '');
}

async function requestOtp(rawPhone) {
  const phone = cleanPhone(rawPhone);
  if (!phone || phone.length < 10) {
    const err = new Error('Please enter a valid phone number with country code (at least 10 digits).');
    err.statusCode = 400;
    throw err;
  }

  const status = whatsappService.getStatus();
  if (!status.ready) {
    const err = new Error('WhatsApp bot is not currently connected. Please log in using your Dashboard Key or scan the QR code first.');
    err.statusCode = 503;
    throw err;
  }

  // Generate 6-digit OTP code
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + OTP_TTL_MS;

  otpStore.set(phone, { otp, expiresAt });

  const messageText = `🔐 *Control Room Verification Code*\n\nYour login code is: *${otp}*\n\nExpires in 5 minutes. Do not share this code with anyone.`;

  try {
    await whatsappService.sendMessage(phone, messageText);
    logger.info(`Auth OTP sent via WhatsApp to ${phone}`);
    return { success: true, message: `Verification code sent to +${phone} via WhatsApp.` };
  } catch (err) {
    otpStore.delete(phone);
    logger.error(`Failed to send WhatsApp OTP to ${phone}: ${err.message}`);
    const sendErr = new Error('Could not deliver WhatsApp message to this phone number. Make sure the number has an active WhatsApp account.');
    sendErr.statusCode = 502;
    throw sendErr;
  }
}

async function verifyOtp(rawPhone, rawOtp) {
  const phone = cleanPhone(rawPhone);
  const otp = String(rawOtp || '').trim();

  if (!phone || !otp) {
    const err = new Error('Phone number and verification code are required.');
    err.statusCode = 400;
    throw err;
  }

  const record = otpStore.get(phone);
  if (!record) {
    const err = new Error('No active verification request found for this number. Please request a new code.');
    err.statusCode = 401;
    throw err;
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(phone);
    const err = new Error('Verification code has expired. Please request a new code.');
    err.statusCode = 401;
    throw err;
  }

  if (record.otp !== otp) {
    const err = new Error('Incorrect verification code.');
    err.statusCode = 401;
    throw err;
  }

  // Verification successful! Clean up OTP record and issue dashboard key
  otpStore.delete(phone);
  logger.info(`Successful Phone OTP login for ${phone}`);

  return {
    success: true,
    dashboardKey: config.security.dashboardKey,
  };
}

module.exports = {
  requestOtp,
  verifyOtp,
};
