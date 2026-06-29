// utils/schemas.js
// Zod validation schemas for REST API request bodies.

const { z } = require('zod');

const sendMessageSchema = z.object({
  to: z.string().min(5, 'to must be a valid phone number or chat id'),
  message: z.string().min(1, 'message cannot be empty').max(4096, 'message too long'),
});

const chatSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  message: z.string().min(1, 'message cannot be empty').max(4096, 'message too long'),
});

const resetSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

module.exports = { sendMessageSchema, chatSchema, resetSchema };
