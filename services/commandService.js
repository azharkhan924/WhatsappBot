// services/commandService.js
// Implements slash-commands: /help, /reset, /ping, /about, /stats, /version

const conversationMemory = require('../memory/conversationMemory');
const provider = require('../providers');

const VERSION = require('../package.json').version;

const COMMANDS = ['/help', '/reset', '/ping', '/about', '/stats', '/version'];

function isCommand(text) {
  return COMMANDS.includes(text.trim().toLowerCase().split(' ')[0]);
}

function handleCommand(text, { userId, stats, isReady }) {
  const command = text.trim().toLowerCase().split(' ')[0];

  switch (command) {
    case '/help':
      return (
        '*Available commands:*\n' +
        '/help - show this message\n' +
        '/reset - clear our conversation memory\n' +
        '/ping - check if the bot is alive\n' +
        '/about - learn about this bot\n' +
        '/stats - show usage stats\n' +
        '/version - show bot version'
      );

    case '/reset':
      conversationMemory.resetHistory(userId);
      return 'Your conversation history has been cleared. Let\'s start fresh!';

    case '/ping':
      return isReady ? 'Pong! ✅ Bot is online.' : 'Pong, but WhatsApp connection is not fully ready.';

    case '/about':
      return (
        'I am an AI-powered WhatsApp assistant built with whatsapp-web.js and ' +
        `the ${provider.getName()} AI provider. Ask me anything!`
      );

    case '/stats':
      return (
        '*Bot Stats:*\n' +
        `Messages received: ${stats.messagesReceived}\n` +
        `Messages replied: ${stats.messagesReplied}\n` +
        `AI failures: ${stats.aiFailures}\n` +
        `Reconnects: ${stats.reconnects}\n` +
        `Active conversations: ${conversationMemory.getStats().activeConversations}`
      );

    case '/version':
      return `Bot version: ${VERSION}`;

    default:
      return "Unknown command. Type /help to see what I can do.";
  }
}

module.exports = { isCommand, handleCommand, COMMANDS };
