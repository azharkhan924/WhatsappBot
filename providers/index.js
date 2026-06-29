// providers/index.js
// Factory that returns the configured AI provider instance.
// Switching providers only requires changing AI_PROVIDER in .env.
// Future providers (openai, claude) can be added here without touching any other file.

const config = require('../config');
const GeminiProvider = require('./GeminiProvider');
const GroqProvider = require('./GroqProvider');

const providers = {
  gemini: GeminiProvider,
  groq: GroqProvider,
  // openai: OpenAIProvider,   // reserved for future use
  // claude: ClaudeProvider,   // reserved for future use
};

function createProvider() {
  const key = config.ai.provider;
  const ProviderClass = providers[key];

  if (!ProviderClass) {
    throw new Error(
      `Unsupported AI_PROVIDER "${key}". Supported providers: ${Object.keys(providers).join(', ')}`
    );
  }

  return new ProviderClass();
}

// Singleton instance used across the app.
const activeProvider = createProvider();

module.exports = activeProvider;
