/**
 * Groq Whisper API Client for Speech-to-Text
 * Converts audio buffers (L16 PCM from FreeSWITCH) to text
 *
 * Groq exposes an OpenAI-compatible transcription endpoint, so we reuse the
 * `openai` SDK with a custom baseURL. Model and endpoint are configurable via
 * env vars so future model swaps need no code changes.
 */

const OpenAI = require("openai");
const WaveFile = require("wavefile").WaveFile;
const fs = require("fs");
const os = require("os");
const path = require("path");

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const GROQ_MODEL = process.env.GROQ_MODEL || "whisper-large-v3-turbo";

// Lazy-initialized Groq client (uses the openai SDK pointed at Groq's endpoint)
let groq = null;

function getGroqClient() {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) {
      console.warn("[WHISPER] GROQ_API_KEY not set - STT will not work");
      return null;
    }
    groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: GROQ_BASE_URL
    });
  }
  return groq;
}

/**
 * Convert L16 PCM buffer to WAV format for Whisper API
 * @param {Buffer} pcmBuffer - Raw L16 PCM audio data
 * @param {number} sampleRate - Sample rate (default: 8000 Hz for telephony)
 * @returns {Buffer} WAV file buffer
 */
function pcmToWav(pcmBuffer, sampleRate = 8000) {
  const wav = new WaveFile();

  // Convert Buffer to Int16Array for wavefile library
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);

  // Create WAV from raw PCM data
  wav.fromScratch(1, sampleRate, "16", samples);

  return Buffer.from(wav.toBuffer());
}

/**
 * Transcribe audio using Groq's Whisper API
 * @param {Buffer} audioBuffer - Audio data (either WAV or raw PCM)
 * @param {Object} options - Transcription options
 * @param {string} options.format - Input format: "wav" or "pcm" (default: "pcm")
 * @param {number} options.sampleRate - Sample rate for PCM (default: 8000)
 * @param {string} options.language - Language code (default: "en")
 * @returns {Promise<string>} Transcribed text
 */
async function transcribe(audioBuffer, options = {}) {
  const {
    format = "pcm",
    sampleRate = 8000,
    language = "en"
  } = options;

  const client = getGroqClient();
  if (!client) {
    throw new Error("Groq API key not configured");
  }

  // Convert PCM to WAV if needed
  let wavBuffer;
  if (format === "pcm") {
    wavBuffer = pcmToWav(audioBuffer, sampleRate);
  } else {
    wavBuffer = audioBuffer;
  }

  // Write to temp file (Whisper API requires a file)
  const tempFile = path.join(os.tmpdir(), "whisper-" + Date.now() + ".wav");
  fs.writeFileSync(tempFile, wavBuffer);

  try {
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: GROQ_MODEL,
      language: language,
      response_format: "text"
    });

    const timestamp = new Date().toISOString();
    console.log("[" + timestamp + "] WHISPER Transcribed: " + transcription.substring(0, 100) + (transcription.length > 100 ? "..." : ""));

    return transcription;
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if Whisper API is configured and available
 * @returns {boolean} True if API key is set
 */
function isAvailable() {
  return !!process.env.GROQ_API_KEY;
}

module.exports = {
  transcribe,
  pcmToWav,
  isAvailable
};
