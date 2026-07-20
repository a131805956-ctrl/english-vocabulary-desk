'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createVocabServer } = require('../core.cjs');

const projectRoot = path.resolve(__dirname, '..', '..');
const catalogPath = path.join(projectRoot, 'data', 'generated', 'vocabulary.sqlite3');

test('password-protected Hermes runtime settings', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-settings-api-'));
  const app = createVocabServer({
    projectRoot,
    catalogPath,
    progressPath: path.join(tempDir, 'progress.sqlite3'),
    distDir: null,
    apiEditPassword: 'test-password',
  });
  const address = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const locked = await request(baseUrl, '/api/settings', { method: 'GET' });
  assert.equal(locked.response.status, 401);
  assert.equal(locked.body.error.code, 'API_SETTINGS_UNAUTHORIZED');

  const wrong = await request(baseUrl, '/api/settings/auth', {
    method: 'POST',
    body: { password: 'not-the-password' },
  });
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.body.error.code, 'API_SETTINGS_PASSWORD_INVALID');

  const login = await request(baseUrl, '/api/settings/auth', {
    method: 'POST',
    body: { password: 'test-password' },
  });
  assert.equal(login.response.status, 200);
  assert.match(login.body.token, /^[a-f0-9]{64}$/);

  const saved = await request(baseUrl, '/api/settings', {
    method: 'PUT',
    token: login.body.token,
    body: {
      hermes: {
        baseUrl: 'http://127.0.0.1:8642/v1',
        model: 'hermes',
        sessionKey: 'vocabulary-app',
        apiKey: 'secret-api-key',
      },
    },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.hermes.apiKeyConfigured, true);
  assert.equal(saved.body.hermes.apiKeyMasked, '****-key');

  const publicView = await request(baseUrl, '/api/settings', {
    method: 'GET',
    token: login.body.token,
  });
  assert.equal(publicView.response.status, 200);
  assert.equal(publicView.body.hermes.baseUrl, 'http://127.0.0.1:8642/v1');
  assert.equal(publicView.body.hermes.apiKey, undefined);
  assert.equal(app.runtimeAiConfig.getGateway().apiKey, 'secret-api-key');
});

async function request(baseUrl, pathname, input = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: input.method ?? 'GET',
    headers: {
      ...(input.body ? { 'content-type': 'application/json' } : {}),
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
  });
  return { response, body: await response.json() };
}
