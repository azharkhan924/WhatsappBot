// routes/index.js
// Defines all REST API routes.

const express = require('express');
const router = express.Router();

const controller = require('../controllers/botController');
const validate = require('../middlewares/validate');
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const { sendMessageSchema, chatSchema, resetSchema } = require('../utils/schemas');

router.get('/', controller.getRoot);
router.get('/health', controller.getHealth);
router.get('/stats', apiKeyAuth, controller.getStats);

router.post('/send', apiKeyAuth, validate(sendMessageSchema), controller.postSend);
router.post('/chat', apiKeyAuth, validate(chatSchema), controller.postChat);
router.post('/reset', apiKeyAuth, validate(resetSchema), controller.postReset);

module.exports = router;
