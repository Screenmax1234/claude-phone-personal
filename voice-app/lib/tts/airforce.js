/**
 * Airforce TTS provider (OpenAI-compatible gateway)
 *
 * Airforce (https://api.airforce/v1) hosts ElevenLabs and OpenAI TTS models
 * behind the standard OpenAI POST /v1/audio/speech endpoint, authenticated
 * with an Authorization: Bearer token.
 *
 * Voice semantics (important):
 *   - With an eleven-* model (eleven-turbo-v2-5, eleven-v3, ...) the `voice`
 *     field accepts an ElevenLabs voice ID (hash), so existing device voice IDs
 *     work unchanged.
 *   - With gpt-4o-mini-tts / tts-1 the `voice` field expects an OpenAI voice
 *     name (alloy, coral, sage, echo, ...).
 * The device voiceId is passed straight through; ensure it matches the model.
 */

const axios = require('axios');
const logger = require('../logger');

const AIRFORCE_BASE_URL = process.env.AIRFORCE_BASE_URL || 'https://api.airforce/v1';
const AIRFORCE_TTS_MODEL = process.env.AIRFORCE_TTS_MODEL || 'eleven-turbo-v2-5';

// ElevenLabs voice IDs are long alphanumeric hashes; OpenAI voices are short
// names. Warn once when the combination looks mismatched.
const HASH_RE = /^[A-Za-z0-9]{16,}$/;
const OPENAI_VOICE_MODELS = /^(gpt-|tts-1)/;
let modelVoiceWarned = false;

/**
 * Synthesize speech via the Airforce OpenAI-compatible endpoint.
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - Voice (ElevenLabs hash for eleven-* models, or
 *   OpenAI name like "coral" for gpt-4o-mini-tts / tts-1)
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
async function synthesize(text, voiceId) {
  const apiKey = process.env.AIRFORCE_API_KEY;
  if (!apiKey) {
    throw new Error('AIRFORCE_API_KEY environment variable not set');
  }

  if (!modelVoiceWarned && HASH_RE.test(voiceId || '') && OPENAI_VOICE_MODELS.test(AIRFORCE_TTS_MODEL)) {
    logger.warn('Airforce TTS: voice looks like an ElevenLabs ID but model is OpenAI-style; set AIRFORCE_TTS_MODEL to an eleven-* model or use an OpenAI voice name', { voiceId, model: AIRFORCE_TTS_MODEL });
    modelVoiceWarned = true;
  }

  logger.info('Generating speech with Airforce', {
    textLength: text.length,
    voiceId,
    model: AIRFORCE_TTS_MODEL
  });

  let response;
  try {
    response = await axios({
      method: 'POST',
      url: `${AIRFORCE_BASE_URL}/audio/speech`,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      data: {
        model: AIRFORCE_TTS_MODEL,
        input: text,
        voice: voiceId,
        response_format: 'mp3'
      },
      responseType: 'arraybuffer'
    });
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Airforce API authentication failed - check API key');
    } else if (error.response?.status === 429) {
      throw new Error('Airforce API rate limit exceeded');
    } else if (error.response?.status === 400) {
      throw new Error('Invalid request to Airforce API');
    }
    throw new Error(`Airforce TTS failed: ${error.message}`);
  }

  return Buffer.from(response.data);
}

module.exports = { synthesize };
