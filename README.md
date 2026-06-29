# WhatsApp AI Bot 🤖

A production-ready, **free-to-run** WhatsApp chatbot powered by Google Gemini (default) or Groq, built with `whatsapp-web.js`, Express, and pure JavaScript (no TypeScript, no database required).

---

## ✨ Features

- 📱 WhatsApp Web login via QR code, with persistent sessions (no re-scan on restart)
- 🔁 Auto-reconnect on disconnect, duplicate-message protection, ignores statuses/broadcasts/self-messages
- 🧠 In-RAM conversation memory (last 20 messages per user, auto-expires after 30 minutes)
- 🤖 Pluggable AI provider system — switch between Gemini and Groq with **one environment variable**
- ⌨️ Human-like behaviour — typing indicator + natural delay before replying
- 🛠️ Built-in commands: `/help`, `/reset`, `/ping`, `/about`, `/stats`, `/version`
- 🔒 Security: Helmet, rate limiting, Zod input validation, API key protection
- 📝 Winston logging to `logs/info.log`, `logs/error.log`, `logs/combined.log`
- 🌐 REST API for sending messages, chatting with the AI, and checking stats
- 🐳 Docker & docker-compose ready
- 🆓 Deployable for free on Railway, Koyeb, or an Oracle Cloud Always-Free VPS

---

## 🏗️ Architecture

```
Incoming WhatsApp Message
        │
        ▼
   Validation (ignore self/status/broadcast/duplicates)
        │
        ▼
   Rate Limiting (REST layer) / Command check
        │
        ▼
   Conversation Memory (load + append history)
        │
        ▼
   AI Provider (Gemini or Groq, with retry + timeout)
        │
        ▼
   Generate Reply
        │
        ▼
   Typing Indicator + Human Delay
        │
        ▼
   Send Reply
```

### Folder Structure

```
project/
├── config/             # Centralized env-based configuration
├── controllers/         # REST endpoint business logic
├── services/            # whatsappService, aiService, commandService
├── providers/           # AIProvider interface + GeminiProvider + GroqProvider
├── middlewares/          # validation, rate limiting, auth, error handling, logging
├── routes/               # Express route definitions
├── utils/                # logger, zod schemas
├── memory/               # In-RAM conversation memory (node-cache)
├── prompts/              # systemPrompt.txt (AI personality)
├── logs/                 # Winston log files
├── public/               # Static status page
├── session/              # whatsapp-web.js persistent session data
├── app.js                # Express app setup
├── server.js             # Entrypoint — starts HTTP server + WhatsApp client
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── postman_collection.json
```

### Provider Pattern

```
AIProvider (abstract base)
   ├── GeminiProvider   (default)
   ├── GroqProvider     (alternative)
   ├── OpenAIProvider   (reserved for future)
   └── ClaudeProvider   (reserved for future)
```


Switching providers requires changing **only** `AI_PROVIDER` in `.env` — no code changes.

---

## 📦 Requirements

- Node.js 22 LTS
- npm
- A Gemini API key (free) and/or a Groq API key (free)
- A WhatsApp account on your phone (to scan the QR code)

---

## 🚀 Installation

```bash
git clone <your-repo-url>
cd project
npm install
cp .env.example .env
```

Edit `.env` and add your API key(s) (see below for how to get them).

---

## 🔑 Getting API Keys

