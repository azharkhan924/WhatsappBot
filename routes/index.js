// routes/index.js
// Defines all REST API routes.

const express = require('express');
const router = express.Router();

const controller = require('../controllers/botController');
const validate = require('../middlewares/validate');
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const dashboardAuth = require('../middlewares/dashboardAuth');
const { sendMessageSchema, chatSchema, resetSchema } = require('../utils/schemas');

router.get('/', controller.getRoot);
router.get('/health', controller.getHealth);
router.get('/stats', apiKeyAuth, controller.getStats);

router.post('/send', apiKeyAuth, validate(sendMessageSchema), controller.postSend);
router.post('/chat', apiKeyAuth, validate(chatSchema), controller.postChat);
router.post('/reset', apiKeyAuth, validate(resetSchema), controller.postReset);

// Control Room Dashboard routes (supporting both /api/* and /* paths)
router.get(['/api/status', '/status'], dashboardAuth, controller.getDashboardStatus);
router.post(['/api/reconnect', '/reconnect'], dashboardAuth, controller.postReconnect);
router.get(['/api/config', '/config'], dashboardAuth, controller.getConfig);
router.put(['/api/config', '/config'], dashboardAuth, controller.putConfig);

// Phone Number OTP Login routes
router.post(['/api/auth/request-otp', '/auth/request-otp'], controller.postRequestOtp);
router.post(['/api/auth/verify-otp', '/auth/verify-otp'], controller.postVerifyOtp);

module.exports = router;
