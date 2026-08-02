# Claude Phone Discord Bot

A Discord bot that bridges to your Claude Phone API server, giving you text-based access to Claude from any Discord channel or DM.

## Features

- Responds to DMs and mentions in servers
- Replies to messages that reply to the bot
- Per-channel conversation context (multi-turn)
- Typing indicator while Claude thinks
- Code block formatting for code responses
- Splits long responses at Discord's 2000 char limit
- Configurable personality via system prompt
- Optional channel/user restrictions

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to **Bot** section → **Add Bot**
4. Copy the bot token
5. Enable **MESSAGE CONTENT INTENT** (under Privileged Gateway Intents)
6. Invite the bot using:
   ```
   https://discord.com/api/oauth2/authorize?client_id=APP_ID&permissions=274877975552&scope=bot
   ```

### 2. Configure

```bash
claude-phone discord
```

This will prompt for your bot token and optionally generate an API key for remote access.

### 3. Restart

```bash
claude-phone stop
claude-phone start
```

The Discord bot runs as a Docker container alongside voice-app.

## Usage

- **DM the bot** — just send a message
- **In a server** — mention the bot (@Marilyn what's the weather?) or reply to one of its messages
- **Conversations** — each channel maintains its own context, so you can have separate conversations in different channels

## Remote API Access

If you generated an API key during setup, you can hit the API server from your PC:

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What Docker containers are running?"}' \
  http://YOUR_VM_IP:3333/chat
```

Or use SSH tunneling for secure access:

```bash
ssh -L 3333:localhost:3333 root@YOUR_VM_IP
# Then access http://localhost:3333 locally
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_ALLOWED_CHANNELS` | Comma-separated channel IDs (blank = all) |
| `DISCORD_ALLOWED_USERS` | Comma-separated user IDs (blank = all) |
| `DISCORD_SYSTEM_PROMPT` | Custom personality/instructions |
| `API_KEY` | Auth key for remote API access |
| `CLAUDE_API_URL` | API server URL (default: `http://localhost:3333`) |
| `CLAUDE_TIMEOUT` | Query timeout in seconds (default: 120) |
