// ─── Slack Runtime ────────────────────────────────────────────────
// Workspace management and search tools for Slack.
// Messaging (send/receive) is handled by the Slack channel — this skill
// covers everything else: search, channel management, reactions, pins, users.

const https = require('https');
const { URL } = require('url');
const BaseRuntime = require('../base-runtime');
const { performOAuth2Flow, refreshOAuth2Token } = require('../oauth-helper');

const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_API_BASE = 'https://slack.com/api';

class SlackRuntime extends BaseRuntime {
  constructor() {
    super('slack');

    this._credentials = null;
    this._oauthConfig = null;

    // ── Register tools ────────────────────────────────────────────

    this.registerTool('slack:search_messages', {
      name: 'slack:search_messages',
      description: 'Search messages across the Slack workspace.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (supports Slack search syntax)' },
          count: { type: 'number', description: 'Number of results to return (default 20, max 100)' },
        },
        required: ['query'],
      },
    }, this._searchMessages);

    this.registerTool('slack:list_channels', {
      name: 'slack:list_channels',
      description: 'List public and private channels in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max channels to return (default 100)' },
          types: { type: 'string', description: 'Comma-separated channel types: public_channel, private_channel (default: "public_channel")' },
        },
        required: [],
      },
    }, this._listChannels);

    this.registerTool('slack:create_channel', {
      name: 'slack:create_channel',
      description: 'Create a new Slack channel.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Channel name (lowercase, no spaces, max 80 chars)' },
          isPrivate: { type: 'boolean', description: 'Whether to create a private channel (default false)' },
          description: { type: 'string', description: 'Channel purpose/description (optional)' },
        },
        required: ['name'],
      },
    }, this._createChannel);

    this.registerTool('slack:set_topic', {
      name: 'slack:set_topic',
      description: 'Set the topic of a Slack channel.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: 'Slack channel ID' },
          topic: { type: 'string', description: 'New topic text' },
        },
        required: ['channelId', 'topic'],
      },
    }, this._setTopic);

    this.registerTool('slack:add_reaction', {
      name: 'slack:add_reaction',
      description: 'Add an emoji reaction to a message.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: 'Channel containing the message' },
          timestamp: { type: 'string', description: 'Message timestamp (ts)' },
          emoji: { type: 'string', description: 'Emoji name without colons (e.g. "thumbsup")' },
        },
        required: ['channelId', 'timestamp', 'emoji'],
      },
    }, this._addReaction);

    this.registerTool('slack:pin_message', {
      name: 'slack:pin_message',
      description: 'Pin a message in a channel.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: 'Channel containing the message' },
          timestamp: { type: 'string', description: 'Message timestamp (ts)' },
        },
        required: ['channelId', 'timestamp'],
      },
    }, this._pinMessage);

    this.registerTool('slack:list_users', {
      name: 'slack:list_users',
      description: 'List users in the Slack workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max users to return (default 100)' },
        },
        required: [],
      },
    }, this._listUsers);
  }

  // ── Auth ──────────────────────────────────────────────────────

  getAuthConfig() {
    return {
      type: 'oauth2',
      provider: 'slack',
      scopes: [
        'search:read',
        'channels:read',
        'channels:manage',
        'groups:read',
        'reactions:write',
        'pins:write',
        'users:read',
      ],
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
      authUrl: SLACK_AUTH_URL,
      tokenUrl: SLACK_TOKEN_URL,
      clientId,
      clientSecret,
      scopes: this.getAuthConfig().scopes,
      tokenResponsePath: 'authed_user', // Slack nests user tokens here
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

  async _searchMessages({ query, count = 20 }) {
    const data = await this._apiGet(`/search.messages?query=${encodeURIComponent(query)}&count=${count}`);
    const matches = data.messages?.matches || [];
    return matches.map((m) => ({
      text: m.text,
      user: m.user || m.username,
      channel: m.channel?.name,
      channelId: m.channel?.id,
      ts: m.ts,
      permalink: m.permalink,
    }));
  }

  async _listChannels({ limit = 100, types = 'public_channel' } = {}) {
    const data = await this._apiGet(`/conversations.list?limit=${limit}&types=${encodeURIComponent(types)}`);
    return (data.channels || []).map((ch) => ({
      id: ch.id,
      name: ch.name,
      topic: ch.topic?.value,
      purpose: ch.purpose?.value,
      memberCount: ch.num_members,
      isPrivate: ch.is_private,
    }));
  }

  async _createChannel({ name, isPrivate = false, description }) {
    const body = { name, is_private: isPrivate };
    const data = await this._apiPost('/conversations.create', body);
    const ch = data.channel;
    if (description && ch) {
      await this._apiPost('/conversations.setPurpose', { channel: ch.id, purpose: description });
    }
    return { id: ch.id, name: ch.name };
  }

  async _setTopic({ channelId, topic }) {
    await this._apiPost('/conversations.setTopic', { channel: channelId, topic });
    return { ok: true, channelId, topic };
  }

  async _addReaction({ channelId, timestamp, emoji }) {
    await this._apiPost('/reactions.add', { channel: channelId, timestamp, name: emoji });
    return { ok: true, emoji };
  }

  async _pinMessage({ channelId, timestamp }) {
    await this._apiPost('/pins.add', { channel: channelId, timestamp });
    return { ok: true, channelId, timestamp };
  }

  async _listUsers({ limit = 100 } = {}) {
    const data = await this._apiGet(`/users.list?limit=${limit}`);
    return (data.members || [])
      .filter((u) => !u.deleted && !u.is_bot)
      .map((u) => ({
        id: u.id,
        name: u.name,
        realName: u.real_name,
        displayName: u.profile?.display_name,
        email: u.profile?.email,
        isAdmin: u.is_admin,
      }));
  }

  // ── HTTP helpers ───────────────────────────────────────────────

  async _apiGet(pathAndQuery) {
    return this._apiRequest('GET', pathAndQuery, null);
  }

  async _apiPost(apiPath, body) {
    return this._apiRequest('POST', apiPath, body);
  }

  _apiRequest(method, pathAndQuery, body) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(`${SLACK_API_BASE}${pathAndQuery}`);
      const bodyStr = body ? JSON.stringify(body) : null;

      const options = {
        hostname: fullUrl.hostname,
        port: 443,
        path: fullUrl.pathname + fullUrl.search,
        method,
        headers: {
          Authorization: `Bearer ${this._credentials.access_token}`,
          Accept: 'application/json',
          ...(bodyStr ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Slack API ${method} ${pathAndQuery} returned ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) {
              reject(new Error(`Slack API error: ${parsed.error || 'unknown'}`));
              return;
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse Slack API response: ${data}`));
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
    const expiresIn = tokens.expires_in || 43200; // Slack tokens rotate every 12h
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

module.exports = SlackRuntime;
