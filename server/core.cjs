'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { CatalogStore, ProgressStore } = require('./db.cjs');
const {
  ArticleError,
  DEFAULT_ARTICLE_TIMEOUT_MS,
  generateArticle,
} = require('./articles.cjs');

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function createVocabServer(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? path.join(__dirname, '..'));
  const catalogPath = path.resolve(
    options.catalogPath ?? path.join(projectRoot, 'data', 'generated', 'vocabulary.sqlite3'),
  );
  const progressPath = path.resolve(
    options.progressPath ?? path.join(projectRoot, 'data', 'runtime', 'progress.sqlite3'),
  );
  const distDir = options.distDir === null
    ? null
    : path.resolve(options.distDir ?? path.join(projectRoot, 'dist'));
  const catalog = new CatalogStore(catalogPath);
  const progress = new ProgressStore(progressPath);
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const articleTimeoutMs = options.articleTimeoutMs ?? DEFAULT_ARTICLE_TIMEOUT_MS;
  const hermesTimeoutMs = options.hermesTimeoutMs;
  const hermesCommand = options.hermesCommand;
  const runHermes = options.runHermes;

  const handler = async (request, response) => {
    setCommonHeaders(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url, 'http://localhost');
      const handled = await handleApiRequest({
        request,
        response,
        url,
        catalog,
        progress,
        maxBodyBytes,
        fetchImpl,
        articleTimeoutMs,
        hermesTimeoutMs,
        hermesCommand,
        runHermes,
      });
      if (handled) return;

      if (request.method === 'GET' || request.method === 'HEAD') {
        const served = await serveStatic(request, response, url, distDir);
        if (served) return;
      }

      throw new ApiError(404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      writeError(response, error);
    }
  };

  const server = http.createServer((request, response) => {
    handler(request, response).catch((error) => writeError(response, error));
  });
  let storesClosed = false;

  return {
    server,
    catalog,
    progress,
    catalogPath,
    progressPath,
    listen(port = 4173, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve(server.address());
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        const closeStores = () => {
          if (!storesClosed) {
            storesClosed = true;
            catalog.close();
            progress.close();
          }
        };

        if (!server.listening) {
          closeStores();
          resolve();
          return;
        }

        server.close((error) => {
          closeStores();
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function handleApiRequest(context) {
  const {
    request,
    response,
    url,
    catalog,
    progress,
    maxBodyBytes,
    fetchImpl = globalThis.fetch,
    articleTimeoutMs = DEFAULT_ARTICLE_TIMEOUT_MS,
    hermesTimeoutMs,
    hermesCommand,
    runHermes,
  } = context;
  const method = request.method ?? 'GET';
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/health') {
    writeJson(response, 200, {
      status: 'ok',
      now: new Date().toISOString(),
      node: process.version,
      catalog: catalog.health(),
      progress: progress.health(),
    });
    return true;
  }

  if (method === 'GET' && pathname === '/api/ranges') {
    writeJson(response, 200, { ranges: catalog.listRanges() });
    return true;
  }

  if (method === 'GET' && pathname === '/api/articles') {
    writeJson(response, 200, { articles: progress.listArticles() });
    return true;
  }

  const articleMatch = pathname.match(/^\/api\/articles\/([^/]+)$/);
  if ((method === 'GET' || method === 'DELETE') && articleMatch) {
    const articleId = safeDecode(articleMatch[1]);
    if (method === 'GET') {
      const article = progress.getArticle(articleId);
      if (!article) {
        throw new ApiError(404, 'ARTICLE_NOT_FOUND', 'Saved article not found', { articleId });
      }
      writeJson(response, 200, article);
      return true;
    }

    if (!progress.deleteArticle(articleId)) {
      throw new ApiError(404, 'ARTICLE_NOT_FOUND', 'Saved article not found', { articleId });
    }
    writeJson(response, 200, { deleted: true, articleId });
    return true;
  }

  if (method === 'POST' && pathname === '/api/articles') {
    const body = await readJson(request, maxBodyBytes);
    try {
      const result = await generateArticle({
        body,
        catalog,
        progress,
        fetchImpl,
        timeoutMs: articleTimeoutMs,
        hermesTimeoutMs,
        hermesCommand,
        runHermes,
      });
      writeJson(response, 201, result);
    } catch (error) {
      if (error instanceof ArticleError) {
        throw new ApiError(error.status, error.code, error.message, error.details);
      }
      throw error;
    }
    return true;
  }

  if (method === 'POST' && (pathname === '/api/session' || pathname === '/api/sessions')) {
    const body = await readJson(request, maxBodyBytes);
    const rangeIds = validateRangeIds(body.rangeIds);
    assertRangesExist(catalog, rangeIds);
    const mode = validateSessionMode(body.mode);
    const order = body.order ?? 'source';
    if (order !== 'source' && order !== 'shuffle') {
      throw new ApiError(400, 'INVALID_ORDER', "order must be 'source' or 'shuffle'");
    }
    const limit = validateLimit(body.limit);
    const newLimit = validateNewLimit(body.newLimit, mode);
    let selected;
    let cards;
    let plan = { due: 0, new: 0, problems: 0 };

    if (mode === 'manual') {
      // Preserve the P1 contract exactly: source order can be limited in SQL,
      // while shuffle selects the complete range before shuffling and slicing.
      selected = catalog.selectCards(rangeIds, order === 'source' ? limit : undefined);
      cards = selected.cards;
      if (order === 'shuffle') {
        cards = shuffle(cards);
        if (limit !== undefined) cards = cards.slice(0, limit);
      }
      attachReviews(cards, progress.getProgress(cards.map((card) => card.lexemeId)));
    } else {
      // Scheduling modes need the complete, source-ordered range so they can
      // classify every lexeme before applying a session limit.
      selected = catalog.selectCards(rangeIds);
      const progressByLexeme = progress.getProgress(
        selected.cards.map((card) => card.lexemeId),
      );

      if (mode === 'today') {
        const now = Date.now();
        let dueCards = selected.cards.filter((card) => {
          const review = progressByLexeme.get(card.lexemeId);
          return review !== undefined && new Date(review.due).getTime() <= now;
        });
        let newCards = selected.cards.filter(
          (card) => !progressByLexeme.has(card.lexemeId),
        );

        // Shuffle within each bucket so due cards always remain ahead of new
        // cards. Future reviews are intentionally absent from both buckets.
        if (order === 'shuffle') {
          dueCards = shuffle(dueCards);
          newCards = shuffle(newCards);
        }
        newCards = newCards.slice(0, newLimit);
        cards = [...dueCards, ...newCards];
        if (limit !== undefined) cards = cards.slice(0, limit);

        plan = {
          due: Math.min(dueCards.length, cards.length),
          new: Math.max(0, cards.length - dueCards.length),
          problems: 0,
        };
      } else {
        let problems = progress.getProblemLexemes(
          selected.cards.map((card) => card.lexemeId),
        );
        if (order === 'shuffle') problems = shuffle(problems);
        if (limit !== undefined) problems = problems.slice(0, limit);
        const cardsByLexeme = new Map(
          selected.cards.map((card) => [card.lexemeId, card]),
        );
        cards = problems
          .map((problem) => cardsByLexeme.get(problem.lexemeId))
          .filter(Boolean);
        plan = { due: 0, new: 0, problems: cards.length };
      }

      attachReviews(cards, progressByLexeme);
    }
    const session = progress.createSession(
      rangeIds,
      order,
      cards.map((card) => card.lexemeId),
    );

    writeJson(response, 201, {
      sessionId: session.sessionId,
      total: selected.total,
      cards,
      mode,
      plan,
    });
    return true;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions?\/([^/]+)$/);
  if (method === 'GET' && sessionMatch) {
    const sessionId = safeDecode(sessionMatch[1]);
    const session = progress.getSession(sessionId);
    if (!session) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'Study session not found', { sessionId });
    }
    writeJson(response, 200, session);
    return true;
  }

  const lexemeMatch = pathname.match(/^\/api\/lexemes\/([^/]+)$/);
  if (method === 'GET' && lexemeMatch) {
    const lexemeId = safeDecode(lexemeMatch[1]);
    const lexeme = catalog.getLexeme(lexemeId);
    if (!lexeme) {
      throw new ApiError(404, 'LEXEME_NOT_FOUND', 'Lexeme not found', { lexemeId });
    }
    lexeme.review = progress.getProgress([lexemeId]).get(lexemeId) ?? null;
    writeJson(response, 200, lexeme);
    return true;
  }

  if (
    method === 'POST' &&
    (pathname === '/api/reviews' || pathname === '/api/review-events')
  ) {
    const body = await readJson(request, maxBodyBytes);
    const input = validateReviewBody(body);
    const lexeme = catalog.getLexemeIdentity(input.lexemeId);
    if (!lexeme) {
      throw new ApiError(404, 'LEXEME_NOT_FOUND', 'Lexeme not found', {
        lexemeId: input.lexemeId,
      });
    }
    if (input.entryId && !catalog.entryBelongsToLexeme(input.entryId, input.lexemeId)) {
      throw new ApiError(
        400,
        'ENTRY_LEXEME_MISMATCH',
        'entryId does not belong to lexemeId',
      );
    }

    let session = null;
    if (input.sessionId) {
      session = progress.getSession(input.sessionId);
      if (!session) {
        throw new ApiError(404, 'SESSION_NOT_FOUND', 'Study session not found', {
          sessionId: input.sessionId,
        });
      }
      if (!progress.sessionContainsLexeme(input.sessionId, input.lexemeId)) {
        throw new ApiError(
          400,
          'LEXEME_NOT_IN_SESSION',
          'lexemeId is not part of this study session',
        );
      }
    }

    if (input.rangeIds === undefined) {
      input.rangeIds = session?.rangeIds ?? [];
    }
    if (input.rangeIds.length > 0) {
      assertRangesExist(catalog, input.rangeIds);
      const allowed = new Set(catalog.lexemeIdsForRanges(input.rangeIds));
      if (!allowed.has(input.lexemeId)) {
        throw new ApiError(
          400,
          'LEXEME_NOT_IN_RANGES',
          'lexemeId is not part of the supplied ranges',
        );
      }
    }

    const result = progress.recordReview(input);
    writeJson(response, 201, result);
    return true;
  }

  if (
    method === 'GET' &&
    (pathname === '/api/summary' || pathname === '/api/reviews/summary')
  ) {
    const sessionId = url.searchParams.get('sessionId');
    let rangeIds;
    let lexemeIds;

    if (sessionId) {
      const session = progress.getSession(sessionId);
      if (!session) {
        throw new ApiError(404, 'SESSION_NOT_FOUND', 'Study session not found', { sessionId });
      }
      rangeIds = session.rangeIds;
      lexemeIds = session.lexemeIds;
    } else {
      rangeIds = rangeIdsFromSearchParams(url.searchParams);
      assertRangesExist(catalog, rangeIds);
      lexemeIds = catalog.lexemeIdsForRanges(rangeIds);
    }

    const summary = progress.getSummary(lexemeIds);
    const briefs = catalog.getLexemeBriefs(
      summary.problemLexemes.map((item) => item.lexemeId),
    );
    summary.problemLexemes = summary.problemLexemes.map((item) => ({
      ...item,
      ...(briefs.get(item.lexemeId) ?? {
        displayHeadword: null,
        definitionZh: null,
      }),
    }));

    writeJson(response, 200, {
      scope: {
        rangeIds,
        sessionId: sessionId ?? null,
        lexemeCount: lexemeIds.length,
      },
      ...summary,
      unreviewedLexemes: Math.max(0, lexemeIds.length - summary.reviewedLexemes),
    });
    return true;
  }

  if (pathname.startsWith('/api/')) {
    throw new ApiError(404, 'NOT_FOUND', 'API route not found');
  }

  return false;
}

function validateRangeIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, 'INVALID_RANGE_IDS', 'rangeIds must be a non-empty array');
  }
  if (value.length > 100) {
    throw new ApiError(400, 'TOO_MANY_RANGES', 'rangeIds cannot contain more than 100 items');
  }
  const ids = value.map((id) => {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ApiError(400, 'INVALID_RANGE_IDS', 'Every rangeId must be a non-empty string');
    }
    return id.trim();
  });
  return [...new Set(ids)];
}

