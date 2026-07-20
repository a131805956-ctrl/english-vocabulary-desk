'use strict';

const crypto = require('node:crypto');

const DEFAULT_API_EDIT_PASSWORD = 'morpheme-local';
const SETTINGS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

class RuntimeSettingsError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'RuntimeSettingsError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class RuntimeAiConfig {
  constructor(options = {}) {
    this.editPassword = normalizePassword(
      options.apiEditPassword ?? process.env.API_EDIT_PASSWORD ?? DEFAULT_API_EDIT_PASSWORD,
    );
    this.settings = {
      hermes: normalizeGateway({
        baseUrl: options.hermesApiUrl ?? process.env.HERMES_API_URL ?? '',
        apiKey: options.hermesApiKey ?? process.env.HERMES_API_KEY ?? '',
        model: options.hermesApiModel ?? process.env.HERMES_API_MODEL ?? '',
        sessionKey: options.hermesSessionKey ?? process.env.HERMES_SESSION_KEY ?? '',
      }),
    };
    this.sessions = new Map();
  }

  authenticate(password) {
    if (typeof password !== 'string' || !safeEqual(password, this.editPassword)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SETTINGS_TOKEN_TTL_MS;
    this.sessions.set(token, expiresAt);
    this.removeExpiredSessions();
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  requireSession(token) {
    this.removeExpiredSessions();
    if (typeof token !== 'string' || !this.sessions.has(token)) {
      throw new RuntimeSettingsError(
        401,
        'API_SETTINGS_UNAUTHORIZED',
        'Unlock the API settings page before editing it',
      );
    }
    return true;
  }

  getGateway() {
    const { baseUrl, apiKey, model, sessionKey } = this.settings.hermes;
    if (!baseUrl) return null;
    return { baseUrl, apiKey, model, sessionKey };
  }

  getPublicSettings() {
    const gateway = this.settings.hermes;
    return {
      hermes: {
        baseUrl: gateway.baseUrl,
        model: gateway.model,
        sessionKey: gateway.sessionKey,
        apiKeyConfigured: Boolean(gateway.apiKey),
        apiKeyMasked: gateway.apiKey ? maskSecret(gateway.apiKey) : null,
      },
    };
  }

  update(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new RuntimeSettingsError(400, 'INVALID_API_SETTINGS', 'Settings must be an object');
    }
    const hermes = payload.hermes;
    if (!hermes || typeof hermes !== 'object' || Array.isArray(hermes)) {
      throw new RuntimeSettingsError(400, 'INVALID_HERMES_SETTINGS', 'Hermes settings are required');
    }

    const current = this.settings.hermes;
    const next = normalizeGateway({
      baseUrl: hermes.baseUrl,
      model: hermes.model,
      sessionKey: hermes.sessionKey,
      apiKey: hermes.apiKey === undefined ? current.apiKey : hermes.apiKey,
    }, current);
    this.settings.hermes = next;
    return this.getPublicSettings();
  }

  removeExpiredSessions() {
    const now = Date.now();
    for (const [token, expiresAt] of this.sessions) {
      if (expiresAt <= now) this.sessions.delete(token);
    }
  }
}

function normalizePassword(value) {
  if (typeof value !== 'string' || value.trim().length < 6) {
    throw new Error('API_EDIT_PASSWORD must contain at least 6 characters');
  }
  return value.trim();
}

function normalizeGateway(input, current = {}) {
  const baseUrl = input.baseUrl === undefined ? current.baseUrl ?? '' : String(input.baseUrl).trim();
  const model = input.model === undefined ? current.model ?? '' : String(input.model).trim();
  const sessionKey = input.sessionKey === undefined
    ? current.sessionKey ?? ''
    : String(input.sessionKey).trim();
  const apiKey = input.apiKey === undefined ? current.apiKey ?? '' : String(input.apiKey).trim();

  if (baseUrl) {
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new RuntimeSettingsError(400, 'INVALID_HERMES_URL', 'Hermes API URL must be absolute');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new RuntimeSettingsError(400, 'INVALID_HERMES_URL', 'Hermes API URL must use http or https');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new RuntimeSettingsError(
        400,
        'INVALID_HERMES_URL',
        'Hermes API URL cannot contain credentials, a query, or a fragment',
      );
    }
  }
  if (baseUrl.length > 2_048) {
    throw new RuntimeSettingsError(400, 'INVALID_HERMES_URL', 'Hermes API URL is too long');
  }
  if (model.length > 200 || sessionKey.length > 200 || apiKey.length > 4_096) {
    throw new RuntimeSettingsError(400, 'INVALID_HERMES_SETTINGS', 'Hermes setting is too long');
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model,
    sessionKey,
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function maskSecret(value) {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

module.exports = {
  DEFAULT_API_EDIT_PASSWORD,
  RuntimeAiConfig,
  RuntimeSettingsError,
};
