/**
 * Text-to-Speech dispatcher
 *
 * Routes generateSpeech() to the configured TTS provider. Both providers
 * return a raw audio Buffer; this module handles filename generation, writing
 * the file to the audio directory, and returning the HTTP URL for FreeSWITCH
 * playback. Call sites are unchanged: ttsService.generateSpeech(text, voiceId).
 *
 * Provider is selected via the TTS_PROVIDER env var (default "elevenlabs"):
 *   - elevenlabs : native ElevenLabs API (api.elevenlabs.io)
 *   - airforce   : OpenAI-compatible gateway (api.airforce) hosting the
 *                  eleven-* and gpt-4o-mini-tts models
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const elevenlabs = require('./tts/elevenlabs');
const airforce = require('./tts/airforce');

const PROVIDERS = { elevenlabs, airforce };

const ACTIVE_PROVIDER = (process.env.TTS_PROVIDER || 'elevenlabs').toLowerCase();
// Default voice when a caller omits voiceId. The Morpheus hash is only valid for
// ElevenLabs / airforce eleven-* models; for airforce OpenAI-style models a
// short name like "coral" is required. TTS_DEFAULT_VOICE (set from device
// config) overrides either fallback in production.
const DEFAULT_VOICE_ID = process.env.TTS_DEFAULT_VOICE ||
  (ACTIVE_PROVIDER === 'airforce' ? 'coral' : 'JAgnJveGGUh4qy4kh6dF'); // Morpheus

// Audio output directory (set via setAudioDir)
let audioDir = path.join(__dirname, '../audio-temp');

/**
 * Set the audio output directory
 * @param {string} dir - Absolute path to audio directory
 */
function setAudioDir(dir) {
  audioDir = dir;

  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
    logger.info('Created audio directory', { path: audioDir });
  }
}

/**
 * Generate unique filename for audio file
 * @param {string} text - Text being converted
 * @returns {string} Filename (without path)
 */
function generateFilename(text) {
  const hash = crypto.createHash('md5').update(text).digest('hex').substring(0, 8);
  const timestamp = Date.now();
  return `tts-${timestamp}-${hash}.mp3`;
}

function getProvider() {
  const provider = PROVIDERS[ACTIVE_PROVIDER];
  if (!provider) {
    throw new Error(`Unknown TTS_PROVIDER "${ACTIVE_PROVIDER}". Valid values: elevenlabs, airforce`);
  }
  return provider;
}

/**
 * Convert text to speech and return an HTTP URL to the generated audio file.
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - Voice identifier (provider/model specific)
 * @returns {Promise<string>} HTTP URL to audio file
 */
async function generateSpeech(text, voiceId = DEFAULT_VOICE_ID) {
  const startTime = Date.now();
  const provider = getProvider();

  try {
    const audioBuffer = await provider.synthesize(text, voiceId);

    const filename = generateFilename(text);
    const filepath = path.join(audioDir, filename);
    fs.writeFileSync(filepath, audioBuffer);

    const latency = Date.now() - startTime;
    logger.info('Speech generation successful', {
      provider: ACTIVE_PROVIDER,
      filename,
      fileSize: audioBuffer.length,
      latency,
      textLength: text.length
    });

    return `http://127.0.0.1:3000/audio-files/${filename}`;
  } catch (error) {
    const latency = Date.now() - startTime;
    logger.error('Speech generation failed', {
      provider: ACTIVE_PROVIDER,
      error: error.message,
      latency,
      textLength: text?.length
    });
    throw error;
  }
}

/**
 * Clean up old audio files (older than specified age)
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 1 hour)
 */
function cleanupOldFiles(maxAgeMs = 60 * 60 * 1000) {
  try {
    const now = Date.now();
    const files = fs.readdirSync(audioDir);

    let deletedCount = 0;
    files.forEach(file => {
      if (!file.startsWith('tts-') || !file.endsWith('.mp3')) {
        return;
      }

      const filepath = path.join(audioDir, file);
      const stats = fs.statSync(filepath);
      const age = now - stats.mtimeMs;

      if (age > maxAgeMs) {
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      logger.info('Cleaned up old audio files', { deletedCount });
    }
  } catch (error) {
    logger.warn('Failed to cleanup old audio files', { error: error.message });
  }
}

// Initialize audio directory
setAudioDir(audioDir);

// Setup periodic cleanup (every 30 minutes). unref() so it doesn't keep the
// process alive on shutdown (e.g. during graceful exit or test runs).
setInterval(() => {
  cleanupOldFiles();
}, 30 * 60 * 1000).unref();

module.exports = {
  generateSpeech,
  setAudioDir,
  cleanupOldFiles
};
