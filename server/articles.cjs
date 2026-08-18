'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_ARTICLE_TIMEOUT_MS = 60_000;
const DEFAULT_HERMES_TIMEOUT_MS = 120_000;
const MAX_HERMES_OUTPUT_BYTES = 1024 * 1024;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const LENGTHS = new Set(['short', 'medium', 'long']);
const PROVIDERS = new Set(['auto', 'ollama', 'openai', 'hermes']);
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    translationZh: { type: ['string', 'null'] },
    usedWords: { type: 'array', items: { type: 'string' } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['question', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'body', 'translationZh', 'usedWords', 'questions'],
  additionalProperties: false,
};

class ArticleError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ArticleError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function generateArticle(options) {
  const input = validateArticleInput(options.body);
  const resolved = options.catalog.getArticleLexemes(input.lexemeIds, input.words);
  if (resolved.missingLexemeIds.length > 0 || resolved.missingWords.length > 0) {
    throw new ArticleError(
      400,
      'UNKNOWN_VOCABULARY',
      'One or more requested vocabulary items do not exist in the catalog',
      {
        missingLexemeIds: resolved.missingLexemeIds,
        missingWords: resolved.missingWords,
      },
    );
  }
  if (resolved.lexemes.length < 3 || resolved.lexemes.length > 12) {
    throw new ArticleError(
      400,
      'INVALID_VOCABULARY_COUNT',
      'Select 3 to 12 unique vocabulary items',
      { resolvedCount: resolved.lexemes.length },
    );
  }

  const messages = buildMessages(input, resolved.lexemes);
  const provider = input.provider === 'hermes'
    ? 'hermes'
    : resolveProvider(input.provider, validateLocalBaseUrl(input.baseUrl));
  const hermesGateway = provider === 'hermes' ? options.hermesGateway : null;
  const content = provider === 'hermes'
    ? await callHermesAgent({
      prompt: buildHermesPrompt(messages),
      runHermes: options.runHermes,
      command: options.hermesCommand,
      timeoutMs: options.hermesTimeoutMs ?? DEFAULT_HERMES_TIMEOUT_MS,
      gateway: hermesGateway,
      fetchImpl: options.fetchImpl,
    })
    : await callModelProvider({
      baseUrl: input.baseUrl,
      provider,
      model: input.model,
      messages,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_ARTICLE_TIMEOUT_MS,
    });
  const generated = parseGeneratedArticle(content);
  const usedWords = identifyUsedWords(generated, resolved.lexemes);

  const result = {
    article: {
      title: generated.title,
      body: generated.body,
      translationZh: input.includeTranslation ? generated.translationZh : null,
      usedWords,
      questions: generated.questions,
    },
    meta: {
      provider: provider === 'hermes'
        ? (hermesGateway ? 'hermes-gateway' : 'hermes-agent')
        : provider,
      model: provider === 'hermes'
        ? (hermesGateway?.model || 'Hermes Agent default')
        : input.model,
      generatedAt: new Date().toISOString(),
    },
  };

  // Articles belong to the learner's local progress database, never to the
  // read-only vocabulary source. Keeping this beside review history means a
  // generated reading remains available after the browser is closed.
  if (!options.progress) return result;
  const saved = options.progress.saveArticle({
    article: result.article,
    meta: result.meta,
    selectedLexemeIds: resolved.lexemes.map((lexeme) => lexeme.lexemeId),
    level: input.level,
    length: input.length,
  });
  return { ...result, saved };
}

function validateArticleInput(body) {
  const provider = body.provider ?? 'auto';
  if (!PROVIDERS.has(provider)) {
    throw new ArticleError(
      400,
      'INVALID_PROVIDER',
      "provider must be 'auto', 'ollama', 'openai', or 'hermes'",
    );
  }
  const baseUrl = provider === 'hermes'
    ? ''
    : requireTrimmedString(body.baseUrl, 'baseUrl', 2_048);
  const model = provider === 'hermes'
    ? ''
    : requireTrimmedString(body.model, 'model', 200);

  const lexemeIds = validateStringList(body.lexemeIds, 'lexemeIds');
  const words = validateStringList(body.words, 'words');
  const requestedCount = lexemeIds.length + words.length;
  if (requestedCount < 3 || requestedCount > 12) {
    throw new ArticleError(
      400,
      'INVALID_VOCABULARY_COUNT',
      'lexemeIds and words must request 3 to 12 vocabulary items in total',
      { requestedCount },
    );
  }

  const level = body.level ?? 'intermediate';
  if (!LEVELS.has(level)) {
    throw new ArticleError(
      400,
      'INVALID_ARTICLE_LEVEL',
      "level must be 'beginner', 'intermediate', or 'advanced'",
    );
  }
  const length = body.length ?? 'medium';
  if (!LENGTHS.has(length)) {
    throw new ArticleError(
      400,
      'INVALID_ARTICLE_LENGTH',
      "length must be 'short', 'medium', or 'long'",
    );
  }
  if (
    body.includeTranslation !== undefined &&
    typeof body.includeTranslation !== 'boolean'
  ) {
    throw new ArticleError(
      400,
      'INVALID_INCLUDE_TRANSLATION',
      'includeTranslation must be a boolean',
    );
  }

  return {
    baseUrl,
    model,
    provider,
    lexemeIds,
    words,
    level,
    length,
    includeTranslation: body.includeTranslation ?? true,
  };
}

function validateStringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ArticleError(400, `INVALID_${field.toUpperCase()}`, `${field} must be an array`);
  }
  const result = value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ArticleError(
        400,
        `INVALID_${field.toUpperCase()}`,
        `Every ${field} item must be a non-empty string`,
      );
    }
    if (item.length > 300) {
      throw new ArticleError(
        400,
        `INVALID_${field.toUpperCase()}`,
        `Every ${field} item must be at most 300 characters`,
      );
    }
    return item.trim();
  });
  return [...new Set(result)];
}

function requireTrimmedString(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ArticleError(400, `INVALID_${field.toUpperCase()}`, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ArticleError(
      400,
      `INVALID_${field.toUpperCase()}`,
      `${field} must be at most ${maxLength} characters`,
    );
  }
  return trimmed;
}

function validateLocalBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ArticleError(400, 'INVALID_BASEURL', 'baseUrl must be a valid absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ArticleError(400, 'INVALID_BASEURL_PROTOCOL', 'baseUrl must use http or https');
  }
  if (!LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new ArticleError(
      400,
      'REMOTE_AI_HOST_FORBIDDEN',
      'baseUrl must point to localhost, 127.0.0.1, or [::1]',
    );
  }
  if (url.username || url.password) {
    throw new ArticleError(400, 'BASEURL_CREDENTIALS_FORBIDDEN', 'Do not put credentials in baseUrl');
  }
  if (url.search || url.hash) {
    throw new ArticleError(400, 'INVALID_BASEURL', 'baseUrl cannot contain a query or fragment');
  }
  return url;
}

function resolveProvider(requested, baseUrl) {
  if (requested !== 'auto') return requested;
  const pathname = baseUrl.pathname.toLowerCase();
  return pathname.includes('/v1') || pathname.endsWith('/chat/completions')
    ? 'openai'
    : 'ollama';
}

