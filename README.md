# 🤖 Azhar's WhatsApp AI Bot & Control Room Dashboard

A production-ready, **free-to-run** autonomous WhatsApp AI assistant with a real-time web-based **Control Room Dashboard**. Powered by Google Gemini, Groq, and NVIDIA NIM with automatic failover, built with `whatsapp-web.js`, Express, Socket.IO, and Vanilla JS.

[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![Railway](https://img.shields.io/badge/Deploy%20on-Railway-purple.svg)](https://railway.app/)

---

## ✨ Features & Highlights

### 🎛️ Web Control Room Dashboard (`/dashboard`)
- 🌐 **Real-Time Connection Status**: Socket.IO-powered live status indicator (`connected`, `qr`, `disconnected`, `initializing`).
- 📷 **In-Browser QR Scanner**: High-resolution base64 QR code rendering directly inside the web dashboard.
- 📝 **Live System Prompt Editor**: Edit and persist the bot's system prompt in real-time without restarting the process.
- 🔕 **Bot Master Toggle**: Instantly enable or disable bot responses on demand.
- 🛡️ **Whitelist Protection**: Restrict bot replies to specific phone numbers (clean digits format).
- 💬 **Dynamic Holding Reply**: Set custom holding messages for sensitive queries (meetings, financial decisions, commitments).

### 🤖 Intelligent AI Engine & Automatic Fallback
- ⚡ **Performance Fallback Chain**: Gemini 2.5 Flash ➔ Groq Llama 3.3 70B ➔ NVIDIA Llama 3.1 70B.
- 🔁 **Instant 429 Failover**: Automatically jumps to the next available provider when rate limits are reached.
- 🧠 **Smart Conversation Memory**: In-RAM multi-turn dialog history (last 20 messages per contact with 30-min auto-expiration).
- ⌨️ **Human Simulation**: Dynamic typing indicator and randomized typing delay based on message length and complexity.
- 🚫 **Intervention Safeguard**: Detects if a human has manually replied to a chat and cancels automated bot replies.

### 🛡️ Production & Security Architecture
- 🔐 **Dual Authentication**: REST API key protection (`x-api-key`) & Dashboard authentication (`x-dashboard-key`).
- 🚀 **Cloud-Native Deployment**: Docker, Docker Compose, and Railway configuration with automatic `0.0.0.0` dual-port failover binding.
- 📊 **Monitoring & Logging**: Structured logging via Winston (`logs/info.log`, `logs/error.log`, `logs/combined.log`) and `/health` / `/stats` REST endpoints.

---

## 🏗️ Architecture Overview

```text
Incoming WhatsApp Message
        │
        ▼
Validation (ignore self, statuses, broadcasts, groups, deduplication)
        │
        ▼
Control Room Checks (Bot Enabled? Sender Whitelisted?)
        │
        ▼
Conversation Memory (Load & append user history)
        │
        ▼
AI Provider Chain (Gemini ➔ Groq ➔ NVIDIA NIM)
        │
        ▼
Human Behaviour Delay (Typing indicator + scaling length delay)
        │
        ▼
Human Intervention Safety Check (Skip if human replied during typing delay)
        │
        ▼
Send WhatsApp Reply
```

---

## 📂 Project Structure

```text
whatsapp-ai-bot/
├── config/             # Environment-based configuration & security defaults
├── controllers/        # REST & Dashboard business logic (botController.js)
├── memory/             # In-RAM node-cache conversation memory & botConfig.json persistence
├── middlewares/        # Authentication, rate limiting, validation, & logging middlewares
├── providers/          # Pluggable AI providers (Gemini, Groq, Nvidia) with fallback chain
├── prompts/            # systemPrompt.txt (AI persona & relationship instructions)
├── public/             # Control Room dashboard frontend (index.html, app.js)
├── routes/             # REST API & Dashboard endpoint router
├── services/           # Core services (whatsappService, aiService, botConfigService, commandService)
├── utils/              # Winston logger & Zod validation schemas
├── app.js              # Express app initialization, CORS, Helmet, & static routing
├── server.js           # Entrypoint — HTTP/WebSocket server startup & Puppeteer creation
├── Dockerfile          # Linux Node 22 slim image with Chromium dependencies
├── railway.json        # Railway deployment configuration
└── package.json        # Project dependencies & scripts
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: `>= 22.0.0`
- **npm**: `>= 10.0.0`
- **API Keys**: Google Gemini API key (free) or Groq / NVIDIA NIM API keys.

### 2. Environment Setup
Clone the repository and create your `.env` file:
```bash
git clone https://github.com/azharkhan924/WhatsappBot.git
cd WhatsappBot
cp .env.example .env
```

Edit `.env` to configure your API keys and security passcodes:
```env
PORT=3000
NODE_ENV=production

# AI Provider (gemini, groq, nvidia)
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here

# Dashboard & API Security
API_KEY=your_secret_api_key
DASHBOARD_KEY=your_secret_dashboard_key
```

### 3. Local Execution
Install dependencies and launch the server:
```bash
npm install
npm run dev
```

Open the Control Room Dashboard in your browser:
```text
http://localhost:3000/dashboard
```

---

## 🌐 Control Room Dashboard Guide

1. Navigate to `http://localhost:3000/dashboard` (or `https://your-app.up.railway.app/dashboard` on cloud).
2. On the **Connect to your backend** setup gate, provide:
   - **Backend URL**: `http://localhost:3000` (or your cloud domain)
   - **Dashboard key**: The `DASHBOARD_KEY` configured in `.env`
3. Scan the generated QR code with WhatsApp on your phone (**Linked Devices** ➔ **Link a device**).
4. Manage bot behavior, edit system prompts, set whitelist numbers, and save holding replies on the fly!

---

## ☁️ Cloud Deployment (Railway)

This repository includes custom `Dockerfile`, `railway.json`, and `nixpacks.toml` configurations for automated Railway deployment.

### Deploy Steps:
1. Fork or push this repository to GitHub.
2. Connect your repository to **[Railway.app](https://railway.app)**.
3. In Railway Service **Variables**, configure:
   - `GEMINI_API_KEY`
   - `DASHBOARD_KEY`
   - `API_KEY`
4. In Railway Service **Settings** ➔ **Networking**, ensure **Target Port** is set to **`3000`** (or `8080`).
5. Open your live dashboard at `https://your-service-name.up.railway.app/dashboard`!

---

## 📡 REST API Reference

| Endpoint | Method | Auth Header | Description |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | None | Returns server uptime, WhatsApp status, and active provider |
| `/stats` | `GET` | `x-api-key` | Returns detailed operational stats & memory performance |
| `/send` | `POST` | `x-api-key` | Send outbound WhatsApp message (`to`, `message`) |
| `/chat` | `POST` | `x-api-key` | Generate simulated AI reply without sending WhatsApp message |
| `/api/status` | `GET` | `x-dashboard-key` | Fetch connection state & QR code Data URL |
| `/api/reconnect`| `POST` | `x-dashboard-key` | Force client recreation & request new QR code |
| `/api/config` | `GET/PUT`| `x-dashboard-key` | Get or update dynamic bot settings (prompt, whitelist, etc.) |

---

## 🛡️ License

Distributed under the MIT License. See `LICENSE` for details.
