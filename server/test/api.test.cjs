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

test('local vocabulary API', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-api-'));
  const progressPath = path.join(tempDir, 'progress.sqlite3');
  const catalogHashBefore = sha256(catalogPath);
  const app = createVocabServer({
    projectRoot,
    catalogPath,
    progressPath,
    distDir: null,
  });
  const address = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await app.close();
    assert.equal(sha256(catalogPath), catalogHashBefore, 'source database must remain unchanged');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await t.test('health reports a read-only catalog and writable progress store', async () => {
    const result = await requestJson(baseUrl, '/api/health');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'ok');
    assert.equal(result.body.node, process.version);
    assert.equal(result.body.catalog.readOnly, true);
    assert.equal(result.body.catalog.lexemeCount, 574);
    assert.equal(result.body.catalog.rangeCount, 117);
    assert.equal(result.body.progress.writable, true);
    assert.equal(result.body.progress.schemaVersion, '3');
    assert.equal(result.body.progress.scheduler.algorithm, 'fsrs-6');
    assert.equal(
      result.body.progress.scheduler.libraryVersion,
      'v5.4.1 using FSRS-6.0',
    );
  });

  let ranges;
  await t.test('ranges follow the frontend contract', async () => {
    const result = await requestJson(baseUrl, '/api/ranges');
    assert.equal(result.response.status, 200);
    ranges = result.body.ranges;
    assert.equal(ranges.length, 117);
    assert.deepEqual(Object.keys(ranges[0]), [
      'id',
      'kind',
      'name',
      'parentId',
      'status',
      'entryCount',
      'lexemeCount',
    ]);
    assert.equal(ranges[0].id, 'all');
    assert.equal(ranges[0].lexemeCount, 574);
  });

  let session;
  await t.test('session unions overlapping ranges by lexeme and returns cards', async () => {
    const result = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: {
        rangeIds: ['all', 'source:yingdan1', 'all'],
        limit: 12,
        order: 'source',
      },
    });
    assert.equal(result.response.status, 201);
    session = result.body;
    assert.match(session.sessionId, /^session:/);
    assert.equal(session.total, 574);
    assert.equal(session.cards.length, 12);
    assert.equal(session.mode, 'manual');
    assert.deepEqual(session.plan, { due: 0, new: 0, problems: 0 });
    assert.equal(new Set(session.cards.map((card) => card.lexemeId)).size, 12);
    const card = session.cards[0];
    assert.deepEqual(Object.keys(card), [
      'lexemeId',
      'canonicalTerm',
      'displayHeadword',
      'variants',
      'entryCount',
      'primary',
      'review',
    ]);
    assert.equal(typeof card.primary.definitionZh, 'string');
    assert.equal(typeof card.primary.exampleEn, 'string');
    assert.match(card.primary.groupLabel, /｜/);
    assert.equal(card.review, null);
  });

  await t.test('saved session and lexeme detail can be retrieved', async () => {
    const saved = await requestJson(
      baseUrl,
      `/api/session/${encodeURIComponent(session.sessionId)}`,
    );
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.total, 12);
    assert.equal(saved.body.lexemeIds.length, 12);

    const first = session.cards[0];
    const detail = await requestJson(
      baseUrl,
      `/api/lexemes/${encodeURIComponent(first.lexemeId)}`,
    );
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.lexemeId, first.lexemeId);
    assert.equal(detail.body.entries.length, detail.body.entryCount);
    assert.equal(detail.body.primaryEntryId, first.primary.entryId);
  });

  await t.test('again and good reviews update scheduler-ready progress', async () => {
    const first = session.cards[0];
    const againAt = '2026-07-13T04:00:00.000Z';
    const again = await requestJson(baseUrl, '/api/reviews', {
      method: 'POST',
      body: {
        lexemeId: first.lexemeId,
        entryId: first.primary.entryId,
        sessionId: session.sessionId,
        rangeIds: ['all'],
        rating: 'again',
        responseMs: 4100,
        flippedBeforeAnswer: true,
        reviewedAt: againAt,
      },
    });
    assert.equal(again.response.status, 201);
    assert.equal(again.body.event.wasCorrect, false);
    assert.equal(again.body.review.state, 'learning');
    assert.equal(again.body.review.lapses, 0);
    assert.equal(again.body.review.scheduler.algorithm, 'fsrs-6');
    assert.equal(again.body.review.scheduler.version, 6);
    assert.equal(again.body.review.scheduler.libraryVersion, 'v5.4.1 using FSRS-6.0');
    assert.equal(again.body.scheduling.log.rating, 1);
    assert.equal(again.body.scheduling.log.state, 0);
    assert.deepEqual(again.body.scheduling.card, again.body.review.scheduler.fsrsData);
    assert.equal(
      new Date(again.body.review.due).getTime() - new Date(againAt).getTime(),
      60 * 1000,
    );

    const good = await requestJson(baseUrl, '/api/reviews', {
      method: 'POST',
      body: {
        lexemeId: first.lexemeId,
        entryId: first.primary.entryId,
        sessionId: session.sessionId,
        rangeIds: ['all'],
        rating: 'good',
        responseMs: 1900,
        flippedBeforeAnswer: false,
        reviewedAt: '2026-07-13T04:01:00.000Z',
      },
    });
    assert.equal(good.response.status, 201);
    assert.equal(good.body.event.wasCorrect, true);
    assert.equal(good.body.review.state, 'learning');
    assert.equal(good.body.review.reps, 2);
    assert.equal(good.body.review.againCount, 1);
    assert.equal(good.body.review.goodCount, 1);
    assert.equal(good.body.scheduling.log.rating, 3);
    assert.equal(
      new Date(good.body.review.due).getTime() -
        new Date('2026-07-13T04:01:00.000Z').getTime(),
      10 * 60 * 1000,
    );

    const storedProgress = app.progress.db
      .prepare(`
        SELECT scheduler_algorithm, scheduler_version, fsrs_data_json
        FROM lexeme_progress
        WHERE lexeme_id = ?
      `)
      .get(first.lexemeId);
    assert.equal(storedProgress.scheduler_algorithm, 'fsrs-6');
    assert.equal(storedProgress.scheduler_version, 6);
    assert.deepEqual(JSON.parse(storedProgress.fsrs_data_json), good.body.scheduling.card);

    const storedEvents = app.progress.db
      .prepare(`
        SELECT rating_value, scheduler_before_json, scheduler_after_json
        FROM review_event
        WHERE lexeme_id = ?
        ORDER BY reviewed_at
      `)
      .all(first.lexemeId);
    assert.deepEqual(storedEvents.map((row) => row.rating_value), [1, 3]);
    assert.equal(JSON.parse(storedEvents[0].scheduler_before_json).state, 0);
    assert.deepEqual(
      JSON.parse(storedEvents[1].scheduler_after_json),
      { card: good.body.scheduling.card, log: good.body.scheduling.log },
    );

    const detail = await requestJson(
      baseUrl,
      `/api/lexemes/${encodeURIComponent(first.lexemeId)}`,
    );
    assert.equal(detail.body.review.reps, 2);
    assert.equal(detail.body.review.scheduler.fsrsData.constructor, Object);
  });

  await t.test('summary includes counts, mistakes and session scope', async () => {
    const result = await requestJson(
      baseUrl,
      `/api/summary?sessionId=${encodeURIComponent(session.sessionId)}`,
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.body.scope.lexemeCount, 12);
    assert.equal(result.body.totalReviews, 2);
    assert.equal(result.body.againCount, 1);
    assert.equal(result.body.goodCount, 1);
    assert.equal(result.body.accuracy, 0.5);
    assert.equal(result.body.reviewedLexemes, 1);
    assert.equal(result.body.unreviewedLexemes, 11);
    assert.equal(result.body.problemLexemes.length, 1);
    assert.equal(
      result.body.problemLexemes[0].displayHeadword,
      session.cards[0].displayHeadword,
    );
  });

  await t.test('invalid ranges and ratings return structured client errors', async () => {
    const badRange = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: { rangeIds: ['range:missing'], order: 'source' },
    });
    assert.equal(badRange.response.status, 400);
    assert.equal(badRange.body.error.code, 'UNKNOWN_RANGE_IDS');
    assert.deepEqual(badRange.body.error.details.missing, ['range:missing']);

    const badRating = await requestJson(baseUrl, '/api/reviews', {
      method: 'POST',
      body: { lexemeId: session.cards[0].lexemeId, rating: 'easy' },
    });
    assert.equal(badRating.response.status, 400);
    assert.equal(badRating.body.error.code, 'INVALID_RATING');

    const badDate = await requestJson(baseUrl, '/api/reviews', {
      method: 'POST',
      body: {
        lexemeId: session.cards[0].lexemeId,
        rating: 'good',
        reviewedAt: 'not-a-date',
      },
    });
    assert.equal(badDate.response.status, 400);
    assert.equal(badDate.body.error.code, 'INVALID_REVIEWED_AT');
  });
});

