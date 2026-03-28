// ─── Google Calendar Runtime ─────────────────────────────────────
// Active skill runtime for Google Calendar via Google's REST API.
// Uses OAuth2 (PKCE) for authentication — no googleapis npm package needed.

const https = require('https');
const { URL } = require('url');
const BaseRuntime = require('../base-runtime');
const { performOAuth2Flow, refreshOAuth2Token } = require('../oauth-helper');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

const DEFAULT_CALENDAR_ID = 'primary';

class GoogleCalendarRuntime extends BaseRuntime {
  constructor() {
    super('google-calendar');

    this._credentials = null;
    this._oauthConfig = null;

    // ── Register tools ────────────────────────────────────────────
    this.registerTool('calendar:list', {
      name: 'calendar:list',
      description: 'List upcoming Google Calendar events within a time range.',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string', description: 'Lower bound for event start time (RFC 3339 timestamp, e.g. "2026-03-24T00:00:00Z"). Defaults to now.' },
          timeMax: { type: 'string', description: 'Upper bound for event start time (RFC 3339 timestamp). Optional.' },
          maxResults: { type: 'number', description: 'Maximum number of events to return (default 10, max 2500).' },
          calendarId: { type: 'string', description: 'Calendar ID to query (default: "primary").' },
        },
        required: [],
      },
    }, this._list);

    this.registerTool('calendar:create', {
      name: 'calendar:create',
      description: 'Create a new Google Calendar event.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'Event start time (RFC 3339, e.g. "2026-03-25T09:00:00-07:00")' },
          end: { type: 'string', description: 'Event end time (RFC 3339)' },
          description: { type: 'string', description: 'Event description / notes (optional)' },
          location: { type: 'string', description: 'Event location (optional)' },
          calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'List of attendee email addresses (optional)' },
        },
        required: ['summary', 'start', 'end'],
      },
    }, this._create);

    this.registerTool('calendar:update', {
      name: 'calendar:update',
      description: 'Update fields on an existing Google Calendar event.',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'Google Calendar event ID' },
          updates: { type: 'object', description: 'Fields to update (summary, start, end, description, location)' },
          calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' },
        },
        required: ['eventId', 'updates'],
      },
    }, this._update);

    this.registerTool('calendar:delete', {
      name: 'calendar:delete',
      description: 'Delete a Google Calendar event.',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'Google Calendar event ID to delete' },
          calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' },
        },
        required: ['eventId'],
      },
    }, this._delete);
  }

  // ── Auth config ────────────────────────────────────────────────

  getAuthConfig() {
    return {
      type: 'oauth2',
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
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
    this._credentials = null;
    this._oauthConfig = null;
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
      return;
    }

    const tokens = await performOAuth2Flow({
      authUrl: GOOGLE_AUTH_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
      clientId,
      clientSecret,
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });

    this._storeTokens(tokens);
    this.status = 'connected';
  }

  async refreshAuth() {
    await this._refreshToken();
  }

  async disconnect() {
    this._credentials = null;
    this._oauthConfig = null;
    this.status = 'disconnected';
  }

  // ── Tool implementations ──────────────────────────────────────

  async _list({ timeMin, timeMax, maxResults = 10, calendarId = DEFAULT_CALENDAR_ID } = {}) {
    const queryParams = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(maxResults),
      timeMin: timeMin || new Date().toISOString(),
    });
    if (timeMax) queryParams.set('timeMax', timeMax);

    const data = await this._apiGet(`/calendars/${encodeURIComponent(calendarId)}/events?${queryParams}`);
    return (data.items || []).map(_formatEvent);
  }

  async _create({ summary, start, end, description, location, calendarId = DEFAULT_CALENDAR_ID, attendees = [] }) {
    const event = {
      summary,
      start: _parseDateTime(start),
      end: _parseDateTime(end),
      ...(description ? { description } : {}),
      ...(location ? { location } : {}),
      ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
    };

    const result = await this._apiPost(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      event,
    );
    return _formatEvent(result);
  }

  async _update({ eventId, updates, calendarId = DEFAULT_CALENDAR_ID }) {
    const patch = {};
    if (updates.summary !== undefined) patch.summary = updates.summary;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.location !== undefined) patch.location = updates.location;
    if (updates.start !== undefined) patch.start = _parseDateTime(updates.start);
    if (updates.end !== undefined) patch.end = _parseDateTime(updates.end);

    const result = await this._apiPatch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      patch,
    );
    return _formatEvent(result);
  }

  async _delete({ eventId, calendarId = DEFAULT_CALENDAR_ID }) {
    await this._apiDelete(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    return { deleted: true, eventId };
  }

  // ── HTTP helpers ───────────────────────────────────────────────

  async _apiGet(path) {
    return this._apiRequest('GET', path, null);
  }

  async _apiPost(path, body) {
    return this._apiRequest('POST', path, body);
  }

  async _apiPatch(path, body) {
    return this._apiRequest('PATCH', path, body);
  }

  async _apiDelete(path) {
    return this._apiRequest('DELETE', path, null);
  }

  _apiRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(`${CALENDAR_API_BASE}${path}`);
      const bodyStr = body ? JSON.stringify(body) : null;

      const options = {
        hostname: fullUrl.hostname,
        port: 443,
        path: fullUrl.pathname + fullUrl.search,
        method,
        headers: {
          Authorization: `Bearer ${this._credentials.access_token}`,
          Accept: 'application/json',
          ...(bodyStr
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
            : {}),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 401) {
            this.status = 'expired';
            reject(new Error('Calendar API returned 401 — token expired'));
            return;
          }
          if (res.statusCode === 204) {
            resolve(null);
            return;
          }
          if (res.statusCode >= 400) {
            let detail = data;
            try { detail = JSON.stringify(JSON.parse(data)); } catch { /* use raw */ }
            reject(new Error(`Calendar API ${method} ${path} returned ${res.statusCode}: ${detail}`));
            return;
          }
          if (!data) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse Calendar API response: ${data}`));
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

function _formatEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    status: event.status,
    htmlLink: event.htmlLink,
    attendees: (event.attendees || []).map((a) => ({ email: a.email, responseStatus: a.responseStatus })),
    creator: event.creator,
    organizer: event.organizer,
  };
}

function _parseDateTime(dtStr) {
  if (!dtStr) return undefined;
  if (dtStr.includes('T')) {
    return { dateTime: dtStr, timeZone: _inferTimezone(dtStr) };
  }
  return { date: dtStr };
}

function _inferTimezone(dtStr) {
  if (dtStr.endsWith('Z')) return 'UTC';
  const match = dtStr.match(/([+-]\d{2}:\d{2})$/);
  return match ? match[1] : 'UTC';
}

module.exports = GoogleCalendarRuntime;