function assertRangesExist(catalog, rangeIds) {
  const missing = catalog.findMissingRangeIds(rangeIds);
  if (missing.length > 0) {
    throw new ApiError(400, 'UNKNOWN_RANGE_IDS', 'One or more ranges do not exist', {
      missing,
    });
  }
}

function validateLimit(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 5000) {
    throw new ApiError(400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 5000');
  }
  return value;
}

function validateSessionMode(value) {
  const mode = value ?? 'manual';
  if (mode !== 'manual' && mode !== 'today' && mode !== 'problems') {
    throw new ApiError(
      400,
      'INVALID_MODE',
      "mode must be 'manual', 'today', or 'problems'",
    );
  }
  return mode;
}

function validateNewLimit(value, mode) {
  if (value === undefined) return mode === 'today' ? 20 : undefined;
  if (!Number.isInteger(value) || value < 0 || value > 80) {
    throw new ApiError(400, 'INVALID_NEW_LIMIT', 'newLimit must be an integer from 0 to 80');
  }
  return value;
}

function attachReviews(cards, progressByLexeme) {
  cards.forEach((card) => {
    card.review = progressByLexeme.get(card.lexemeId) ?? null;
  });
}

function validateReviewBody(body) {
  if (typeof body.lexemeId !== 'string' || body.lexemeId.trim() === '') {
    throw new ApiError(400, 'INVALID_LEXEME_ID', 'lexemeId must be a non-empty string');
  }
  if (body.rating !== 'again' && body.rating !== 'good') {
    throw new ApiError(400, 'INVALID_RATING', "rating must be 'again' or 'good'");
  }
  if (body.entryId !== undefined && (typeof body.entryId !== 'string' || !body.entryId)) {
    throw new ApiError(400, 'INVALID_ENTRY_ID', 'entryId must be a non-empty string');
  }
  if (
    body.sessionId !== undefined &&
    (typeof body.sessionId !== 'string' || !body.sessionId)
  ) {
    throw new ApiError(400, 'INVALID_SESSION_ID', 'sessionId must be a non-empty string');
  }
  if (
    body.responseMs !== undefined &&
    (!Number.isInteger(body.responseMs) || body.responseMs < 0 || body.responseMs > 3_600_000)
  ) {
    throw new ApiError(
      400,
      'INVALID_RESPONSE_MS',
      'responseMs must be an integer from 0 to 3600000',
    );
  }
  if (
    body.flippedBeforeAnswer !== undefined &&
    typeof body.flippedBeforeAnswer !== 'boolean'
  ) {
    throw new ApiError(
      400,
      'INVALID_FLIPPED_VALUE',
      'flippedBeforeAnswer must be a boolean',
    );
  }
  if (
    body.reviewedAt !== undefined &&
    (typeof body.reviewedAt !== 'string' || !Number.isFinite(new Date(body.reviewedAt).getTime()))
  ) {
    throw new ApiError(400, 'INVALID_REVIEWED_AT', 'reviewedAt must be a valid date-time string');
  }

  return {
    lexemeId: body.lexemeId.trim(),
    entryId: body.entryId,
    sessionId: body.sessionId,
    rangeIds: body.rangeIds === undefined ? undefined : validateRangeIds(body.rangeIds),
    rating: body.rating,
    responseMs: body.responseMs,
    flippedBeforeAnswer: body.flippedBeforeAnswer ?? false,
    reviewedAt: body.reviewedAt,
    mode: body.mode,
    direction: body.direction,
  };
}