test('FSRS session modes', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-session-modes-'));
  const progressPath = path.join(tempDir, 'progress.sqlite3');
  const catalogHashBefore = sha256(catalogPath);
  const app = createVocabServer({
    projectRoot,
    catalogPath,
    progressPath,
    distDir: null,
  });
  const address = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sourceCards = app.catalog.selectCards(['all']).cards;

  t.after(async () => {
    await app.close();
    assert.equal(sha256(catalogPath), catalogHashBefore, 'source database must remain unchanged');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await t.test('a fresh today session contains the default 20 new cards', async () => {
    const result = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: { rangeIds: ['all'], mode: 'today', order: 'source' },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.mode, 'today');
    assert.equal(result.body.total, 574);
    assert.equal(result.body.cards.length, 20);
    assert.deepEqual(result.body.plan, { due: 0, new: 20, problems: 0 });
    assert.deepEqual(
      result.body.cards.map((card) => card.lexemeId),
      sourceCards.slice(0, 20).map((card) => card.lexemeId),
    );
    assert.ok(result.body.cards.every((card) => card.review === null));
  });

  await t.test('today accepts newLimit zero', async () => {
    const result = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: { rangeIds: ['all'], mode: 'today', newLimit: 0 },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.cards.length, 0);
    assert.deepEqual(result.body.plan, { due: 0, new: 0, problems: 0 });
  });

  await t.test('today orders due before new and excludes future reviews', async () => {
    const futureCard = sourceCards[0];
    const dueCard = sourceCards[5];
    await postReview(baseUrl, futureCard, 'good', '2099-01-01T00:00:00.000Z');
    await postReview(baseUrl, dueCard, 'again', '2020-01-01T00:00:00.000Z');

    const result = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: {
        rangeIds: ['all'],
        mode: 'today',
        newLimit: 3,
        limit: 4,
        order: 'source',
      },
    });
    assert.equal(result.response.status, 201);
    assert.deepEqual(result.body.plan, { due: 1, new: 3, problems: 0 });
    assert.equal(result.body.cards[0].lexemeId, dueCard.lexemeId);
    assert.equal(result.body.cards[0].review.state, 'learning');
    assert.ok(!result.body.cards.some((card) => card.lexemeId === futureCard.lexemeId));
    assert.ok(result.body.cards.slice(1).every((card) => card.review === null));

    const shuffled = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: {
        rangeIds: ['all'],
        mode: 'today',
        newLimit: 3,
        limit: 4,
        order: 'shuffle',
      },
    });
    assert.equal(shuffled.response.status, 201);
    assert.deepEqual(shuffled.body.plan, { due: 1, new: 3, problems: 0 });
    assert.equal(shuffled.body.cards[0].lexemeId, dueCard.lexemeId);
    assert.ok(!shuffled.body.cards.some((card) => card.lexemeId === futureCard.lexemeId));
    assert.ok(shuffled.body.cards.slice(1).every((card) => card.review === null));
  });

  await t.test('problems session uses the same ranked mistakes as summary', async () => {
    const frequentProblem = sourceCards[8];
    await postReview(baseUrl, frequentProblem, 'again', '2020-01-02T00:00:00.000Z');
    await postReview(baseUrl, frequentProblem, 'again', '2020-01-02T00:01:00.000Z');

    const sessionResult = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: { rangeIds: ['all'], mode: 'problems', order: 'source', limit: 2 },
    });
    const summaryResult = await requestJson(baseUrl, '/api/summary?rangeId=all');
    assert.equal(sessionResult.response.status, 201);
    assert.equal(summaryResult.response.status, 200);
    assert.equal(sessionResult.body.mode, 'problems');
    assert.deepEqual(sessionResult.body.plan, { due: 0, new: 0, problems: 2 });
    assert.deepEqual(
      sessionResult.body.cards.map((card) => card.lexemeId),
      summaryResult.body.problemLexemes.slice(0, 2).map((item) => item.lexemeId),
    );
    assert.equal(sessionResult.body.cards[0].lexemeId, frequentProblem.lexemeId);
    assert.ok(sessionResult.body.cards.every((card) => card.review.againCount > 0));
  });

  await t.test('invalid mode and newLimit return structured errors', async () => {
    const badMode = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: { rangeIds: ['all'], mode: 'daily' },
    });
    assert.equal(badMode.response.status, 400);
    assert.equal(badMode.body.error.code, 'INVALID_MODE');

    const badNewLimit = await requestJson(baseUrl, '/api/session', {
      method: 'POST',
      body: { rangeIds: ['all'], mode: 'today', newLimit: 81 },
    });
    assert.equal(badNewLimit.response.status, 400);
    assert.equal(badNewLimit.body.error.code, 'INVALID_NEW_LIMIT');
  });
});

async function requestJson(baseUrl, pathname, options = {}) {
  const init = { method: options.method ?? 'GET', headers: {} };
  if (options.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { response, body: await response.json() };
}

async function postReview(baseUrl, card, rating, reviewedAt) {
  const result = await requestJson(baseUrl, '/api/reviews', {
    method: 'POST',
    body: {
      lexemeId: card.lexemeId,
      entryId: card.primary.entryId,
      rangeIds: ['all'],
      rating,
      reviewedAt,
    },
  });
  assert.equal(result.response.status, 201);
  return result.body;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
