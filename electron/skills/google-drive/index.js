// ─── Google Drive Runtime ─────────────────────────────────────────
// Search, read, upload, and manage files in Google Drive.

const https = require('https');
const { URL } = require('url');
const BaseRuntime = require('../base-runtime');
const { performOAuth2Flow, refreshOAuth2Token } = require('../oauth-helper');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

class GoogleDriveRuntime extends BaseRuntime {
  constructor() {
    super('google-drive');

    this._credentials = null;
    this._oauthConfig = null;

    // ── Register tools ────────────────────────────────────────────

    this.registerTool('drive:list', {
      name: 'drive:list',
      description: 'List files in Google Drive, optionally within a specific folder.',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: 'Folder ID to list (default: root)' },
          query: { type: 'string', description: 'Drive search query (e.g. "mimeType=\'application/pdf\'")' },
          maxResults: { type: 'number', description: 'Max files to return (default 20)' },
        },
        required: [],
      },
    }, this._list);

    this.registerTool('drive:search', {
      name: 'drive:search',
      description: 'Search for files by name or content in Google Drive.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term (searches file names and content)' },
          maxResults: { type: 'number', description: 'Max files to return (default 20)' },
        },
        required: ['query'],
      },
    }, this._search);

    this.registerTool('drive:read', {
      name: 'drive:read',
      description: 'Read the text content of a file in Google Drive. Works with Docs, Sheets (as CSV), and plain text files.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Google Drive file ID' },
          mimeType: { type: 'string', description: 'Export MIME type for Google Docs (default: text/plain). Use text/csv for Sheets.' },
        },
        required: ['fileId'],
      },
    }, this._read, { timeout: 60_000 });

    this.registerTool('drive:upload', {
      name: 'drive:upload',
      description: 'Upload a text file to Google Drive.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name' },
          content: { type: 'string', description: 'Text content of the file' },
          mimeType: { type: 'string', description: 'MIME type (default: text/plain)' },
          folderId: { type: 'string', description: 'Parent folder ID (optional, defaults to root)' },
        },
        required: ['name', 'content'],
      },
    }, this._upload, { timeout: 60_000 });

    this.registerTool('drive:create_folder', {
      name: 'drive:create_folder',
      description: 'Create a new folder in Google Drive.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Folder name' },
          parentId: { type: 'string', description: 'Parent folder ID (optional, defaults to root)' },
        },
        required: ['name'],
      },
    }, this._createFolder);

    this.registerTool('drive:share', {
      name: 'drive:share',
      description: 'Share a file or folder with a user or make it publicly accessible.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'File or folder ID' },
          email: { type: 'string', description: 'Email address to share with (omit for public link)' },
          role: { type: 'string', description: 'Permission role: reader, writer, commenter (default: reader)' },
        },
        required: ['fileId'],
      },
    }, this._share);
  }

  // ── Auth ──────────────────────────────────────────────────────

  getAuthConfig() {
    return {
      type: 'oauth2',
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/drive'],
    };
  }

  getCredentials() { return this._credentials; }
  getConfig() { return this._oauthConfig ? { ...this._oauthConfig } : {}; }

  async beforeExecute() {
    await this._ensureValidToken();
  }

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
      return;
    }

    const tokens = await performOAuth2Flow({
      authUrl: GOOGLE_AUTH_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
      clientId,
      clientSecret,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    this._storeTokens(tokens);
    this.status = 'connected';
  }

  async refreshAuth() { await this._refreshToken(); }

  async disconnect() {
    this._credentials = null;
    this._oauthConfig = null;
    this.status = 'disconnected';
  }

  async destroy() {
    this._credentials = null;
    this._oauthConfig = null;
    this.status = 'disconnected';
  }

  // ── Tool implementations ──────────────────────────────────────

  async _list({ folderId, query, maxResults = 20 } = {}) {
    const parts = [`pageSize=${maxResults}`, 'fields=files(id,name,mimeType,modifiedTime,size,webViewLink)'];
    const qParts = [];
    if (folderId) qParts.push(`'${folderId}' in parents`);
    if (query) qParts.push(query);
    qParts.push('trashed = false');
    parts.push(`q=${encodeURIComponent(qParts.join(' and '))}`);

    const data = await this._apiGet(`/files?${parts.join('&')}`);
    return (data.files || []).map(_formatFile);
  }

  async _search({ query, maxResults = 20 }) {
    const q = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
    const params = `pageSize=${maxResults}&q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)`;
    const data = await this._apiGet(`/files?${params}`);
    return (data.files || []).map(_formatFile);
  }

  async _read({ fileId, mimeType = 'text/plain' }) {
    // Check if the file is a Google Workspace doc (needs export) or a regular file (needs download)
    const meta = await this._apiGet(`/files/${fileId}?fields=mimeType,name`);
    const isGoogleDoc = meta.mimeType && meta.mimeType.startsWith('application/vnd.google-apps.');

    let content;
    if (isGoogleDoc) {
      content = await this._apiGetRaw(`/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`);
    } else {
      content = await this._apiGetRaw(`/files/${fileId}?alt=media`);
    }

    return { name: meta.name, mimeType: meta.mimeType, content };
  }

  async _upload({ name, content, mimeType = 'text/plain', folderId }) {
    const metadata = { name, ...(folderId ? { parents: [folderId] } : {}) };

    // Use multipart upload for simplicity
    const boundary = '----OutworkedUploadBoundary';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const data = await this._apiRequestRaw(
      'POST',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      body,
      `multipart/related; boundary=${boundary}`
    );

    return { id: data.id, name: data.name, url: data.webViewLink };
  }

  async _createFolder({ name, parentId }) {
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    };
    const data = await this._apiPost('/files?fields=id,name,webViewLink', metadata);
    return { id: data.id, name: data.name, url: data.webViewLink };
  }

  async _share({ fileId, email, role = 'reader' }) {
    let permission;
    if (email) {
      permission = { type: 'user', role, emailAddress: email };
    } else {
      permission = { type: 'anyone', role };
    }
    await this._apiPost(`/files/${fileId}/permissions`, permission);

    // Return the sharing link
    const meta = await this._apiGet(`/files/${fileId}?fields=webViewLink`);
    return { ok: true, url: meta.webViewLink, sharedWith: email || 'anyone' };
  }

  // ── HTTP helpers ───────────────────────────────────────────────

  async _apiGet(path) {
    return this._apiRequest('GET', path, null);
  }

  async _apiPost(path, body) {
    return this._apiRequest('POST', path, body);
  }

  async _apiGetRaw(path) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(`${DRIVE_API_BASE}${path}`);
      const options = {
        hostname: fullUrl.hostname,
        port: 443,
        path: fullUrl.pathname + fullUrl.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this._credentials.access_token}`,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 401) {
            this.status = 'expired';
            reject(new Error('Drive API returned 401 — token expired'));
            return;
          }
          if (res.statusCode >= 400) {
            reject(new Error(`Drive API GET ${path} returned ${res.statusCode}: ${data.slice(0, 500)}`));
            return;
          }
          resolve(data);
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  _apiRequestRaw(method, fullUrlStr, body, contentType) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(fullUrlStr);
      const bodyBuf = Buffer.from(body, 'utf-8');

      const options = {
        hostname: fullUrl.hostname,
        port: 443,
        path: fullUrl.pathname + fullUrl.search,
        method,
        headers: {
          Authorization: `Bearer ${this._credentials.access_token}`,
          'Content-Type': contentType,
          'Content-Length': bodyBuf.length,
          Accept: 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Drive API ${method} returned ${res.statusCode}: ${data.slice(0, 500)}`));
            return;
          }
          try { resolve(JSON.parse(data)); } catch {
            reject(new Error(`Failed to parse Drive API response: ${data.slice(0, 500)}`));
          }
        });
      });
      req.on('error', reject);
      req.write(bodyBuf);
      req.end();
    });
  }

  _apiRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(`${DRIVE_API_BASE}${path}`);
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
            reject(new Error('Drive API returned 401 — token expired'));
            return;
          }
          if (res.statusCode === 204) { resolve(null); return; }
          if (res.statusCode >= 400) {
            let detail = data;
            try { detail = JSON.stringify(JSON.parse(data)); } catch { /* use raw */ }
            reject(new Error(`Drive API ${method} ${path} returned ${res.statusCode}: ${detail}`));
            return;
          }
          if (!data) { resolve({}); return; }
          try { resolve(JSON.parse(data)); } catch (e) {
            reject(new Error(`Failed to parse Drive API response: ${data}`));
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

// ── Helpers ──────────────────────────────────────────────────────

function _formatFile(f) {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    size: f.size ? parseInt(f.size, 10) : undefined,
    url: f.webViewLink,
  };
}

module.exports = GoogleDriveRuntime;
