const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'whatsapp-bot-session',
    dataPath: path.join(__dirname, 'data', 'session')
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});
client.on('ready', async () => {
  console.log('Ready!');
  const chats = await client.getChats();
  const channels = chats.filter(c => c.id._serialized.includes('@newsletter'));
  console.log('Channels found:', channels.map(c => ({ id: c.id._serialized, name: c.name })));
  process.exit(0);
});
client.initialize();
