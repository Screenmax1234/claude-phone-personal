/**
 * Tests for the dual-provider TTS subsystem:
 *   - voice-app/lib/tts/elevenlabs.js  (native ElevenLabs)
 *   - voice-app/lib/tts/airforce.js    (OpenAI-compatible gateway)
 *   - voice-app/lib/tts-service.js     (dispatcher)
 *
 * axios is intercepted via Module._load so neither provider needs network.
 * fs is stubbed for the dispatcher so no audio files are written to disk.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const ELEVENLABS_PATH = require.resolve('../lib/tts/elevenlabs.js');
const AIRFORCE_PATH = require.resolve('../lib/tts/airforce.js');
const ELECTRONHUB_PATH = require.resolve('../lib/tts/electronhub.js');
const DISPATCHER_PATH = require.resolve('../lib/tts-service.js');

// --- Captured request state -------------------------------------------------
let lastRequest = null;

function fakeAxios(config) {
  lastRequest = config;
  return Promise.resolve({ data: Buffer.from('fake-audio') });
}

// Stub fs so the dispatcher never touches the disk. writeFileSync captures the
// buffer so we can assert it; the rest are no-ops.
const fakeFs = {
  existsSync: () => true,
  mkdirSync: () => {},
  writeFileSync: (_p, data) => { fakeFs._lastWritten = data; },
  readdirSync: () => [],
  statSync: () => ({ mtimeMs: Date.now() }),
  unlinkSync: () => {}
};
fakeFs._lastWritten = null;

const originalLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === 'axios') return fakeAxios;
  if (request === 'fs') return fakeFs;
  return originalLoad.apply(this, arguments);
};

// --- Helpers ---------------------------------------------------------------

function loadFresh(modulePath, env) {
  const saved = {};
  const envKeys = [
    'TTS_PROVIDER',
    'TTS_DEFAULT_VOICE',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_MODEL',
    'ELEVENLABS_API_URL',
    'AIRFORCE_API_KEY',
    'AIRFORCE_TTS_MODEL',
    'AIRFORCE_BASE_URL',
    'ELECTRONHUB_API_KEY',
    'ELECTRONHUB_TTS_MODEL',
    'ELECTRONHUB_BASE_URL'
  ];
  for (const k of envKeys) {
    saved[k] = process.env[k];
    if (env && Object.prototype.hasOwnProperty.call(env, k)) {
      process.env[k] = env[k];
    } else {
      delete process.env[k];
    }
  }

  delete require.cache[modulePath];
  lastRequest = null;
  fakeFs._lastWritten = null;
  const mod = require(modulePath);

  function restore() {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  return { mod, restore };
}

// --- Tests -----------------------------------------------------------------

test('TTS providers and dispatcher', async (t) => {
  await t.test('elevenlabs provider posts to native endpoint with xi-api-key', async (t) => {
    const { mod, restore } = loadFresh(ELEVENLABS_PATH, { ELEVENLABS_API_KEY: 'elev-key' });
    t.after(restore);

    const buf = await mod.synthesize('hello world', 'JAgnJveGGUh4qy4kh6dF');

    assert.ok(Buffer.isBuffer(buf));
    assert.strictEqual(lastRequest.method, 'POST');
    assert.ok(lastRequest.url.includes('api.elevenlabs.io/v1/text-to-speech/JAgnJveGGUh4qy4kh6dF'),
      'should target the elevenlabs text-to-speech path with the voice id');
    assert.strictEqual(lastRequest.headers['xi-api-key'], 'elev-key');
    assert.strictEqual(lastRequest.data.text, 'hello world');
    assert.strictEqual(lastRequest.data.model_id, 'eleven_turbo_v2');
    assert.ok(lastRequest.data.voice_settings, 'should send voice_settings');
    assert.strictEqual(lastRequest.responseType, 'arraybuffer');
  });

  await t.test('elevenlabs provider honors ELEVENLABS_MODEL override', async (t) => {
    const { mod, restore } = loadFresh(ELEVENLABS_PATH, {
      ELEVENLABS_API_KEY: 'elev-key',
      ELEVENLABS_MODEL: 'eleven_multilingual_v2'
    });
    t.after(restore);

    await mod.synthesize('hi', 'v1');

    assert.strictEqual(lastRequest.data.model_id, 'eleven_multilingual_v2');
  });

  await t.test('elevenlabs provider throws when API key missing', async (t) => {
    const { mod, restore } = loadFresh(ELEVENLABS_PATH, {});
    t.after(restore);

    await assert.rejects(() => mod.synthesize('hi', 'v1'), /ELEVENLABS_API_KEY/);
    assert.strictEqual(lastRequest, null);
  });

  await t.test('airforce provider posts to /audio/speech with Bearer auth', async (t) => {
    const { mod, restore } = loadFresh(AIRFORCE_PATH, { AIRFORCE_API_KEY: 'air-key' });
    t.after(restore);

    const buf = await mod.synthesize('hello world', '21m00Tcm4TlvDq8ikWAM');

    assert.ok(Buffer.isBuffer(buf));
    assert.strictEqual(lastRequest.method, 'POST');
    assert.strictEqual(lastRequest.url, 'https://api.airforce/v1/audio/speech');
    assert.strictEqual(lastRequest.headers.Authorization, 'Bearer air-key');
    assert.strictEqual(lastRequest.data.model, 'eleven-turbo-v2-5');
    assert.strictEqual(lastRequest.data.input, 'hello world');
    assert.strictEqual(lastRequest.data.voice, '21m00Tcm4TlvDq8ikWAM');
    assert.strictEqual(lastRequest.data.response_format, 'mp3');
    assert.strictEqual(lastRequest.responseType, 'arraybuffer');
  });

  await t.test('airforce provider honors model + base URL overrides', async (t) => {
    const { mod, restore } = loadFresh(AIRFORCE_PATH, {
      AIRFORCE_API_KEY: 'air-key',
      AIRFORCE_TTS_MODEL: 'gpt-4o-mini-tts',
      AIRFORCE_BASE_URL: 'https://custom.example.com/v1'
    });
    t.after(restore);

    await mod.synthesize('hi', 'coral');

    assert.strictEqual(lastRequest.url, 'https://custom.example.com/v1/audio/speech');
    assert.strictEqual(lastRequest.data.model, 'gpt-4o-mini-tts');
    assert.strictEqual(lastRequest.data.voice, 'coral');
  });

  await t.test('airforce provider throws when API key missing', async (t) => {
    const { mod, restore } = loadFresh(AIRFORCE_PATH, {});
    t.after(restore);

    await assert.rejects(() => mod.synthesize('hi', 'coral'), /AIRFORCE_API_KEY/);
    assert.strictEqual(lastRequest, null);
  });

  await t.test('electronhub provider posts to /audio/speech with Bearer auth', async (t) => {
    const { mod, restore } = loadFresh(ELECTRONHUB_PATH, { ELECTRONHUB_API_KEY: 'eh-key' });
    t.after(restore);

    const buf = await mod.synthesize('hello world', 'coral');

    assert.ok(Buffer.isBuffer(buf));
    assert.strictEqual(lastRequest.method, 'POST');
    assert.strictEqual(lastRequest.url, 'https://api.electronhub.ai/v1/audio/speech');
    assert.strictEqual(lastRequest.headers.Authorization, 'Bearer eh-key');
    assert.strictEqual(lastRequest.data.model, 'gpt-4o-mini-tts');
    assert.strictEqual(lastRequest.data.input, 'hello world');
    assert.strictEqual(lastRequest.data.voice, 'coral');
    assert.strictEqual(lastRequest.data.response_format, 'mp3');
    assert.strictEqual(lastRequest.responseType, 'arraybuffer');
  });

  await t.test('electronhub provider honors model + base URL overrides', async (t) => {
    const { mod, restore } = loadFresh(ELECTRONHUB_PATH, {
      ELECTRONHUB_API_KEY: 'eh-key',
      ELECTRONHUB_TTS_MODEL: 'tts-1-hd',
      ELECTRONHUB_BASE_URL: 'https://custom.eh.example.com/v1'
    });
    t.after(restore);

    await mod.synthesize('hi', 'sage');

    assert.strictEqual(lastRequest.url, 'https://custom.eh.example.com/v1/audio/speech');
    assert.strictEqual(lastRequest.data.model, 'tts-1-hd');
    assert.strictEqual(lastRequest.data.voice, 'sage');
  });

  await t.test('electronhub provider throws when API key missing', async (t) => {
    const { mod, restore } = loadFresh(ELECTRONHUB_PATH, {});
    t.after(restore);

    await assert.rejects(() => mod.synthesize('hi', 'coral'), /ELECTRONHUB_API_KEY/);
    assert.strictEqual(lastRequest, null);
  });

  await t.test('dispatcher routes to elevenlabs by default', async (t) => {
    const { mod, restore } = loadFresh(DISPATCHER_PATH, { ELEVENLABS_API_KEY: 'elev-key' });
    t.after(restore);

    const url = await mod.generateSpeech('hello', 'JAgnJveGGUh4qy4kh6dF');

    assert.ok(url.includes('/audio-files/tts-'), 'should return an audio-files URL');
    assert.ok(lastRequest.url.includes('api.elevenlabs.io'),
      'default provider should hit the elevenlabs endpoint');
    assert.ok(Buffer.isBuffer(fakeFs._lastWritten), 'should write the audio buffer to disk');
  });

  await t.test('dispatcher routes to airforce when TTS_PROVIDER=airforce', async (t) => {
    const { mod, restore } = loadFresh(DISPATCHER_PATH, {
      TTS_PROVIDER: 'airforce',
      AIRFORCE_API_KEY: 'air-key'
    });
    t.after(restore);

    const url = await mod.generateSpeech('hello', 'coral');

    assert.ok(url.includes('/audio-files/tts-'));
    assert.strictEqual(lastRequest.url, 'https://api.airforce/v1/audio/speech',
      'should route to the airforce endpoint');
  });

  await t.test('dispatcher routes to electronhub when TTS_PROVIDER=electronhub', async (t) => {
    const { mod, restore } = loadFresh(DISPATCHER_PATH, {
      TTS_PROVIDER: 'electronhub',
      ELECTRONHUB_API_KEY: 'eh-key'
    });
    t.after(restore);

    const url = await mod.generateSpeech('hello', 'coral');

    assert.ok(url.includes('/audio-files/tts-'));
    assert.strictEqual(lastRequest.url, 'https://api.electronhub.ai/v1/audio/speech',
      'should route to the electronhub endpoint');
  });

  await t.test('dispatcher throws on unknown TTS_PROVIDER', async (t) => {
    const { mod, restore } = loadFresh(DISPATCHER_PATH, { TTS_PROVIDER: 'banana' });
    t.after(restore);

    await assert.rejects(() => mod.generateSpeech('hi', 'coral'), /Unknown TTS_PROVIDER/);
  });
});
