import { spawn, execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import {
  getDockerComposePath,
  getEnvPath,
  getConfigDir
} from './config.js';

/**
 * Detect which docker compose command to use
 * Some systems have 'docker compose' (plugin), others have 'docker-compose' (standalone)
 * @returns {{cmd: string, args: string[]}} Command and base args for compose
 */
function getComposeCommand() {
  // Try 'docker compose' (plugin) first
  try {
    execSync('docker compose version', { stdio: 'pipe' });
    return { cmd: 'docker', args: ['compose'] };
  } catch (e) {
    // Fall back to standalone docker-compose
    try {
      execSync('docker-compose --version', { stdio: 'pipe' });
      return { cmd: 'docker-compose', args: [] };
    } catch (e2) {
      // Default to plugin style, let it fail with helpful error
      return { cmd: 'docker', args: ['compose'] };
    }
  }
}

/**
 * Generate a random secret for Docker services
 * @returns {string} Random 32-character hex string
 */
function generateSecret() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Check if Docker is installed and running
 * @returns {Promise<{installed: boolean, running: boolean, error?: string}>}
 */
export async function checkDocker() {
  // Check if docker command exists
  const installed = await new Promise((resolve) => {
    const check = spawn('docker', ['--version']);
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });

  if (!installed) {
    return {
      installed: false,
      running: false,
      error: 'Docker not found. Please install Docker from https://docs.docker.com/engine/install/'
    };
  }

  // Check if Docker daemon is running by running a simple command
  const running = await new Promise((resolve) => {
    const check = spawn('docker', ['ps', '-q'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });

  if (!running) {
    return {
      installed: true,
      running: false,
      error: 'Docker is installed but not running. Please start Docker Desktop.'
    };
  }

  return {
    installed: true,
    running: true
  };
}

/**
 * Generate Discord bot section for docker-compose (only if token configured)
 * @param {object} config - Configuration object
 * @returns {string} Docker compose service section
 */
function generateDiscordComposeSection(config) {
  const discordBotPath = config.paths.discordBot ||
    config.paths.voiceApp.replace(/voice-app$/, 'discord-bot');
  return `
  discord-bot:
    build: ${discordBotPath}
    container_name: discord-bot
    restart: unless-stopped
    network_mode: host
    env_file:
      - ${getEnvPath()}
`;
}

/**
 * Generate docker-compose.yml from config
 * @param {object} config - Configuration object
 * @returns {string} Docker compose YAML content
 */
export function generateDockerCompose(config) {
  const externalIp = config.server.externalIp === 'auto' ? '${EXTERNAL_IP}' : config.server.externalIp;

  // Ensure secrets exist in config
  if (!config.secrets) {
    config.secrets = {
      drachtio: generateSecret(),
      freeswitch: generateSecret()
    };
  }

  // Determine drachtio port from config (5070 when 3CX SBC detected, 5060 otherwise)
  const drachtioPort = config.deployment && config.deployment.pi && config.deployment.pi.drachtioPort
    ? config.deployment.pi.drachtioPort
    : 5060;

  // Determine if running on Pi (ARM64) - use specific versions with platform
  const isPiMode = config.deployment && config.deployment.mode === 'pi-split';
  const drachtioImage = isPiMode ? 'drachtio/drachtio-server:0.9.4' : 'drachtio/drachtio-server:latest';
  const freeswitchImage = 'drachtio/drachtio-freeswitch-mrf:latest';
  const platformLine = isPiMode ? '\n    platform: linux/arm64' : '';

  return `version: '3.8'

# CRITICAL: All containers must use network_mode: host
# Docker bridge networking causes FreeSWITCH to advertise internal IPs
# in SDP, making RTP unreachable from external callers.

services:
  drachtio:
    image: ${drachtioImage}${platformLine}
    container_name: drachtio
    restart: unless-stopped
    network_mode: host
    command: >
      drachtio
      --contact "sip:*:${drachtioPort};transport=tcp,udp"
      --secret \${DRACHTIO_SECRET}
      --port 9022
      --loglevel info

  freeswitch:
    image: ${freeswitchImage}${platformLine}
    container_name: freeswitch
    restart: unless-stopped
    network_mode: host
    command: >
      freeswitch
      --sip-port 5080
      --rtp-range-start 30000
      --rtp-range-end 30100
    # RTP ports 30000-30100 avoid conflict with 3CX SBC (uses 20000-20099)
    environment:
      - EXTERNAL_IP=${externalIp}

  voice-app:
    build: ${config.paths.voiceApp}
    container_name: voice-app
    restart: unless-stopped
    network_mode: host
    env_file:
      - ${getEnvPath()}
    volumes:
      - ${config.paths.voiceApp}/audio:/app/audio
      - ${config.paths.voiceApp}/config:/app/config
    depends_on:
      - drachtio
      - freeswitch${config.discord?.botToken ? generateDiscordComposeSection(config) : ''}
`;
}

/**
 * Generate .env file from config
 * @param {object} config - Configuration object
 * @returns {string} Environment file content
 */
export function generateEnvFile(config) {
  // Ensure secrets exist in config
  if (!config.secrets) {
    config.secrets = {
      drachtio: generateSecret(),
      freeswitch: generateSecret()
    };
  }

  // Determine Claude API URL based on deployment mode
  let claudeApiUrl;
  if (config.deployment && config.deployment.mode === 'pi-split' && config.deployment.pi && config.deployment.pi.macIp) {
    // Pi mode: point to remote API server
    claudeApiUrl = `http://${config.deployment.pi.macIp}:${config.server.claudeApiPort}`;
  } else if (config.deployment && config.deployment.mode === 'voice-server' && config.deployment.apiServerIp) {
    // Voice server mode (non-Pi): point to remote API server
    claudeApiUrl = `http://${config.deployment.apiServerIp}:${config.server.claudeApiPort}`;
  } else {
    // Both or api-server mode: local API server
    claudeApiUrl = `http://localhost:${config.server.claudeApiPort}`;
  }

  const lines = [
    '# ====================================',
    '# WARNING: DO NOT SHARE THIS FILE',
    '# Contains API keys and passwords',
    '# ====================================',
    '# Claude Phone Configuration',
    '# Generated by claude-phone CLI',
    '# ====================================',
    '',
    '# Network Configuration',
    `EXTERNAL_IP=${config.server.externalIp === 'auto' ? 'auto' : config.server.externalIp}`,
    '',
    '# Drachtio Configuration',
    'DRACHTIO_HOST=127.0.0.1',
    'DRACHTIO_PORT=9022',
    `DRACHTIO_SECRET=${config.secrets.drachtio}`,
    // SIP port for Contact header (5070 when 3CX SBC is present, 5060 otherwise)
    `DRACHTIO_SIP_PORT=${config.deployment?.pi?.drachtioPort || 5060}`,
    '',
    '# FreeSWITCH Configuration',
    'FREESWITCH_HOST=127.0.0.1',
    'FREESWITCH_PORT=8021',
    // Note: This is the default ESL password for drachtio/drachtio-freeswitch-mrf
    'FREESWITCH_SECRET=JambonzR0ck$',
    '',
    '# 3CX / SIP Configuration',
    `SIP_DOMAIN=${config.sip.domain}`,
    `SIP_REGISTRAR=${config.sip.registrar}`,
    '',
    '# Default extension (primary device)',
    `SIP_EXTENSION=${config.devices[0].extension}`,
    `SIP_AUTH_ID=${config.devices[0].authId}`,
    `SIP_PASSWORD=${config.devices[0].password}`,
    '',
    '# Claude API Server',
    `CLAUDE_API_URL=${claudeApiUrl}`,
    '# Claude query timeout in seconds (gateway models may need 60+)',
    `CLAUDE_TIMEOUT=${config.server?.claudeTimeout || 60}`,
    '',
    '# Text-to-Speech (provider selected by TTS_PROVIDER)',
    `TTS_PROVIDER=${(config.api.tts && config.api.tts.provider) || 'elevenlabs'}`,
    `TTS_DEFAULT_VOICE=${config.devices[0].voiceId}`,
    '',
    '# ElevenLabs (native) - used when TTS_PROVIDER=elevenlabs',
    `ELEVENLABS_API_KEY=${(config.api.tts && config.api.tts.elevenlabs && config.api.tts.elevenlabs.apiKey) || ''}`,
    `ELEVENLABS_MODEL=${(config.api.tts && config.api.tts.elevenlabs && config.api.tts.elevenlabs.model) || 'eleven_turbo_v2'}`,
    '',
    '# Airforce (OpenAI-compatible gateway) - used when TTS_PROVIDER=airforce',
    `AIRFORCE_API_KEY=${(config.api.tts && config.api.tts.airforce && config.api.tts.airforce.apiKey) || ''}`,
    `AIRFORCE_TTS_MODEL=${(config.api.tts && config.api.tts.airforce && config.api.tts.airforce.model) || 'eleven-turbo-v2-5'}`,
    `AIRFORCE_BASE_URL=${(config.api.tts && config.api.tts.airforce && config.api.tts.airforce.baseUrl) || 'https://api.airforce/v1'}`,
    '',
    '# ElectronHub (OpenAI-compatible gateway) - used when TTS_PROVIDER=electronhub',
    `ELECTRONHUB_API_KEY=${(config.api.tts && config.api.tts.electronhub && config.api.tts.electronhub.apiKey) || ''}`,
    `ELECTRONHUB_TTS_MODEL=${(config.api.tts && config.api.tts.electronhub && config.api.tts.electronhub.model) || 'gpt-4o-mini-tts'}`,
    `ELECTRONHUB_BASE_URL=${(config.api.tts && config.api.tts.electronhub && config.api.tts.electronhub.baseUrl) || 'https://api.electronhub.ai/v1'}`,
    '',
    '# Groq (Whisper STT)',
    `GROQ_API_KEY=${config.api.groq.apiKey}`,
    '# STT model: whisper-large-v3 (good multilingual); leave WHISPER_LANGUAGE unset for auto-detect',
    `GROQ_MODEL=${config.api?.groq?.model || 'whisper-large-v3'}`,
    `WHISPER_LANGUAGE=${config.api?.groq?.language || ''}`,
    '',
    '# Application Settings',
    `HTTP_PORT=${config.server.httpPort}`,
    'WS_PORT=3001',
    'AUDIO_DIR=/app/audio',
    '',
    '# Outbound Call Settings',
    'MAX_CONVERSATION_TURNS=10',
    'OUTBOUND_RING_TIMEOUT=30',
    '',
    '# Discord Bot (optional — only runs if token is set)',
    `DISCORD_BOT_TOKEN=${config.discord?.botToken || ''}`,
    `DISCORD_ALLOWED_CHANNELS=${config.discord?.allowedChannels || ''}`,
    `DISCORD_ALLOWED_USERS=${config.discord?.allowedUsers || ''}`,
    `DISCORD_SYSTEM_PROMPT=${config.discord?.systemPrompt || ''}`,
    '',
    '# Remote API Access (optional — set to enable auth on port 3333)',
    `API_KEY=${config.discord?.apiKey || config.secrets?.apiKey || ''}`,
    '',
    '# Fast LLM (optional — quick responses without Claude Code tools)',
    '# Primary (Cerebras recommended for max speed)',
    `FAST_LLM_PROVIDER=${config.fastLlm?.provider || ''}`,
    `FAST_LLM_BASE_URL=${config.fastLlm?.baseUrl || ''}`,
    `FAST_LLM_API_KEY=${config.fastLlm?.apiKey || ''}`,
    `FAST_LLM_MODEL=${config.fastLlm?.model || ''}`,
    '# Fallback (Groq — used if Cerebras errors/rate-limits)',
    `FAST_LLM_FALLBACK_PROVIDER=${config.fastLlm?.fallbackProvider || ''}`,
    `FAST_LLM_FALLBACK_BASE_URL=${config.fastLlm?.fallbackBaseUrl || ''}`,
    `FAST_LLM_FALLBACK_API_KEY=${config.fastLlm?.fallbackApiKey || ''}`,
    `FAST_LLM_FALLBACK_MODEL=${config.fastLlm?.fallbackModel || ''}`,
    `FAST_LLM_TIMEOUT=${config.fastLlm?.timeout || 5}`,
    ''
  ];

  return lines.join('\n');
}

/**
 * Write Docker configuration files
 * @param {object} config - Configuration object
 * @returns {Promise<void>}
 */
export async function writeDockerConfig(config) {
  const dockerComposePath = getDockerComposePath();
  const envPath = getEnvPath();

  const dockerComposeContent = generateDockerCompose(config);
  const envContent = generateEnvFile(config);

  await fs.promises.writeFile(dockerComposePath, dockerComposeContent, { mode: 0o644 });
  await fs.promises.writeFile(envPath, envContent, { mode: 0o600 });
}

/**
 * Start Docker containers
 * @returns {Promise<void>}
 */
export async function startContainers() {
  const configDir = getConfigDir();
  const dockerComposePath = getDockerComposePath();

  if (!fs.existsSync(dockerComposePath)) {
    throw new Error('Docker configuration not found. Run "claude-phone setup" first.');
  }

  const compose = getComposeCommand();
  const composeArgs = [...compose.args, '-f', dockerComposePath, 'up', '-d', '--build'];

  return new Promise((resolve, reject) => {
    const child = spawn(compose.cmd, composeArgs, {
      cwd: configDir,
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // AC22: Detect ARM64 image pull failure
        if (output.includes('no matching manifest') ||
            output.includes('image with reference') && output.includes('arm64')) {
          const error = new Error(
            'ARM64 Docker image pull failed.\n\n' +
            'Try manually pulling images:\n' +
            '  docker pull drachtio/drachtio-server:latest\n' +
            '  docker pull drachtio/drachtio-freeswitch-mrf:latest\n\n' +
            'If images are not available for ARM64, you may need to build them locally.'
          );
          reject(error);
        } else {
          reject(new Error(`Docker compose failed (exit ${code}): ${output}`));
        }
      }
    });
  });
}

/**
 * Stop Docker containers
 * @returns {Promise<void>}
 */
export async function stopContainers() {
  const configDir = getConfigDir();
  const dockerComposePath = getDockerComposePath();

  if (!fs.existsSync(dockerComposePath)) {
    // No containers to stop
    return;
  }

  const compose = getComposeCommand();
  const composeArgs = [...compose.args, '-f', dockerComposePath, 'down'];

  return new Promise((resolve, reject) => {
    const child = spawn(compose.cmd, composeArgs, {
      cwd: configDir,
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker compose down failed (exit ${code}): ${output}`));
      }
    });
  });
}

/**
 * Get status of Docker containers
 * @returns {Promise<Array<{name: string, status: string}>>}
 */
export async function getContainerStatus() {
  const dockerComposePath = getDockerComposePath();

  if (!fs.existsSync(dockerComposePath)) {
    return [];
  }

  const compose = getComposeCommand();
  const composeArgs = [...compose.args, '-f', dockerComposePath, 'ps', '--format', 'json'];

  return new Promise((resolve) => {
    const child = spawn(compose.cmd, composeArgs, {
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          // Parse JSON lines (one per container)
          const lines = output.trim().split('\n').filter(l => l);
          const containers = lines.map(line => {
            const data = JSON.parse(line);
            return {
              name: data.Name || data.Service,
              status: data.State || data.Status
            };
          });
          resolve(containers);
        } catch (error) {
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  });
}