function buildProviderEndpoint(baseUrl, provider) {
  const endpoint = new URL(baseUrl.toString());
  let pathname = endpoint.pathname.replace(/\/+$/, '');
  if (provider === 'ollama') {
    if (!pathname.endsWith('/api/chat')) {
      pathname = pathname.endsWith('/api') ? `${pathname}/chat` : `${pathname}/api/chat`;
    }
  } else if (!pathname.endsWith('/v1/chat/completions')) {
    pathname = pathname.endsWith('/v1')
      ? `${pathname}/chat/completions`
      : `${pathname}/v1/chat/completions`;
  }
  endpoint.pathname = pathname.replace(/^\/\//, '/');
  return endpoint;
}

function buildMessages(input, lexemes) {
  const wordRanges = {
    short: '120 to 170 English words',
    medium: '220 to 300 English words',
    long: '380 to 500 English words',
  };
  const levelDescriptions = {
    beginner: 'CEFR A1-A2: short sentences and common grammar',
    intermediate: 'CEFR B1-B2: varied sentences with clear context',
    advanced: 'CEFR C1-C2: nuanced, natural prose with sophisticated grammar',
  };
  const vocabulary = lexemes.map((item) => ({
    lexemeId: item.lexemeId,
    word: item.displayHeadword,
    definitionZh: item.definitionZh,
    partOfSpeech: item.partsOfSpeech,
    exampleEn: item.exampleEn,
  }));
  const translationInstruction = input.includeTranslation
    ? 'Provide a complete Traditional Chinese translation in translationZh.'
    : 'Set translationZh to null.';

  return [
    {
      role: 'system',
      content: [
        'You write useful English reading practice for Traditional Chinese learners.',
        'Return only one valid JSON object. Do not use Markdown fences or add commentary.',
        'Use every requested vocabulary word naturally in the English article.',
        'Keep the exact requested word visible at least once, even if you also use an inflected form.',
        'Create exactly 3 English comprehension questions with concise English answers.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Level: ${input.level} (${levelDescriptions[input.level]}).`,
        `Length: ${input.length} (${wordRanges[input.length]}).`,
        translationInstruction,
        'The JSON keys must be title, body, translationZh, usedWords, and questions.',
        'questions must contain objects with question and answer string keys.',
        `Vocabulary data: ${JSON.stringify(vocabulary)}`,
      ].join('\n'),
    },
  ];
}

function buildProviderBody(provider, model, messages) {
  if (provider === 'ollama') {
    return {
      model,
      messages,
      stream: false,
      format: OUTPUT_SCHEMA,
      options: { temperature: 0.65 },
    };
  }
  return {
    model,
    messages,
    temperature: 0.65,
    response_format: { type: 'json_object' },
  };
}

async function callModelProvider({ baseUrl, provider, model, messages, fetchImpl, timeoutMs }) {
  const endpoint = buildProviderEndpoint(validateLocalBaseUrl(baseUrl), provider);
  const requestBody = buildProviderBody(provider, model, messages);
  const upstream = await callLocalModel({
    endpoint,
    provider,
    requestBody,
    fetchImpl,
    timeoutMs,
  });
  return extractAssistantContent(provider, upstream);
}

function buildHermesPrompt(messages) {
  return [
    'You are generating one structured English-learning article for a local vocabulary app.',
    'Do not call tools, browse the web, access files, or take any action outside this response.',
    'Return only the final valid JSON object; no Markdown fence or explanation.',
    '',
    'SYSTEM INSTRUCTIONS:',
    messages[0].content,
    '',
    'REQUEST:',
    messages[1].content,
  ].join('\n');
}

async function callHermesAgent({ prompt, runHermes, command, timeoutMs, gateway, fetchImpl }) {
  if (gateway?.baseUrl) {
    return callHermesGateway({ prompt, gateway, fetchImpl, timeoutMs });
  }
  if (typeof runHermes === 'function') {
    const output = await runHermes({ prompt, timeoutMs });
    if (typeof output !== 'string') {
      throw new ArticleError(502, 'HERMES_INVALID_RESPONSE', 'Hermes Agent did not return text');
    }
    return output;
  }
  return invokeHermes({ prompt, command, timeoutMs });
}

async function callHermesGateway({ prompt, gateway, fetchImpl, timeoutMs }) {
  if (typeof fetchImpl !== 'function') {
    throw new ArticleError(500, 'FETCH_UNAVAILABLE', 'This Node runtime does not provide fetch');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('hermesTimeoutMs must be an integer from 1 to 300000');
  }
  const endpoint = buildHermesGatewayEndpoint(gateway.baseUrl);
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (gateway.apiKey) headers.Authorization = `Bearer ${gateway.apiKey}`;
  if (gateway.sessionKey) headers['X-Hermes-Session-Key'] = gateway.sessionKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: gateway.model || 'hermes',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.65,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
      redirect: 'error',
    });
    try {
      payload = await response.json();
    } catch {
      throw new ArticleError(
        502,
        'HERMES_GATEWAY_INVALID_RESPONSE',
        'Hermes Gateway returned a non-JSON response',
      );
    }
  } catch (error) {
    if (error instanceof ArticleError) throw error;
    if (controller.signal.aborted) {
      throw new ArticleError(
        504,
        'HERMES_GATEWAY_TIMEOUT',
        `Hermes Gateway did not respond within ${timeoutMs} ms`,
      );
    }
    throw new ArticleError(
      502,
      'HERMES_GATEWAY_CONNECTION_FAILED',
      'Could not connect to the Hermes Gateway',
      { cause: safeCause(error) },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ArticleError(
      502,
      'HERMES_GATEWAY_ERROR',
      'Hermes Gateway rejected the generation request',
      {
        upstreamStatus: response.status,
        upstreamMessage: extractUpstreamMessage(payload),
      },
    );
  }
  return extractAssistantContent('openai', payload);
}

function buildHermesGatewayEndpoint(baseUrl) {
  const endpoint = new URL(baseUrl);
  let pathname = endpoint.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/v1/chat/completions')) {
    pathname = pathname.endsWith('/v1')
      ? `${pathname}/chat/completions`
      : `${pathname}/v1/chat/completions`;
  }
  endpoint.pathname = pathname.replace(/^\/\//, '/');
  return endpoint;
}

