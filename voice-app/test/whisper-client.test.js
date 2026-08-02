/**
 * Tests for the Groq Whisper STT client.
 *
 * The whisper-client lazily constructs an `openai` SDK client pointed at
 * Groq's OpenAI-compatible endpoint. Neither `openai` nor `wavefile` need to
 * be installed to run these tests — we intercept Module._load to inject fakes.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const WHISPER_PATH = require.resolve('../lib/whisper-client.js');

// --- Fake dependencies -----------------------------------------------------
const recorded = { ctor: [], create: [] };

function FakeOpenAI(opts) {
  recorded.ctor.push(opts);
  this.audio = {
    transcriptions: {
      create: async (args) => {
        recorded.create.push(args);
        // Drain the file stream so it fully closes before the caller's
        // `finally` block deletes the temp file (avoids a late ENOENT).
        if (args.file && typeof args.file.on === 'function') {
          await new Promise((resolve) => {
            args.file.on('end', resolve);
            args.file.on('error', resolve);
            args.file.resume();
          });
        }
        return 'transcribed text';
      }
    }
  };
}

class FakeWaveFile {
  fromScratch() {}
  toBuffer() {
    return Buffer.from('fake-wav');
  }
}

const originalLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === 'openai') return FakeOpenAI;
  if (request === 'wavefile') return { WaveFile: FakeWaveFile };
  return originalLoad.apply(this, arguments);
};

// --- Helpers ---------------------------------------------------------------

/**
 * Load a fresh copy of whisper-client with the given env vars applied.
 * Constants (GROQ_MODEL/GROQ_BASE_URL) are captured at module load time, so
 * the module cache must be cleared between tests to pick up new env values.
 * Returns the module plus a `restore` callback that reverts the env.
 */
function loadFresh(env) {
  const saved = {};
  const envKeys = ['GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_BASE_URL'];
  for (const k of envKeys) {
    saved[k] = process.env[k];
    if (env && Object.prototype.hasOwnProperty.call(env, k)) {
      process.env[k] = env[k];
    } else {
      delete process.env[k];
    }
  }

  delete require.cache[WHISPER_PATH];
  recorded.ctor.length = 0;
  recorded.create.length = 0;
  const mod = require(WHISPER_PATH);

  // NOTE: env is left in place for the test run because getGroqClient() reads
  // GROQ_API_KEY at call time. Call restore() (e.g. via t.after) afterwards.
  function restore() {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  return { mod, restore };
}

// --- Tests -----------------------------------------------------------------

test('whisper-client (Groq)', async (t) => {
  await t.test('uses Groq endpoint and default multilingual model', async (t) => {
    const { mod: whisper, restore } = loadFresh({ GROQ_API_KEY: 'gsk_test_key' });
    t.after(restore);

    const text = await whisper.transcribe(Buffer.from('audio'), { format: 'wav' });

    assert.strictEqual(text, 'transcribed text');
    assert.strictEqual(recorded.ctor.length, 1);
    assert.strictEqual(recorded.ctor[0].apiKey, 'gsk_test_key');
    assert.strictEqual(recorded.ctor[0].baseURL, 'https://api.groq.com/openai/v1');
    assert.strictEqual(recorded.create.length, 1);
    assert.strictEqual(recorded.create[0].model, 'whisper-large-v3');
    assert.strictEqual(recorded.create[0].response_format, 'text');
    // No language field by default = auto-detect
    assert.strictEqual(recorded.create[0].language, undefined);
  });

  await t.test('honors GROQ_MODEL override', async (t) => {
    const { mod: whisper, restore } = loadFresh({
      GROQ_API_KEY: 'gsk_test_key',
      GROQ_MODEL: 'whisper-large-v3-turbo'
    });
    t.after(restore);

    await whisper.transcribe(Buffer.from('audio'), { format: 'wav' });

    assert.strictEqual(recorded.create[0].model, 'whisper-large-v3-turbo');
  });

  await t.test('honors GROQ_BASE_URL override', async (t) => {
    const { mod: whisper, restore } = loadFresh({
      GROQ_API_KEY: 'gsk_test_key',
      GROQ_BASE_URL: 'https://custom.example.com/v1'
    });
    t.after(restore);

    await whisper.transcribe(Buffer.from('audio'), { format: 'wav' });

    assert.strictEqual(recorded.ctor[0].baseURL, 'https://custom.example.com/v1');
  });

  await t.test('passes language and accepts PCM format via pcmToWav', async (t) => {
    const { mod: whisper, restore } = loadFresh({ GROQ_API_KEY: 'gsk_test_key' });
    t.after(restore);

    // Build a valid 16-bit PCM buffer (e.g. 4 zero samples)
    const pcm = Buffer.alloc(8);
    const text = await whisper.transcribe(pcm, { format: 'pcm', sampleRate: 16000, language: 'fr' });

    assert.strictEqual(text, 'transcribed text');
    assert.strictEqual(recorded.create[0].language, 'fr');
  });

  await t.test('isAvailable reflects GROQ_API_KEY presence', async () => {
    const withKey = loadFresh({ GROQ_API_KEY: 'gsk_test_key' });
    assert.strictEqual(withKey.mod.isAvailable(), true);
    withKey.restore();

    const withoutKey = loadFresh({});
    assert.strictEqual(withoutKey.mod.isAvailable(), false);
    withoutKey.restore();
  });

  await t.test('transcribe throws when API key is not configured', async (t) => {
    const { mod: whisper, restore } = loadFresh({});
    t.after(restore);

    await assert.rejects(
      () => whisper.transcribe(Buffer.from('audio'), { format: 'wav' }),
      /Groq API key not configured/
    );
    assert.strictEqual(recorded.ctor.length, 0);
  });
});