### Google Gemini API Key (Free)
1. Go to [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account.
3. Click **Create API Key**.
4. Copy the key into `.env` as `GEMINI_API_KEY=...`

### Groq API Key (Free, optional alternative)
1. Go to [https://console.groq.com/keys](https://console.groq.com/keys)
2. Sign in / create an account.
3. Click **Create API Key**.
4. Copy the key into `.env` as `GROQ_API_KEY=...`
5. Set `AI_PROVIDER=groq` to use it instead of Gemini.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server port | `3000` |
| `AI_PROVIDER` | `gemini` or `groq` | `gemini` |
| `GEMINI_API_KEY` | Your Gemini API key | — |
| `GEMINI_MODEL` | Gemini model name | `gemini-2.5-flash` |
| `GROQ_API_KEY` | Your Groq API key | — |
| `GROQ_MODEL` | Groq model name | `llama-3.3-70b-versatile` |
| `TEMPERATURE` | AI creativity (0–1) | `0.7` |
| `MAX_TOKENS` | Max tokens per AI reply | `512` |
| `AI_TIMEOUT_MS` | AI request timeout | `15000` |
| `AI_MAX_RETRIES` | Retries before fallback message | `2` |
| `MEMORY_LIMIT` | Messages remembered per user | `20` |
| `MEMORY_TIMEOUT_MINUTES` | Memory expiry | `30` |
| `TYPING_DELAY_MIN_MS` / `MAX_MS` | Human-like delay range | `2000` / `5000` |
| `RATE_LIMIT_WINDOW_MS` / `MAX_REQUESTS` | REST API rate limiting | `60000` / `30` |
| `API_KEY` | Secret key to protect `/send`, `/chat`, `/reset`, `/stats` | — |
| `LOG_LEVEL` | Winston log level | `info` |
| `WA_CLIENT_ID` | WhatsApp session identifier | `whatsapp-bot-session` |
| `IGNORE_GROUPS` | Ignore group chat messages | `false` |

---

## ▶️ Running Locally

```bash
npm run dev      # with nodemon (auto-restart on file changes)
# or
npm start        # production mode
```

On first run, a QR code will print in your terminal. Open WhatsApp on your phone → **Settings → Linked Devices → Link a Device** → scan the QR code.

Once scanned, the session is saved in `session/` so you won't need to scan again on restart.

---

## 🐳 Running with Docker

```bash
docker compose up -d --build
docker compose logs -f   # to view the QR code and logs
```

The `session/` and `logs/` folders are mounted as volumes, so your WhatsApp login persists across container restarts.

---

## ☁️ Deployment Guides

### Railway (Free Tier)
1. Push this project to a GitHub repository.
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
3. Add all variables from `.env.example` under **Variables**.
4. Railway auto-detects the `Dockerfile` and builds the container.
5. Open the **Deploy Logs** tab to scan the QR code (copy the printed QR text into a QR generator if your terminal can't render it, or use the `qrcode-terminal` ASCII output directly).
6. Attach a **Volume** mounted at `/usr/src/app/session` so your session persists across redeploys.

### Koyeb (Free Tier)
1. Push this project to GitHub.
2. On [koyeb.com](https://koyeb.com), create a new **Web Service** from your repo.
3. Choose **Dockerfile** as the build method.
4. Set environment variables from `.env.example`.
5. Set the health check path to `/health`.
6. View build/runtime logs to scan the QR code.
7. Note: Koyeb free instances may not have persistent disks — for long-term session persistence, prefer a VPS (below).

### Oracle Cloud Always-Free VPS
1. Create an **Always Free** ARM or AMD VM instance (Ubuntu 22.04/24.04).
2. SSH into the instance.
3. Install Node.js 22 and Docker:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo apt-get install -y docker.io docker-compose-plugin
   ```
4. Clone your repo, set up `.env`, then:
   ```bash
   docker compose up -d --build
   docker compose logs -f
   ```
5. Scan the QR code from the logs. Open port 3000 in the Oracle Cloud security list/firewall if you need external REST API access.

### Local Linux
```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install
cp .env.example .env   # fill in keys
npm start
```

### Windows
1. Install [Node.js 22 LTS](https://nodejs.org/) (includes npm).
2. Open PowerShell in the project folder.
3. ```powershell
   npm install
   copy .env.example .env
   npm start
   ```
4. Scan the QR code that appears in the terminal.
5. Note: Puppeteer will download its own Chromium automatically on Windows (no extra system packages needed for local dev — the Dockerfile's manual Chromium install is only for the slim Linux container image).

---

## 📡 REST API Documentation

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/` | No | Basic service info |
| GET | `/health` | No | Health check + WhatsApp connection status |
| GET | `/stats` | Yes (`x-api-key`) | Usage statistics |
| POST | `/send` | Yes | Send a WhatsApp message programmatically |
| POST | `/chat` | Yes | Chat with the AI directly (no WhatsApp needed) |
| POST | `/reset` | Yes | Clear a user's conversation memory |

### Example Request — `POST /send`
```json
{
  "to": "919999999999",
  "message": "Hello from the bot!"
}
```

### Example Response
```json
{
  "success": true,
  "messageId": "true_919999999999@c.us_3EB0XXXXXXXXXXXXX"
}
```

### Example Request — `POST /chat`
```json
{
  "userId": "test-user-1",
  "message": "What is the capital of France?"
}
```

### Example Response
```json
{
  "success": true,
  "reply": "The capital of France is Paris.",
  "latencyMs": 842,
  "failed": false,
  "provider": "gemini:gemini-2.5-flash"
}
```

A ready-to-import Postman collection is included: [`postman_collection.json`](./postman_collection.json).

---

## 🔄 Sequence Diagram (WhatsApp message flow)

```
User (WhatsApp) → whatsapp-web.js client → handleIncomingMessage()
   → [command?] → commandService → reply
   → [else] → conversationMemory.getHistory()
            → aiService.generateReply() → AIProvider (Gemini/Groq)
            → conversationMemory.addMessage()
   → chat.sendStateTyping() → delay → message.reply()
```

---

## 🧰 Available Commands (inside WhatsApp chat)

| Command | Description |
|---|---|
| `/help` | List all commands |
| `/reset` | Clear your conversation history |
| `/ping` | Check if the bot is alive |
| `/about` | Bot info + active AI provider |
| `/stats` | Usage statistics |
| `/version` | Bot version |

---

## 🩺 Troubleshooting

**QR code doesn't appear / scan fails**
- Make sure your terminal supports rendering the ASCII QR code, or widen the terminal window.
- Delete the `session/` folder and restart to force a fresh QR code.

**Puppeteer/Chromium errors on Linux servers**
- Make sure you're using the provided `Dockerfile` (installs Chromium + required libs), or install the equivalent libs manually if running outside Docker.

**Bot doesn't reply**
- Check `logs/error.log` for AI provider errors (often an invalid/missing API key).
- Confirm `AI_PROVIDER` matches the key you've set (`gemini` needs `GEMINI_API_KEY`, `groq` needs `GROQ_API_KEY`).

**"Sorry, I'm unable to answer right now" replies**
- This is the built-in fallback after retries are exhausted — check your API key, quota, and network connectivity to the AI provider.

**Session keeps logging out**
- Avoid running multiple instances with the same `WA_CLIENT_ID`/session folder simultaneously.
- Ensure the `session/` folder is persisted (mounted as a volume in Docker deployments).

---

## ❓ FAQ

**Q: Does this need a database?**
A: No. Conversation memory lives in RAM via `node-cache` and expires automatically.

**Q: Can I use both Gemini and Groq at the same time?**
A: Not simultaneously for replies — only one provider is active per `AI_PROVIDER` setting — but both can be configured in `.env` and switched anytime by changing the variable and restarting.

**Q: Is this free to run forever?**
A: Yes, on a free-tier VPS (e.g., Oracle Cloud Always Free) or free hosting platforms (Railway/Koyeb), using free-tier Gemini/Groq API keys, subject to each provider's rate limits.

**Q: Can it handle images, voice, or PDFs?**
A: Not yet — the architecture is designed to support this in the future (see below) without major refactoring.

---

## 🔮 Future Improvements

This project is structured so the following can be added **without major refactoring**:

- MySQL / PostgreSQL / MongoDB persistent storage
- Redis-backed distributed conversation memory
- Vector database + RAG (retrieval-augmented generation)
- Voice message transcription & image/PDF understanding
- Admin web dashboard with analytics
- Multi-agent AI workflows
- Multiple WhatsApp account support
- Scheduled & broadcast messaging
- OpenAI and Claude provider support (stubs already reserved in `providers/index.js`)

---

## 📄 License

MIT
