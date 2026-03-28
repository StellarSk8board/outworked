// ─── Google Sheets Runtime ────────────────────────────────────────
// Read, write, and manage Google Sheets spreadsheets via the Sheets API v4.

const https = require('https');
const { URL } = require('url');
const BaseRuntime = require('../base-runtime');
const { performOAuth2Flow, refreshOAuth2Token } = require('../oauth-helper');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

class GoogleSheetsRuntime extends BaseRuntime {
  constructor() {
    super('google-sheets');

    this._credentials = null;
    this._oauthConfig = null;

    // ── Register tools ────────────────────────────────────────────

    this.registerTool('sheets:read', {
      name: 'sheets:read',
      description: 'Read a range of cells from a Google Sheets spreadsheet.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'Spreadsheet ID (from the URL)' },
          range: { type: 'string', description: 'A1 notation range (e.g. "Sheet1!A1:D10")' },
        },
        required: ['spreadsheetId', 'range'],
      },
    }, this._read);

    this.registerTool('sheets:write', {
      name: 'sheets:write',
      description: 'Write values to a range of cells in a Google Sheets spreadsheet.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
          range: { type: 'string', description: 'A1 notation range to write to (e.g. "Sheet1!A1")' },
          values: { type: 'array', description: 'Array of rows, each row is an array of cell values' },
        },
        required: ['spreadsheetId', 'range', 'values'],
      },
    }, this._write);

    this.registerTool('sheets:append', {
      name: 'sheets:append',
      description: 'Append rows to the end of a table in a Google Sheets spreadsheet.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
          range: { type: 'string', description: 'A1 notation of the table to append to (e.g. "Sheet1!A:D")' },
          values: { type: 'array', description: 'Array of rows to append' },
        },
        required: ['spreadsheetId', 'range', 'values'],
      },
    }, this._append);

    this.registerTool('sheets:create', {
      name: 'sheets:create',
      description: 'Create a new Google Sheets spreadsheet.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title for the new spreadsheet' },
          sheetNames: { type: 'array', description: 'Names for the sheets/tabs (optional, defaults to "Sheet1")' },
        },
        required: ['title'],
      },
    }, this._create);

    this.registerTool('sheets:get_metadata', {
      name: 'sheets:get_metadata',
      description: 'Get spreadsheet metadata including sheet names, row/column counts.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
        },
        required: ['spreadsheetId'],
      },
    }, this._getMetadata);
  }

  // ── Auth ──────────────────────────────────────────────────────

  getAuthConfig() {
    return {
      type: 'oauth2',
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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

  async _read({ spreadsheetId, range }) {
    const encodedRange = encodeURIComponent(range);
    const data = await this._apiGet(`/${spreadsheetId}/values/${encodedRange}`);
    return {
      range: data.range,
      values: data.values || [],
    };
  }

  async _write({ spreadsheetId, range, values }) {
    const encodedRange = encodeURIComponent(range);
    const data = await this._apiRequest('PUT',
      `/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
      { range, values }
    );
    return {
      updatedRange: data.updatedRange,
      updatedRows: data.updatedRows,
      updatedColumns: data.updatedColumns,
      updatedCells: data.updatedCells,
    };
  }

  async _append({ spreadsheetId, range, values }) {
    const encodedRange = encodeURIComponent(range);
    const data = await this._apiPost(
      `/${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { range, values }
    );
    return {
      updatedRange: data.updates?.updatedRange,
      updatedRows: data.updates?.updatedRows,
      updatedCells: data.updates?.updatedCells,
    };
  }

  async _create({ title, sheetNames }) {
    const sheets = (sheetNames || ['Sheet1']).map((name) => ({
      properties: { title: name },
    }));
    const data = await this._apiRequest('POST', '', {
      properties: { title },
      sheets,
    });
    return {
      spreadsheetId: data.spreadsheetId,
      title: data.properties?.title,
      url: data.spreadsheetUrl,
      sheets: (data.sheets || []).map((s) => s.properties?.title),
    };
  }

  async _getMetadata({ spreadsheetId }) {
    const data = await this._apiGet(`/${spreadsheetId}?fields=properties.title,sheets.properties`);
    return {
      title: data.properties?.title,
      sheets: (data.sheets || []).map((s) => ({
        title: s.properties?.title,
        sheetId: s.properties?.sheetId,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      })),
    };
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
      const fullUrl = new URL(`${SHEETS_API_BASE}${path}`);
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
            reject(new Error('Sheets API returned 401 — token expired'));
            return;
          }
          if (res.statusCode >= 400) {
            let detail = data;
            try { detail = JSON.stringify(JSON.parse(data)); } catch { /* use raw */ }
            reject(new Error(`Sheets API ${method} ${path} returned ${res.statusCode}: ${detail}`));
            return;
          }
          if (!data) { resolve({}); return; }
          try { resolve(JSON.parse(data)); } catch (e) {
            reject(new Error(`Failed to parse Sheets API response: ${data}`));
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

module.exports = GoogleSheetsRuntime;
