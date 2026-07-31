/**
 * ElevenLabs TTS provider (native API)
 *
 * Calls the official ElevenLabs endpoint and returns a raw MP3 buffer.
 * File I/O (saving the audio, returning a URL) is handled by the dispatcher
 * in tts-service.js so every provider shares the same file lifecycle.
 */

const axios = require('axios');
const logger = require('../logger');

const ELEVENLABS_API_URL = process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io/v1';
const MODEL_ID = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2';

/**
 * Synthesize speech via the native ElevenLabs API.
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - ElevenLabs voice ID (hash, e.g. JAgnJveGGUh4qy4kh6dF)
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
async function synthesize(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY environment variable not set');
  }

  logger.info('Generating speech with ElevenLabs', {
    textLength: text.length,
    voiceId,
    model: MODEL_ID
  });

  let response;
  try {
    response = await axios({
      method: 'POST',
      url: `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      data: {
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      },
      responseType: 'arraybuffer'
    });
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('ElevenLabs API authentication failed - check API key');
    } else if (error.response?.status === 429) {
      throw new Error('ElevenLabs API rate limit exceeded');
    } else if (error.response?.status === 400) {
      throw new Error('Invalid request to ElevenLabs API');
    }
    throw new Error(`ElevenLabs TTS failed: ${error.message}`);
  }

  return Buffer.from(response.data);
}

module.exports = { synthesize };
