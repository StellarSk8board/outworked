// ─── Gmail Runtime ───────────────────────────────────────────────
// Active skill runtime for Gmail via Google's REST API.
// Uses OAuth2 (PKCE) for authentication — no googleapis npm package needed.

const https = require('https');
const { URL } = require('url');
const BaseRuntime = require('../base-runtime');
const { performOAuth2Flow, refreshOAuth2Token } = require('../oauth-helper');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const POLL_INTERVAL_MS = 30_000;

class GmailRuntime extends BaseRuntime {
  constructor() {
    super('gmail');

    this._credentials = null;
    this._oauthConfig = null;
    this._pollTimer = null;
    this._lastHistoryId = null;

    // ── Register tools ────────────────────────────────────────────
    this.registerTool('gmail:search', {
      name: 'gmail:search',
      description: 'Search Gmail messages using Gmail query syntax (e.g. "from:alice subject:hello is:unread").',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query' },
          maxResults: { type: 'number', description: 'Max number of results (default 10, max 500)' },
        },
        required: ['query'],
      },
    }, this._search);

    this.registerTool('gmail:read', {
      name: 'gmail:read',
      description: 'Read the full content of a Gmail message by its ID.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Gmail message ID' },
        },
        required: ['messageId'],
      },
    }, this._read);

    this.registerTool('gmail:send', {
      name: 'gmail:send',
      description: 'Send a new email.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address (or comma-separated list)' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Plain-text email body' },
          cc: { type: 'string', description: 'CC email addresses (optional)' },
          bcc: { type: 'string', description: 'BCC email addresses (optional)' },
        },
        required: ['to', 'subject', 'body'],
      },
    }, this._send);

    this.registerTool('gmail:reply', {
      name: 'gmail:reply',
      description: 'Reply to an existing Gmail thread.',
      parameters: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Gmail thread ID to reply in' },
          body: { type: 'string', description: 'Reply body (plain text)' },
        },
        required: ['threadId', 'body'],
      },
    }, this._reply);

    this.registerTool('gmail:list_labels', {
      name: 'gmail:list_labels',
      description: 'List all Gmail labels for the authenticated account.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    }, this._listLabels);
  }

  // ── Auth config ────────────────────────────────────────────────

  getAuthConfig() {
    return {
      type: 'oauth2',
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    };
  }

  getCredentials() {
    return this._credentials;
  }

  getConfig() {
    return this._oauthConfig ? { ...this._oauthConfig } : {};
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async beforeExecute() {
    await this._ensureValidToken();
  }

  async destroy() {
    this._stopPolling();
    this._credentials = null;
    this._oauthConfig = null;
    this._lastHistoryId = null;
    this.status = 'disconnected';
  }

  // ── Authentication ─────────────────────────────────────────────

  async authenticate(credentials, opts = {}) {
    const { clientId, clientSecret } = credentials;
    this._oauthConfig = { clientId, clientSecret };

    if (opts.silent && credentials.access_token) {
      this._credentials = {
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token,
        expires_at: credentials.expires_at,
      };

      if (this._isTokenExpired()) {
        await this._refreshToken();
      } else {
        this.status = 'connected';
      }
      this._startPolling();
      return;
    }

    const tokens = await performOAuth2Flow({
      authUrl: GOOGLE_AUTH_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
      clientId,
      clientSecret,
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    });

    this._storeTokens(tokens);
    this.status = 'connected';
    this._startPolling();
  }

  async refreshAuth() {
    await this._refreshToken();
  }

  async disconnect() {
    this._stopPolling();
    this._credentials = null;
    this._oauthConfig = null;
    this._lastHistoryId = null;
    this.status = 'disconnected';
  }

  // ── Triggers ───────────────────────────────────────────────────

  getTriggerTypes() {
    return ['gmail:new_email'];
  }

  // ── Tool implementations ──────────────────────────────────────

  async _search({ query, maxResults = 10 }) {
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    const data = await this._apiGet(`/messages?${params}`);
    const messages = data.messages || [];

    const detailed = await Promise.all(
      messages.map((m) => this._apiGet(`/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`))
    );

    return detailed.map((msg) => ({
      id: msg.id,
      threadId: msg.threadId,
      snippet: msg.snippet,
      headers: _headersToMap(msg.payload?.headers || []),
    }));
  }

  async _read({ messageId }) {
    const msg = await this._apiGet(`/messages/${messageId}?format=full`);
    const headers = _headersToMap(msg.payload?.headers || []);
    const body = _extractBody(msg.payload);

    return {
      id: msg.id,
      threadId: msg.threadId,
      snippet: msg.snippet,
      headers,
      body,
      labelIds: msg.labelIds || [],
    };
  }

  async _send({ to, subject, body, cc, bcc }) {
    const lines = [
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      ...(bcc ? [`Bcc: ${bcc}`] : []),
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body,
    ];
    const raw = _base64url(lines.join('\r\n'));
    const result = await this._apiPost('/messages/send', { raw });
    return { id: result.id, threadId: result.threadId };
  }

  async _reply({ threadId, body }) {
    const thread = await this._apiGet(`/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`);
    const messages = thread.messages || [];
    if (!messages.length) {
      throw new Error(`Thread '${threadId}' has no messages`);
    }

    const lastMsg = messages[messages.length - 1];
    const headers = _headersToMap(lastMsg.payload?.headers || []);
    const originalFrom = headers['From'] || '';
    const originalSubject = headers['Subject'] || '';
    const originalMsgId = headers['Message-ID'] || '';

    const subject = originalSubject.startsWith('Re:')
      ? originalSubject
      : `Re: ${originalSubject}`;

    const lines = [
      `To: ${originalFrom}`,
      `Subject: ${subject}`,
      ...(originalMsgId ? [`In-Reply-To: ${originalMsgId}`, `References: ${originalMsgId}`] : []),
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body,
    ];
    const raw = _base64url(lines.join('\r\n'));
    const result = await this._apiPost('/messages/send', { raw, threadId });
    return { id: result.id, threadId: result.threadId };
  }

  async _listLabels() {
    const data = await this._apiGet('/labels');
    return (data.labels || []).map((l) => ({ id: l.id, name: l.name, type: l.type }));
  }

  // ── Polling ────────────────────────────────────────────────────

  _startPolling() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _poll() {
    if (this.status !== 'connected') return;
    try {
      await this._ensureValidToken();

      if (!this._lastHistoryId) {
        const profile = await this._apiGet('/profile');
        this._lastHistoryId = profile.historyId;
        return;
      }

      const params = new URLSearchParams({
        startHistoryId: this._lastHistoryId,
        historyTypes: 'messageAdded',
      });
      const data = await this._apiGet(`/history?${params}`);

      if (!data.history || !data.history.length) {
        if (data.historyId) this._lastHistoryId = data.historyId;
        return;
      }

      const newMessageIds = new Set();
      for (const entry of data.history) {
        for (const added of entry.messagesAdded || []) {
          newMessageIds.add(added.message.id);
        }
      }

      if (data.historyId) this._lastHistoryId = data.historyId;

      for (const messageId of newMessageIds) {
        try {
          const msg = await this._apiGet(`/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
          this._emit('gmail:new_email', {
            id: msg.id,
            threadId: msg.threadId,
            snippet: msg.snippet,
            headers: _headersToMap(msg.payload?.headers || []),
          });
        } catch (err) {
          console.warn(`[gmail] Failed to fetch new message ${messageId}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('[gmail] Polling error:', err.message);
    }
  }

  // ── HTTP helpers ───────────────────────────────────────────────

  async _apiGet(path) {
    return this._apiRequest('GET', path, null);
  }

  async _apiPost(path, body) {
    return this._apiRequest('POST', path, body);
  }

  _apiRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(`${GMAIL_API_BASE}${path}`);
      const bodyStr = body ? JSON.stringify(body) : null;

      const options = {
        hostname: fullUrl.hostname,
        port: 443,
        path: fullUrl.pathname + fullUrl.search,
        method,
        headers: {
          Authorization: `Bearer ${this._credentials.access_token}`,
          Accept: 'application/json',
          ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 401) {
            this.status = 'expired';
            reject(new Error('Gmail API returned 401 — token expired'));
            return;
          }
          if (res.statusCode >= 400) {
            let detail = data;
            try { detail = JSON.stringify(JSON.parse(data)); } catch { /* use raw */ }
            reject(new Error(`Gmail API ${method} ${path} returned ${res.statusCode}: ${detail}`));
            return;
          }
          if (!data) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse Gmail API response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // ── Token management ───────────────────────────────────────────

  _storeTokens(tokens) {
    const expiresIn = tokens.expires_in || 3600;
    this._credentials = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || this._credentials?.refresh_token,
      expires_at: Date.now() + expiresIn * 1000,
    };
  }

  _isTokenExpired() {
    if (!this._credentials?.expires_at) return false;
    return Date.now() >= this._credentials.expires_at - 60_000;
  }

  async _refreshToken() {
    if (!this._credentials?.refresh_token) {
      this.status = 'expired';
      throw new Error('No refresh token available — user must re-authenticate');
    }
    try {
      const tokens = await refreshOAuth2Token(this._oauthConfig, this._credentials.refresh_token);
      this._storeTokens(tokens);
      this.status = 'connected';
    } catch (err) {
      this.status = 'expired';
      throw new Error(`Token refresh failed: ${err.message}`);
    }
  }

  async _ensureValidToken() {
    if (this._isTokenExpired()) {
      await this._refreshToken();
    }
  }
}

// ── Module-level helpers ─────────────────────────────────────────

function _headersToMap(headers) {
  const map = {};
  for (const h of headers) {
    map[h.name] = h.value;
  }
  return map;
}

function _extractBody(payload) {
  if (!payload) return '';

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (plain?.body?.data) {
      return Buffer.from(plain.body.data, 'base64').toString('utf-8');
    }
    const html = payload.parts.find((p) => p.mimeType === 'text/html');
    if (html?.body?.data) {
      return Buffer.from(html.body.data, 'base64').toString('utf-8');
    }
    for (const part of payload.parts) {
      const body = _extractBody(part);
      if (body) return body;
    }
  }

  return '';
}

function _base64url(str) {
  return Buffer.from(str).toString('base64url');
}

module.exports = GmailRuntime;
