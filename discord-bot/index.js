/**
 * Discord Bot for Claude Phone
 *
 * Bridges Discord messages to the claude-api-server /chat endpoint.
 * Supports multi-turn conversations, code blocks, and long responses.
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=xxx CLAUDE_API_URL=http://localhost:3333 node index.js
 *
 * Features:
 *   - Responds to DMs and mentions in allowed channels
 *   - Per-channel session management (conversation context)
 *   - Typing indicator while Claude thinks
 *   - Splits long responses at Discord's 2000 char limit
 *   - Code block detection for nice formatting
 *   - Configurable personality via DISCORD_SYSTEM_PROMPT
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLAUDE_API_URL = process.env.CLAUDE_API_URL || 'http://localhost:3333';
const API_KEY = process.env.API_KEY || null;

// Restrict to specific channels/users (comma-separated IDs). Empty = allow all.
const ALLOWED_CHANNELS = process.env.DISCORD_ALLOWED_CHANNELS
  ? process.env.DISCORD_ALLOWED_CHANNELS.split(',').map(s => s.trim()).filter(Boolean)
  : [];
const ALLOWED_USERS = process.env.DISCORD_ALLOWED_USERS
  ? process.env.DISCORD_ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

// Default personality — matches Marilyn if she's configured
const DEFAULT_SYSTEM_PROMPT = process.env.DISCORD_SYSTEM_PROMPT ||
  'You are a helpful AI assistant accessible via Discord. You can answer questions, ' +
  'help with coding tasks, research topics, and assist with IT/DevOps work. ' +
  'Format responses with Discord markdown. Use code blocks for code. Be concise but thorough.';

const CLAUDE_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT, 10) || 120;

// Track if Claude API is reachable
let claudeHealthy = false;

async function checkClaudeHealth() {
  try {
    const headers = API_KEY ? { 'x-api-key': API_KEY } : {};
    await axios.get(`${CLAUDE_API_URL}/health`, { timeout: 5000, headers });
    claudeHealthy = true;
  } catch {
    claudeHealthy = false;
  }
}

// Check health every 30s
setInterval(checkClaudeHealth, 30000);

/**
 * Send a prompt to Claude and get the response
 */
async function askClaude(prompt, callId) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  const response = await axios.post(
    `${CLAUDE_API_URL}/chat`,
    { prompt, callId, systemPrompt: DEFAULT_SYSTEM_PROMPT },
    { timeout: CLAUDE_TIMEOUT * 1000, headers }
  );

  if (!response.data.success) {
    throw new Error(response.data.error || 'Claude returned failure');
  }

  return response.data.response;
}

/**
 * Split a long message into chunks under Discord's 2000 char limit.
 * Tries to split at code block boundaries and newlines.
 */
function splitMessage(text) {
  if (text.length <= 2000) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 2000) {
    let splitIndex = 2000;

    // Try to split at a code block boundary
    const codeBlockMatch = remaining.substring(0, 2000).match(/```\n/g);
    if (codeBlockMatch) {
      const lastBlock = remaining.substring(0, 2000).lastIndexOf('```\n');
      if (lastBlock > 500) splitIndex = lastBlock + 4;
    }

    // Try to split at a newline
    const newlineIdx = remaining.lastIndexOf('\n', 2000);
    if (newlineIdx > 500) splitIndex = newlineIdx + 1;

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log('='.repeat(50));
  console.log('  Claude Phone Discord Bot');
  console.log('='.repeat(50));
  console.log(`\nLogged in as: ${client.user.tag}`);
  console.log(`Claude API: ${CLAUDE_API_URL}`);
  console.log(`Claude health: ${claudeHealthy ? 'OK' : 'Checking...'}`);
  if (ALLOWED_CHANNELS.length) console.log(`Allowed channels: ${ALLOWED_CHANNELS.join(', ')}`);
  if (ALLOWED_USERS.length) console.log(`Allowed users: ${ALLOWED_USERS.join(', ')}`);
  console.log('\nReady for messages.\n');

  checkClaudeHealth();
});

client.on('messageCreate', async (message) => {
  // Ignore own messages
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMention = message.mentions.has(client.user);
  const isReply = message.reference?.messageId;

  // Check if we should respond
  if (!isDM && !isMention) {
    // In a server, only respond to mentions or replies to our messages
    if (ALLOWED_CHANNELS.length && !ALLOWED_CHANNELS.includes(message.channelId)) return;
    if (!isReply) return;

    // Check if the referenced message is ours
    try {
      const refMsg = await message.channel.messages.fetch(message.reference.messageId);
      if (refMsg.author.id !== client.user.id) return;
    } catch {
      return;
    }
  }

  // Filter by allowed users if configured
  if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(message.author.id)) return;

  // Extract prompt (strip mention if present)
  let prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!prompt) {
    await message.reply('Yes? What can I help you with?');
    return;
  }

  // Session ID per channel (maintains conversation context)
  const callId = `discord-${message.channelId}`;

  console.log(`[${new Date().toISOString()}] MSG from ${message.author.username}: ${prompt.substring(0, 100)}`);

  // Show typing indicator
  await message.channel.sendTyping();

  try {
    // Keep typing indicator alive for long responses
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 8000);

    const response = await askClaude(prompt, callId);

    clearInterval(typingInterval);

    console.log(`[${new Date().toISOString()}] RESP (${response.length} chars)`);

    // Split and send response
    const chunks = splitMessage(response);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ERROR:`, error.message);

    if (error.code === 'ECONNREFUSED') {
      await message.reply('I can\'t reach my brain right now (Claude API server is down). Try again in a moment.');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      await message.reply('That request took too long. Try asking something simpler, or break it into parts.');
    } else {
      await message.reply(`Something went wrong: ${error.message.substring(0, 200)}`);
    }
  }
});

client.on('error', (error) => {
  console.error(`[${new Date().toISOString()}] DISCORD ERROR:`, error.message);
});

client.on('disconnect', () => {
  console.log(`[${new Date().toISOString()}] DISCONNECTED from Discord, reconnecting...`);
});

// Login
if (!DISCORD_TOKEN) {
  console.error('ERROR: DISCORD_BOT_TOKEN not set. Get a token from https://discord.com/developers/applications');
  process.exit(1);
}

client.login(DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  client.destroy();
  process.exit(0);
});
