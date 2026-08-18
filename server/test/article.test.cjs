'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createVocabServer } = require('../core.cjs');

const projectRoot = path.resolve(__dirname, '..', '..');
const catalogPath = path.join(projectRoot, 'data', 'generated', 'vocabulary.sqlite3');

test('local AI article API', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-article-api-'));
  const progressPath = path.join(tempDir, 'progress.sqlite3');
  const catalogHashBefore = sha256(catalogPath);
  const calls = [];
  const hermesCalls = [];
  let selectedWords = [];
  let savedArticleId;
  const fetchImpl = async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url: url.toString(), init, payload });
    if (payload.model === 'slow-model') {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (payload.model === 'broken-model') {
      return new Response(JSON.stringify({ error: { message: 'model is not loaded' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }

    const article = {
      title: 'A Small Discovery',
      body: `${selectedWords.join(', ')}. These words appear naturally in a short learning story.`,
      translationZh: '這是一篇使用指定單字的短篇學習文章。',
      usedWords: [...selectedWords],
      questions: [
        { question: 'What did the learner discover?', answer: 'A useful way to learn words.' },
        { question: 'Where do the words appear?', answer: 'In a short story.' },
        { question: 'Why is the story useful?', answer: 'It gives the words context.' },
      ],
    };
    if (payload.model === 'alias-model') {
      delete article.translationZh;
      article.chineseTranslation = '這是由模型使用別名欄位回傳的中文翻譯。';
    }
    const responseBody = url.pathname.endsWith('/api/chat')
      ? { message: { role: 'assistant', content: JSON.stringify(article) }, done: true }
      : { choices: [{ message: { role: 'assistant', content: JSON.stringify(article) } }] };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const app = createVocabServer({
    projectRoot,
    catalogPath,
    progressPath,
    distDir: null,
    fetchImpl,
    articleTimeoutMs: 20,
    hermesTimeoutMs: 20,
    runHermes: async ({ prompt, timeoutMs }) => {
      hermesCalls.push({ prompt, timeoutMs });
      return JSON.stringify({
        title: 'Hermes Learns in Context',
        body: `${selectedWords.join(', ')} appear in a connected practice story.`,
        translationZh: '指定單字出現在連貫的練習故事中。',
        usedWords: selectedWords,
        questions: [
          { question: 'What appears in the story?', answer: 'The selected vocabulary words.' },
          { question: 'How are the words presented?', answer: 'In connected context.' },
          { question: 'What is the story for?', answer: 'Vocabulary practice.' },
        ],
      });
    },
  });
  const cards = app.catalog.selectCards(['all'], 3).cards;
  const lexemeIds = cards.map((card) => card.lexemeId);
  selectedWords = cards.map((card) => card.displayHeadword);
  const address = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await app.close();
    assert.equal(sha256(catalogPath), catalogHashBefore, 'source database must remain unchanged');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await t.test('auto provider calls Ollama native chat and returns the frontend contract', async () => {
    const result = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:8b',
      provider: 'auto',
      lexemeIds,
      level: 'beginner',
      length: 'short',
      includeTranslation: true,
    });

    assert.equal(result.response.status, 201);
    assert.deepEqual(Object.keys(result.body), ['article', 'meta', 'saved']);
    assert.equal(result.body.article.title, 'A Small Discovery');
    assert.equal(result.body.article.translationZh, '這是一篇使用指定單字的短篇學習文章。');
    assert.deepEqual(result.body.article.usedWords, selectedWords);
    assert.equal(result.body.article.questions.length, 3);
    assert.deepEqual(result.body.meta.provider, 'ollama');
    assert.equal(result.body.meta.model, 'qwen3:8b');
    assert.match(result.body.meta.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(result.body.saved.articleId, /^article:/);
    assert.equal(result.body.saved.title, 'A Small Discovery');
    assert.deepEqual(result.body.saved.usedWords, selectedWords);
    savedArticleId = result.body.saved.articleId;

    const call = calls.at(-1);
    assert.equal(call.url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(call.payload.stream, false);
    assert.equal(call.payload.format.type, 'object');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.headers.Authorization, undefined);
  });

  await t.test('OpenAI-compatible mode accepts words and can omit translation', async () => {
    const result = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://localhost:1234/v1',
      model: 'local-instruct',
      provider: 'auto',
      words: selectedWords,
      level: 'advanced',
      length: 'long',
      includeTranslation: false,
    });

    assert.equal(result.response.status, 201);
    assert.equal(result.body.meta.provider, 'openai');
    assert.equal(result.body.article.translationZh, null);
    const call = calls.at(-1);
    assert.equal(call.url, 'http://localhost:1234/v1/chat/completions');
    assert.deepEqual(call.payload.response_format, { type: 'json_object' });
    assert.equal(call.payload.stream, undefined);
  });

  await t.test('normalizes a common Chinese translation alias', async () => {
    const result = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://localhost:1234/v1',
      model: 'alias-model',
      provider: 'auto',
      words: selectedWords,
      level: 'beginner',
      length: 'short',
      includeTranslation: true,
    });

    try {
      assert.equal(result.response.status, 201);
      assert.equal(result.body.article.translationZh, '這是由模型使用別名欄位回傳的中文翻譯。');
    } finally {
      await requestMethod(
        baseUrl,
        `/api/articles/${encodeURIComponent(result.body.saved.articleId)}`,
        'DELETE',
      );
    }
  });

  await t.test('Hermes Agent uses a tool-free local adapter and needs no model URL', async () => {
    const result = await requestJson(baseUrl, '/api/articles', {
      provider: 'hermes',
      lexemeIds,
      level: 'intermediate',
      length: 'short',
      includeTranslation: true,
    });

    assert.equal(result.response.status, 201);
    assert.equal(result.body.meta.provider, 'hermes-agent');
    assert.equal(result.body.meta.model, 'Hermes Agent default');
    assert.equal(result.body.article.title, 'Hermes Learns in Context');
    assert.deepEqual(result.body.article.usedWords, selectedWords);
    const call = hermesCalls.at(-1);
    assert.equal(call.timeoutMs, 20);
    assert.match(call.prompt, /Do not call tools, browse the web, access files/u);
    assert.match(call.prompt, /Vocabulary data:/u);
    assert.match(call.prompt, new RegExp(selectedWords[0], 'u'));
  });

  await t.test('generated articles are listed, reopened, and deleted from local progress storage', async () => {
    const listed = await requestMethod(baseUrl, '/api/articles', 'GET');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.articles.length, 3);
    assert.equal(listed.body.articles.some((item) => item.articleId === savedArticleId), true);
    const summary = listed.body.articles.find((item) => item.articleId === savedArticleId);
    assert.equal(summary.title, 'A Small Discovery');
    assert.deepEqual(summary.usedWords, selectedWords);

    const opened = await requestMethod(
      baseUrl,
      `/api/articles/${encodeURIComponent(savedArticleId)}`,
      'GET',
    );
    assert.equal(opened.response.status, 200);
    assert.equal(opened.body.article.body.includes(selectedWords[0]), true);
    assert.deepEqual(opened.body.selectedLexemeIds, lexemeIds);

    const deleted = await requestMethod(
      baseUrl,
      `/api/articles/${encodeURIComponent(savedArticleId)}`,
      'DELETE',
    );
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.body, { deleted: true, articleId: savedArticleId });

    const missing = await requestMethod(
      baseUrl,
      `/api/articles/${encodeURIComponent(savedArticleId)}`,
      'GET',
    );
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error.code, 'ARTICLE_NOT_FOUND');
  });

  await t.test('remote hosts and unknown vocabulary are rejected before fetch', async () => {
    const before = calls.length;
    const remote = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://example.com:11434',
      model: 'qwen3:8b',
      lexemeIds,
      level: 'intermediate',
      length: 'medium',
    });
    assert.equal(remote.response.status, 400);
    assert.equal(remote.body.error.code, 'REMOTE_AI_HOST_FORBIDDEN');

    const unknown = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:8b',
      words: [selectedWords[0], selectedWords[1], 'definitely-not-in-this-catalog'],
      level: 'intermediate',
      length: 'medium',
    });
    assert.equal(unknown.response.status, 400);
    assert.equal(unknown.body.error.code, 'UNKNOWN_VOCABULARY');
    assert.deepEqual(unknown.body.error.details.missingWords, [
      'definitely-not-in-this-catalog',
    ]);
    assert.equal(calls.length, before);
  });

  await t.test('invalid inputs return structured errors', async () => {
    const tooFew = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:8b',
      lexemeIds: lexemeIds.slice(0, 2),
      level: 'intermediate',
      length: 'medium',
    });
    assert.equal(tooFew.response.status, 400);
    assert.equal(tooFew.body.error.code, 'INVALID_VOCABULARY_COUNT');

    const credentials = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://user:password@127.0.0.1:11434',
      model: 'qwen3:8b',
      lexemeIds,
      level: 'intermediate',
      length: 'medium',
    });
    assert.equal(credentials.response.status, 400);
    assert.equal(credentials.body.error.code, 'BASEURL_CREDENTIALS_FORBIDDEN');
  });

  await t.test('timeouts and upstream failures have stable gateway errors', async () => {
    const slow = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://[::1]:11434',
      model: 'slow-model',
      provider: 'ollama',
      lexemeIds,
      level: 'intermediate',
      length: 'medium',
    });
    assert.equal(slow.response.status, 504);
    assert.equal(slow.body.error.code, 'AI_REQUEST_TIMEOUT');

    const failed = await requestJson(baseUrl, '/api/articles', {
      baseUrl: 'http://localhost:11434',
      model: 'broken-model',
      provider: 'ollama',
      lexemeIds,
      level: 'intermediate',
      length: 'medium',
    });
    assert.equal(failed.response.status, 502);
    assert.equal(failed.body.error.code, 'AI_UPSTREAM_ERROR');
    assert.equal(failed.body.error.details.upstreamStatus, 503);
    assert.equal(failed.body.error.details.upstreamMessage, 'model is not loaded');
  });
});

async function requestJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function requestMethod(baseUrl, pathname, method) {
  const response = await fetch(`${baseUrl}${pathname}`, { method });
  return { response, body: await response.json() };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
