const { test } = require('node:test');
const assert = require('node:assert');
const { classify } = require('../lib/router');

test('router', async (t) => {
  await t.test('routes knowledge questions to fast path', () => {
    const cases = [
      "What's the capital of Greece?",
      'Who invented the telephone?',
      'How do you say hello in Greek?',
      'What is the meaning of life?',
      "What's 47 times 83?",
      'Tell me about the Peloponnesian War.',
      'Translate this to French.',
    ];
    for (const text of cases) {
      const result = classify(text);
      assert.strictEqual(result.path, 'fast', `Expected fast for: "${text}" (got ${result.path}/${result.reason})`);
    }
  });

  await t.test('routes action+target queries to slow path', () => {
    const cases = [
      'Check the Docker containers',
      'Restart the nginx server',
      'Run ls in the /var/log directory',
      'Show me the syslog',
      'Fix the bug in server.js',
      'Check the status of my proxmox vm',
      'Tail the docker logs',
      'Install nginx on the server',
      'Delete the old log files',
      'Find the error in the stack trace',
    ];
    for (const text of cases) {
      const result = classify(text);
      assert.strictEqual(result.path, 'slow', `Expected slow for: "${text}" (got ${result.path}/${result.reason})`);
    }
  });

  await t.test('routes weather to fast path even with action verbs', () => {
    const cases = [
      'Check the weather in Athens',
      "What's the weather forecast?",
      'Check the temperature tomorrow',
    ];
    for (const text of cases) {
      const result = classify(text);
      assert.strictEqual(result.path, 'fast', `Expected fast for: "${text}" (got ${result.path}/${result.reason})`);
    }
  });

  await t.test('routes casual chat to fast path', () => {
    const cases = [
      'Hello, how are you?',
      'Tell me a joke',
      'Thanks!',
      'Good morning',
      'What do you think about AI?',
    ];
    for (const text of cases) {
      const result = classify(text);
      assert.strictEqual(result.path, 'fast', `Expected fast for: "${text}" (got ${result.path}/${result.reason})`);
    }
  });

  await t.test('handles Greek input', () => {
    const result = classify('Ποια είναι η πρόγνωση καιρού στην Αθήνα;');
    assert.strictEqual(result.path, 'fast');
  });

  await t.test('handles empty input', () => {
    const result = classify('');
    assert.strictEqual(result.path, 'fast');
    assert.strictEqual(result.reason, 'empty');
  });

  await t.test('defaults to fast for unknown patterns', () => {
    const result = classify('Random sentence with no keywords');
    assert.strictEqual(result.path, 'fast');
    assert.strictEqual(result.reason, 'default');
  });
});
