/**
 * Fast LLM Client — Cerebras (primary) with Groq fallback
 *
 * For simple queries that don't need Claude Code tools.
 * Latency target: <2s end-to-end.
 *
 * Tries providers in order; returns first success.
 * On total failure, throws so the caller can fall back to Claude Code.
 *
 * Env vars:
 *   FAST_LLM_PROVIDER=cerebras (or groq, openai, electronhub)
 *   FAST_LLM_BASE_URL=https://api.cerebras.ai/v1
 *   FAST_LLM_API_KEY=...
 *   FAST_LLM_MODEL=gpt-oss-120b
 *   FAST_LLM_TIMEOUT=5
 *
 * Fallback:
 *   FAST_LLM_FALLBACK_PROVIDER=groq
 *   FAST_LLM_FALLBACK_BASE_URL=https://api.groq.com/openai/v1
 *   FAST_LLM_FALLBACK_API_KEY=...
 *   FAST_LLM_FALLBACK_MODEL=gpt-oss-120b
 */

const axios = require('axios');

function loadProvider(prefix) {
  const provider = process.env[`${prefix}_PROVIDER`];
  if (!provider) return null;
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`];
  const model = process.env[`${prefix}_MODEL`];
  if (!baseUrl || !apiKey || !model) return null;
  return { provider, baseUrl, apiKey, model };
}

const PRIMARY = (() => {
  const p = loadProvider('FAST_LLM');
  if (p) return p;
  // Sensible defaults
  return {
    provider: 'cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKey: process.env.FAST_LLM_API_KEY,
    model: process.env.FAST_LLM_MODEL || 'gpt-oss-120b',
  };
})();

const FALLBACK = loadProvider('FAST_LLM_FALLBACK');

const TIMEOUT_MS = (parseInt(process.env.FAST_LLM_TIMEOUT, 10) || 5) * 1000;

/**
 * Call one provider's OpenAI-compatible /chat/completions endpoint
 * @param {object} providerConfig - {baseUrl, apiKey, model, provider}
 * @param {string} systemPrompt - System instructions (Valori's personality)
 * @param {string} userPrompt - User's question
 * @returns {Promise<string>} Response text
 */
async function callProvider(providerConfig, systemPrompt, userPrompt) {
  const { baseUrl, apiKey, model, provider } = providerConfig;
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';

  const response = await axios.post(
    url,
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt || 'You are a helpful voice assistant. Be concise.' },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 300,
    },
    {
      timeout: TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  const text = response.data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${provider} returned empty response`);
  return text.trim();
}

/**
 * Query the fast LLM with automatic fallback.
 * @param {string} userPrompt - User's question
 * @param {object} [options]
 * @param {string} [options.systemPrompt] - Personality system prompt
 * @returns {Promise<{response: string, provider: string}>}
 */
async function query(userPrompt, options = {}) {
  const systemPrompt = options.systemPrompt || null;
  const ts = new Date().toISOString();

  // Try primary
  try {
    const text = await callProvider(PRIMARY, systemPrompt, userPrompt);
    console.log(`[${ts}] FAST_LLM ${PRIMARY.provider} responded (${text.length} chars)`);
    return { response: text, provider: PRIMARY.provider };
  } catch (primaryErr) {
    console.warn(`[${ts}] FAST_LLM ${PRIMARY.provider} failed: ${primaryErr.message}`);
  }

  // Try fallback
  if (FALLBACK) {
    try {
      const text = await callProvider(FALLBACK, systemPrompt, userPrompt);
      console.log(`[${ts}] FAST_LLM ${FALLBACK.provider} responded (${text.length} chars)`);
      return { response: text, provider: FALLBACK.provider };
    } catch (fallbackErr) {
      console.warn(`[${ts}] FAST_LLM ${FALLBACK.provider} failed: ${fallbackErr.message}`);
    }
  }

  throw new Error('All fast LLM providers failed');
}

/**
 * Check if fast LLM is configured and available
 * @returns {boolean}
 */
function isAvailable() {
  return !!(PRIMARY.apiKey && PRIMARY.baseUrl && PRIMARY.model);
}

module.exports = {
  query,
  isAvailable,
  primaryProvider: () => PRIMARY.provider,
};
