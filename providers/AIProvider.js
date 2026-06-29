// providers/AIProvider.js
// Base class / interface that all AI providers must implement.
// This enables the Strategy pattern: swapping providers only requires
// changing the AI_PROVIDER environment variable.

class AIProvider {
  /**
   * Generate a reply given the system prompt, conversation history, and new user message.
   * @param {object} params
   * @param {string} params.systemPrompt
   * @param {Array<{role: 'user'|'assistant', content: string}>} params.history
   * @param {string} params.userMessage
   * @returns {Promise<string>} AI-generated reply text
   */
  // eslint-disable-next-line no-unused-vars
  async generateReply({ systemPrompt, history, userMessage }) {
    throw new Error('generateReply() must be implemented by subclass');
  }

  /**
   * Human-readable provider name, used in logs and /about, /version commands.
   */
  getName() {
    return 'base';
  }
}

module.exports = AIProvider;
