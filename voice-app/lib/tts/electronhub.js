/**
 * ElectronHub TTS provider (OpenAI-compatible gateway)
 *
 * ElectronHub (https://api.electronhub.ai/v1) hosts OpenAI, ElevenLabs, and
 * other TTS models behind the standard OpenAI POST /v1/audio/speech endpoint,
 * authenticated with an Authorization: Bearer token.
 *
 * Voice semantics (important):
 *   - With gpt-4o-mini-tts / tts-1 / tts-1-hd the `voice` field expects an
 *     OpenAI voice name (alloy, coral, sage, echo, nova, fable, onyx, ...).
 *   - With the elevenlabs model the `voice` field accepts a descriptive name
 *     like "Will (US male)" — NOT an ElevenLabs voice ID hash.
 * The device voiceId is passed straight through; ensure it matches the model.
 */

const axios = require('axios');
const logger = require('../logger');

const ELECTRONHUB_BASE_URL = process.env.ELECTRONHUB_BASE_URL || 'https://api.electronhub.ai/v1';
const ELECTRONHUB_TTS_MODEL = process.env.ELECTRONHUB_TTS_MODEL || 'gpt-4o-mini-tts';

// Warn once when a long hash-style voice is used with an OpenAI model
const HASH_RE = /^[A-Za-z0-9]{16,}$/;
const OPENAI_VOICE_MODELS = /^(gpt-|tts-1)/;
let modelVoiceWarned = false;

/**
 * Synthesize speech via the ElectronHub OpenAI-compatible endpoint.
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - Voice (OpenAI name like "coral" for gpt-4o-mini-tts,
 *   or descriptive name like "Will (US male)" for elevenlabs model)
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
async function synthesize(text, voiceId) {
  const apiKey = process.env.ELECTRONHUB_API_KEY;
  if (!apiKey) {
    throw new Error('ELECTRONHUB_API_KEY environment variable not set');
  }

  if (!modelVoiceWarned && HASH_RE.test(voiceId || '') && OPENAI_VOICE_MODELS.test(ELECTRONHUB_TTS_MODEL)) {
    logger.warn('ElectronHub TTS: voice looks like a hash ID but model is OpenAI-style; use an OpenAI voice name (alloy, coral, sage, ...)', { voiceId, model: ELECTRONHUB_TTS_MODEL });
    modelVoiceWarned = true;
  }

  logger.info('Generating speech with ElectronHub', {
    textLength: text.length,
    voiceId,
    model: ELECTRONHUB_TTS_MODEL
  });

  let response;
  try {
    response = await axios({
      method: 'POST',
      url: `${ELECTRONHUB_BASE_URL}/audio/speech`,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      data: {
        model: ELECTRONHUB_TTS_MODEL,
        input: text,
        voice: voiceId,
        response_format: 'mp3'
      },
      responseType: 'arraybuffer'
    });
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('ElectronHub API authentication failed - check API key');
    } else if (error.response?.status === 429) {
      throw new Error('ElectronHub API rate limit exceeded');
    } else if (error.response?.status === 402) {
      throw new Error('ElectronHub API payment required - check your plan/credits');
    } else if (error.response?.status === 400) {
      throw new Error('Invalid request to ElectronHub API');
    }
    throw new Error(`ElectronHub TTS failed: ${error.message}`);
  }

  return Buffer.from(response.data);
}

module.exports = { synthesize };
