import { test } from 'node:test';
import assert from 'node:assert';
import {
  validateElevenLabsKey,
  validateGroqKey
} from '../lib/validators.js';

test('validators module', async (t) => {
  await t.test('validateElevenLabsKey rejects empty key', async () => {
    const result = await validateElevenLabsKey('');
    assert.strictEqual(result.valid, false);
    assert.match(result.error, /API key cannot be empty/);
  });

  await t.test('validateElevenLabsKey rejects invalid format', async () => {
    const result = await validateElevenLabsKey('invalid-key');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  await t.test('validateGroqKey rejects empty key', async () => {
    const result = await validateGroqKey('');
    assert.strictEqual(result.valid, false);
    assert.match(result.error, /API key cannot be empty/);
  });

  await t.test('validateGroqKey rejects invalid format', async () => {
    const result = await validateGroqKey('invalid-key');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  // Note: We can't test successful validation without real API keys
  // These would be integration tests, not unit tests
});