function rangeIdsFromSearchParams(searchParams) {
  const repeated = [
    ...searchParams.getAll('rangeId'),
    ...searchParams.getAll('rangeIds').flatMap((value) => value.split(',')),
  ];
  return repeated.length === 0 ? ['all'] : validateRangeIds(repeated);
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(400, 'INVALID_PATH_ENCODING', 'Path contains invalid URL encoding');
  }
}

async function readJson(request, maxBytes) {
  const contentType = request.headers['content-type'] ?? '';
  if (!String(contentType).toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new ApiError(413, 'BODY_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    throw new ApiError(400, 'EMPTY_BODY', 'A JSON request body is required');
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('body is not an object');
    }
    return parsed;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be a valid JSON object');
  }
}

async function serveStatic(request, response, url, distDir) {
  if (!distDir || !fs.existsSync(distDir)) return false;
  const pathname = safeDecode(url.pathname);
  const candidate = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.resolve(distDir, candidate);
  const distPrefix = `${distDir}${path.sep}`;
  if (filePath !== distDir && !filePath.startsWith(distPrefix)) {
    throw new ApiError(403, 'FORBIDDEN_PATH', 'Static path is outside the app directory');
  }

  let stats = await statOrNull(filePath);
  if (!stats?.isFile() && path.extname(candidate) === '') {
    filePath = path.join(distDir, 'index.html');
    stats = await statOrNull(filePath);
  }
  if (!stats?.isFile()) return false;

  response.statusCode = 200;
  response.setHeader('Content-Type', mimeType(filePath));
  response.setHeader('Content-Length', stats.size);
  response.setHeader(
    'Cache-Control',
    path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
  );
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(response);
  });
  return true;
}

async function statOrNull(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function mimeType(filePath) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return types[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function setCommonHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function writeJson(response, status, payload) {
  if (response.headersSent || response.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload));
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', body.length);
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function writeError(response, error) {
  if (response.writableEnded) return;
  const status = error instanceof ApiError ? error.status : 500;
  const payload = {
    error: {
      code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR',
      message: error instanceof ApiError ? error.message : 'Unexpected server error',
    },
  };
  if (error instanceof ApiError && error.details !== undefined) {
    payload.error.details = error.details;
  }
  if (!(error instanceof ApiError)) {
    console.error(error);
  }
  writeJson(response, status, payload);
}

module.exports = {
  ApiError,
  createVocabServer,
  handleApiRequest,
};
