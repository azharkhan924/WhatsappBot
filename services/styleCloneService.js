// services/styleCloneService.js
// Fetches recent chat history, compiles it, and uses AI to generate highly detailed writing style rules.

const whatsappService = require('./whatsappService');
const aiService = require('./aiService');
const logger = require('../utils/logger');

/**
 * Compiles and formats chat log messages into a structured text layout for AI analysis.
 */
function formatChatLog(messages, targetRole) {
  return messages
    .map((m) => {
      const senderLabel = m.fromMe ? 'Owner (Me)' : `Contact (${m.senderName})`;
      const targetMarker = (targetRole === 'me' && m.fromMe) || (targetRole === 'contact' && !m.fromMe) ? '★ TARGET SPEAKER ★' : '';
      return `[${senderLabel}] ${targetMarker}: "${m.body}"`;
    })
    .join('\n');
}

/**
 * Builds the highly detailed, accurate prompt for the style cloner.
 */
function buildAnalysisPrompt(chatLog, targetName) {
  return `You are an expert linguistic analyst, forensic copywriter, and prompt engineer specializing in mimicking human communication styles.

We have captured a raw WhatsApp chat log between two speakers. One of them is the TARGET SPEAKER we want to mimic: "${targetName}".

Here is the WhatsApp Chat Log:
---
${chatLog}
---

Your goal is to reverse-engineer, analyze, and generate a highly detailed and extremely accurate set of system prompt instructions. When these instructions are appended to an AI's system prompt, the AI must respond in a way that is indistinguishable from the TARGET SPEAKER (${targetName}). It must NOT sound like a robotic or helpful assistant.

Analyze the TARGET SPEAKER's messages in detail. Specifically extract:
1. **Language & Dialect**: Does the speaker write in English, Hindi, or Hinglish (Hindi written in Latin script)? What is the exact mix?
2. **Punctuation & Capitalization**:
   - Do they use proper capitalization, or do they write entirely in lowercase?
   - Do they end sentences with periods? Or do they leave sentences open-ended without terminal punctuation?
   - How do they use exclamation marks, question marks, or repeating punctuation (e.g. "??", "!!")?
3. **Emoji Fingerprint**:
   - What specific emojis do they use (e.g., 🙏, 👍, 😂, 😅)?
   - What is the frequency of emoji usage (every message, occasionally, or never)?
   - Where do they place emojis (e.g. at the very end of a message, or interspersed)?
4. **Vocabulary, Slang, & Filler Words**:
   - List the exact signature words, greetings, and slang they use (e.g., "bhai", "yaar", "haan", "ok", "cool", "done", "bro").
   - Do they use common abbreviations (e.g., "pls", "u", "r", "k", "tom")?
5. **Sentence Structure & Messaging Pattern**:
   - Are their messages short one-liners, or do they write long paragraphs?
   - Do they split thoughts into multiple short messages, or combine them into one?
6. **Tone & Persona**: Is the tone casual, direct, business-oriented, friendly, lazy, or concise? How do they handle greetings and closing sign-offs? (e.g., do they sign off with a name, or just stop replying?)

---

### OUTPUT INSTRUCTIONS:
Generate a structured, markdown-formatted instructions block that starts directly with '# Mimicked Writing Style Rules'. It must be written as direct instructions to the AI on how to formulate its replies.
Make the rules incredibly strict. Instruct the AI to:
- NEVER use standard helpful AI pleasantries (like "Sure! I would be happy to help you with that!").
- Match the capitalization, punctuation, and language rules you discovered.
- Provide concrete examples of how the target speaker would say common things (e.g., how they say yes, no, ask for time, or say thank you).

Do NOT include any introduction, explanations, notes, or chat logs in your response. Output only the prompt block itself, starting with "# Mimicked Writing Style Rules".`;
}

/**
 * Fetches recent chat history and runs linguistic analysis to clone writing style.
 * @param {string} chatId - WhatsApp Chat ID
 * @param {string} target - 'me' (clone owner's style) or 'contact' (clone contact's style)
 * @returns {Promise<string>} The generated style rules prompt block
 */
async function cloneStyle(chatId, target = 'me') {
  logger.info(`Linguistic Style Cloner: fetching chat history for ${chatId}...`);
  
  // Fetch last 80 messages for rich analysis
  const messages = await whatsappService.fetchChatMessages(chatId, 80);
  if (!messages || messages.length === 0) {
    throw new Error('No messages found in the selected chat. Make sure the chat has active history.');
  }

  // Format target display name
  const targetName = target === 'me' ? 'Owner (Me)' : 'Contact';
  
  // Compile the logs
  const chatLog = formatChatLog(messages, target);
  
  // Build prompt
  const prompt = buildAnalysisPrompt(chatLog, targetName);
  
  logger.info(`Linguistic Style Cloner: starting AI analysis via fallback chain...`);

  // Run the analysis using our robust fallback-supported generator
  const generatedRules = await aiService.generateOneShot({
    systemPrompt: 'You are a professional linguistic analyst and prompt engineer. Output only the markdown system prompt block, nothing else.',
    userMessage: prompt,
    maxTokens: 2048,
  });

  return generatedRules.trim();
}

module.exports = {
  cloneStyle,
};