function invokeHermes({ prompt, command = process.env.HERMES_COMMAND || 'hermes', timeoutMs }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('hermesTimeoutMs must be an integer from 1 to 300000');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, [
      '--oneshot',
      prompt,
      '--toolsets',
      'context_engine',
      '--ignore-rules',
    ], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, HERMES_IGNORE_RULES: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new ArticleError(
        504,
        'HERMES_TIMEOUT',
        `Hermes Agent did not respond within ${timeoutMs} ms`,
      )));
    }, timeoutMs);
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_HERMES_OUTPUT_BYTES) {
        child.kill();
        finish(() => reject(new ArticleError(
          502,
          'HERMES_OUTPUT_TOO_LARGE',
          'Hermes Agent produced too much output',
        )));
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.once('error', (error) => finish(() => reject(new ArticleError(
      502,
      'HERMES_UNAVAILABLE',
      'Could not start Hermes Agent. Confirm that the hermes command is installed.',
      { cause: safeCause(error) },
    ))));
    child.once('close', (code, signal) => finish(() => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      reject(new ArticleError(
        502,
        'HERMES_AGENT_FAILED',
        'Hermes Agent did not complete the article request',
        { exitCode: code, signal, detail: stderr.trim().slice(0, 500) || null },
      ));
    }));
  });
}

async function callLocalModel({ endpoint, provider, requestBody, fetchImpl, timeoutMs }) {
  if (typeof fetchImpl !== 'function') {
    throw new ArticleError(500, 'FETCH_UNAVAILABLE', 'This Node runtime does not provide fetch');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('articleTimeoutMs must be an integer from 1 to 300000');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
      redirect: 'error',
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ArticleError(
        502,
        'AI_INVALID_RESPONSE',
        'The local AI returned a non-JSON response',
        { provider, upstreamStatus: response.status },
      );
    }
  } catch (error) {
    if (error instanceof ArticleError) throw error;
    if (controller.signal.aborted) {
      throw new ArticleError(
        504,
        'AI_REQUEST_TIMEOUT',
        `The local AI did not respond within ${timeoutMs} ms`,
      );
    }
    throw new ArticleError(
      502,
      'AI_CONNECTION_FAILED',
      'Could not connect to the local AI service',
      { provider, cause: safeCause(error) },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ArticleError(
      502,
      'AI_UPSTREAM_ERROR',
      'The local AI rejected the generation request',
      {
        provider,
        upstreamStatus: response.status,
        upstreamMessage: extractUpstreamMessage(payload),
      },
    );
  }
  return payload;
}

function extractAssistantContent(provider, payload) {
  let content;
  if (provider === 'ollama') {
    content = payload?.message?.content;
  } else {
    content = payload?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
      content = content
        .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
        .join('');
    }
  }
  if (typeof content !== 'string' || content.trim() === '') {
    throw new ArticleError(
      502,
      'AI_INVALID_RESPONSE',
      'The local AI response did not contain assistant text',
      { provider },
    );
  }
  return content;
}

function parseGeneratedArticle(content) {
  let parsed;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw invalidOutput();
    }
    try {
      parsed = JSON.parse(content.slice(start, end + 1));
    } catch {
      throw invalidOutput();
    }
  }
  if (parsed && typeof parsed.article === 'object') parsed = parsed.article;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidOutput();

  const title = cleanGeneratedString(parsed.title);
  const body = cleanGeneratedString(parsed.body ?? parsed.article);
  const translationValue = parsed.translationZh
    ?? parsed.translation
    ?? parsed.translation_zh
    ?? parsed.chineseTranslation;
  const translationZh = parsed.translationZh === null
    ? null
    : cleanGeneratedString(translationValue);
  const usedWords = Array.isArray(parsed.usedWords)
    ? parsed.usedWords.filter((item) => typeof item === 'string').map((item) => item.trim())
    : [];
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((item) => ({
          question: cleanGeneratedString(item?.question),
          answer: cleanGeneratedString(item?.answer),
        }))
        .filter((item) => item.question && item.answer)
    : [];
  if (!title || !body || questions.length === 0) throw invalidOutput();

  return { title, body, translationZh, usedWords, questions };
}

function identifyUsedWords(generated, lexemes) {
  const articleText = `${generated.title}\n${generated.body}`;
  return lexemes
    .filter((lexeme) => {
      const forms = [lexeme.displayHeadword, lexeme.canonicalTerm, ...lexeme.variants]
        .filter(Boolean);
      return forms.some((form) => containsTerm(articleText, form));
    })
    .map((lexeme) => lexeme.displayHeadword);
}

function containsTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z])${escaped}(?=$|[^A-Za-z])`, 'i').test(text);
}

function cleanGeneratedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function invalidOutput() {
  return new ArticleError(
    502,
    'AI_INVALID_OUTPUT',
    'The local AI did not return the required article structure',
  );
}

function safeCause(error) {
  return error instanceof Error ? error.message.slice(0, 300) : 'Unknown connection error';
}

function extractUpstreamMessage(payload) {
  const message = payload?.error?.message ?? payload?.error ?? payload?.message;
  return typeof message === 'string' ? message.slice(0, 500) : null;
}

module.exports = {
  ArticleError,
  DEFAULT_ARTICLE_TIMEOUT_MS,
  DEFAULT_HERMES_TIMEOUT_MS,
  generateArticle,
};
