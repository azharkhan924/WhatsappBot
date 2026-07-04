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

// Phone Number OTP Login & Admin Login routes
router.post(['/api/auth/request-otp', '/auth/request-otp'], controller.postRequestOtp);
router.post(['/api/auth/verify-otp', '/auth/verify-otp'], controller.postVerifyOtp);
router.post(['/api/auth/admin-login', '/auth/admin-login'], controller.postAdminLogin);

// WhatsApp Pairing Code route
router.post(['/api/pairing-code', '/pairing-code'], dashboardAuth, controller.postPairingCode);

// Scheduler routes
router.get(['/api/scheduler/status', '/scheduler/status'], dashboardAuth, controller.getSchedulerStatus);
router.post(['/api/scheduler/trigger', '/scheduler/trigger'], dashboardAuth, controller.postTriggerScheduler);
router.get(['/api/scheduler/available-chats', '/scheduler/available-chats'], dashboardAuth, controller.getAvailableChats);

// Ad images upload route
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Determine target directory, default to public/ads
    const config = require('../config');
    const adDir = config.scheduler.adImageDir || path.join(__dirname, '..', 'public', 'ads');
    // Ensure directory exists
    if (!fs.existsSync(adDir)) {
      fs.mkdirSync(adDir, { recursive: true });
    }
    cb(null, adDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });
router.post(['/api/scheduler/ads/upload', '/scheduler/ads/upload'], dashboardAuth, upload.array('images'), (req, res) => {
  res.json({ success: true, count: req.files ? req.files.length : 0 });
});

module.exports = router;
