import { FormEvent, useState } from 'react';
import {
  ApiRequestError,
  authenticateApiSettings,
  getApiSettings,
  saveApiSettings,
} from '../api';
import type { HermesApiSettings } from '../types';

export function ApiSettingsEditor() {
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [settings, setSettings] = useState<HermesApiSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [sessionKey, setSessionKey] = useState('vocabulary-app');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const session = await authenticateApiSettings(password);
      const payload = await getApiSettings(session.token);
      setToken(session.token);
      setSettings(payload.hermes);
      setBaseUrl(payload.hermes.baseUrl);
      setModel(payload.hermes.model);
      setSessionKey(payload.hermes.sessionKey || 'vocabulary-app');
      setApiKey('');
      setClearApiKey(false);
      setPassword('');
    } catch (reason) {
      setError(apiSettingsMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await saveApiSettings(token, {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        sessionKey: sessionKey.trim(),
        ...(clearApiKey ? { apiKey: '' } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(payload.hermes);
      setApiKey('');
      setClearApiKey(false);
      setNotice('Hermes API 設定已保存；金鑰只留在這台單字伺服器的記憶體。');
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 401) {
        setToken(null);
        setSettings(null);
        setError('編輯頁工作階段已過期，請重新輸入密碼。');
      } else {
        setError(apiSettingsMessage(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!token || !settings) {
    return (
      <section className="api-settings-editor" aria-labelledby="api-settings-title">
        <div className="api-editor-heading">
          <p className="eyebrow">HERMES GATEWAY</p>
          <h3 id="api-settings-title">API 編輯頁</h3>
          <p>先解鎖，才會顯示 Hermes 位址、模型與金鑰欄位。</p>
        </div>
        <form className="api-editor-form" onSubmit={(event) => void unlock(event)}>
          <label>
            <span>編輯密碼</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="預設：morpheme-local"
              minLength={6}
              required
            />
          </label>
          {error && <p className="api-editor-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? '解鎖中…' : '解鎖 API 編輯頁'}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="api-settings-editor" aria-labelledby="api-settings-title">
      <div className="api-editor-heading">
        <p className="eyebrow">HERMES GATEWAY · UNLOCKED</p>
        <h3 id="api-settings-title">連到與 Telegram 相同的 Hermes</h3>
        <p>App 只呼叫單字伺服器；Hermes 金鑰不會被打包進 Android APK。</p>
      </div>
      <form className="api-editor-form" onSubmit={(event) => void save(event)}>
        <label>
          <span>Hermes API 位址</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://127.0.0.1:8642/v1"
            required
          />
        </label>
        <label>
          <span>模型名稱</span>
          <input
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="hermes"
            required
          />
        </label>
        <label>
          <span>Hermes Session Key（可選）</span>
          <input
            type="text"
            value={sessionKey}
            onChange={(event) => setSessionKey(event.target.value)}
            placeholder="vocabulary-app"
          />
        </label>
        <label>
          <span>API Key（留白代表保留現有金鑰）</span>
          <input
            type="password"
            value={apiKey}
            autoComplete="new-password"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={settings.apiKeyMasked ?? '若 Gateway 不要求可留白'}
          />
        </label>
        {settings.apiKeyConfigured && (
          <label className="api-editor-check">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.target.checked)}
            />
            <span>清除目前 API Key</span>
          </label>
        )}
        {error && <p className="api-editor-error" role="alert">{error}</p>}
        {notice && <p className="api-editor-notice" role="status">{notice}</p>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? '保存中…' : '保存 Hermes API 設定'}
        </button>
      </form>
    </section>
  );
}

function apiSettingsMessage(reason: unknown): string {
  if (reason instanceof ApiRequestError) {
    if (reason.code === 'API_SETTINGS_PASSWORD_INVALID') return '密碼不正確。';
    if (reason.code === 'INVALID_HERMES_URL') return 'Hermes API 位址必須是完整的 http:// 或 https:// 位址。';
    return reason.message;
  }
  return reason instanceof Error ? reason.message : 'API 設定操作失敗。';
}
