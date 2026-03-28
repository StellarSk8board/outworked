// ─── Notion Runtime ──────────────────────────────────────────────
// Search, read, and manage Notion pages and databases via the Notion API.
// Uses API key (integration token) authentication.

const https = require('https');
const { URL } = require('url');
const BaseRuntime = require('../base-runtime');

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

class NotionRuntime extends BaseRuntime {
  constructor() {
    super('notion');

    this._credentials = null;

    // ── Register tools ────────────────────────────────────────────

    this.registerTool('notion:search', {
      name: 'notion:search',
      description: 'Search Notion pages and databases by title.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (matches page/database titles)' },
          filter: { type: 'string', description: 'Filter by object type: "page" or "database" (optional)' },
          maxResults: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: ['query'],
      },
    }, this._search);

    this.registerTool('notion:read_page', {
      name: 'notion:read_page',
      description: 'Read the content of a Notion page as plain text.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Notion page ID (with or without dashes)' },
        },
        required: ['pageId'],
      },
    }, this._readPage);

    this.registerTool('notion:create_page', {
      name: 'notion:create_page',
      description: 'Create a new Notion page.',
      parameters: {
        type: 'object',
        properties: {
          parentId: { type: 'string', description: 'Parent page ID or database ID' },
          parentType: { type: 'string', description: '"page" or "database" (default: "page")' },
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page content as plain text (converted to paragraph blocks)' },
          properties: { type: 'object', description: 'Database properties (only for database parents)' },
        },
        required: ['parentId', 'title'],
      },
    }, this._createPage);

    this.registerTool('notion:update_page', {
      name: 'notion:update_page',
      description: 'Update properties of an existing Notion page.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Notion page ID' },
          properties: { type: 'object', description: 'Properties to update' },
          archived: { type: 'boolean', description: 'Set to true to archive/delete the page' },
        },
        required: ['pageId'],
      },
    }, this._updatePage);

    this.registerTool('notion:query_database', {
      name: 'notion:query_database',
      description: 'Query a Notion database with optional filters and sorts.',
      parameters: {
        type: 'object',
        properties: {
          databaseId: { type: 'string', description: 'Notion database ID' },
          filter: { type: 'object', description: 'Notion filter object (optional)' },
          sorts: { type: 'array', description: 'Array of sort objects (optional)' },
          maxResults: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['databaseId'],
      },
    }, this._queryDatabase);

    this.registerTool('notion:append_blocks', {
      name: 'notion:append_blocks',
      description: 'Append content blocks to an existing Notion page.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Notion page ID' },
          content: { type: 'string', description: 'Text content to append (each paragraph becomes a block)' },
        },
        required: ['pageId', 'content'],
      },
    }, this._appendBlocks);
  }

  // ── Auth ──────────────────────────────────────────────────────

  getAuthConfig() {
    return {
      type: 'api-key',
      provider: 'notion',
    };
  }

  getCredentials() { return this._credentials; }

  async authenticate(credentials, opts = {}) {
    const token = credentials.apiKey || credentials.access_token;
    if (!token) {
      throw new Error('Notion requires an API key (integration token)');
    }

    this._credentials = { access_token: token };

    // Verify the token works
    if (!opts.silent) {
      try {
        await this._apiGet('/users/me');
      } catch (err) {
        this._credentials = null;
        throw new Error(`Notion API key verification failed: ${err.message}`);
      }
    }

    this.status = 'connected';
  }

  async disconnect() {
    this._credentials = null;
    this.status = 'disconnected';
  }

  async destroy() {
    this._credentials = null;
    this.status = 'disconnected';
  }

  // ── Tool implementations ──────────────────────────────────────

  async _search({ query, filter, maxResults = 10 }) {
    const body = {
      query,
      page_size: maxResults,
      ...(filter ? { filter: { property: 'object', value: filter } } : {}),
    };
    const data = await this._apiPost('/search', body);
    return (data.results || []).map(_formatResult);
  }

  async _readPage({ pageId }) {
    const normalizedId = _normalizeId(pageId);

    // Get page metadata
    const page = await this._apiGet(`/pages/${normalizedId}`);
    const title = _extractTitle(page);

    // Get page content blocks
    const blocks = await this._apiGet(`/blocks/${normalizedId}/children?page_size=100`);
    const text = (blocks.results || []).map(_blockToText).filter(Boolean).join('\n');

    return { id: page.id, title, content: text, url: page.url };
  }

  async _createPage({ parentId, parentType = 'page', title, content, properties }) {
    const normalizedParent = _normalizeId(parentId);

    const parent = parentType === 'database'
      ? { database_id: normalizedParent }
      : { page_id: normalizedParent };

    const pageProps = properties || {};
    // Always set the title
    if (parentType === 'database') {
      // For database pages, title goes in the Name/title property
      if (!pageProps.Name && !pageProps.title) {
        pageProps.Name = { title: [{ text: { content: title } }] };
      }
    }

    const children = content
      ? content.split('\n').map((line) => ({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
        }))
      : [];

    const body = {
      parent,
      properties: parentType === 'database' ? pageProps : {
        title: { title: [{ text: { content: title } }] },
      },
      children,
    };

    const data = await this._apiPost('/pages', body);
    return { id: data.id, url: data.url, title };
  }

  async _updatePage({ pageId, properties, archived }) {
    const normalizedId = _normalizeId(pageId);
    const body = {};
    if (properties) body.properties = properties;
    if (archived !== undefined) body.archived = archived;

    const data = await this._apiRequest('PATCH', `/pages/${normalizedId}`, body);
    return { id: data.id, url: data.url, archived: data.archived };
  }

  async _queryDatabase({ databaseId, filter, sorts, maxResults = 20 }) {
    const normalizedId = _normalizeId(databaseId);
    const body = {
      page_size: maxResults,
      ...(filter ? { filter } : {}),
      ...(sorts ? { sorts } : {}),
    };

    const data = await this._apiPost(`/databases/${normalizedId}/query`, body);
    return (data.results || []).map(_formatResult);
  }

  async _appendBlocks({ pageId, content }) {
    const normalizedId = _normalizeId(pageId);
    const children = content.split('\n').map((line) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
    }));

    await this._apiRequest('PATCH', `/blocks/${normalizedId}/children`, { children });
    return { ok: true, blocksAdded: children.length };
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
      const fullUrl = new URL(`${NOTION_API_BASE}${path}`);
      const bodyStr = body ? JSON.stringify(body) : null;

      const options = {
        hostname: fullUrl.hostname,
        port: 443,
        path: fullUrl.pathname + fullUrl.search,
        method,
        headers: {
          Authorization: `Bearer ${this._credentials.access_token}`,
          'Notion-Version': NOTION_VERSION,
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
            reject(new Error('Notion API returned 401 — invalid or expired token'));
            return;
          }
          if (res.statusCode >= 400) {
            let detail = data;
            try { detail = JSON.stringify(JSON.parse(data)); } catch { /* use raw */ }
            reject(new Error(`Notion API ${method} ${path} returned ${res.statusCode}: ${detail}`));
            return;
          }
          if (!data) { resolve({}); return; }
          try { resolve(JSON.parse(data)); } catch (e) {
            reject(new Error(`Failed to parse Notion API response: ${data}`));
          }
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function _normalizeId(id) {
  // Remove dashes if present, then re-format as UUID
  return id.replace(/-/g, '');
}

function _extractTitle(page) {
  if (!page.properties) return 'Untitled';
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title' && prop.title?.length) {
      return prop.title.map((t) => t.plain_text).join('');
    }
  }
  return 'Untitled';
}

function _formatResult(item) {
  const base = {
    id: item.id,
    type: item.object, // 'page' or 'database'
    url: item.url,
    createdTime: item.created_time,
    lastEdited: item.last_edited_time,
  };

  if (item.object === 'page') {
    base.title = _extractTitle(item);
  } else if (item.object === 'database') {
    base.title = item.title?.map((t) => t.plain_text).join('') || 'Untitled';
  }

  return base;
}

function _blockToText(block) {
  const richText = block[block.type]?.rich_text;
  if (!richText) return '';

  const text = richText.map((t) => t.plain_text).join('');

  switch (block.type) {
    case 'heading_1': return `# ${text}`;
    case 'heading_2': return `## ${text}`;
    case 'heading_3': return `### ${text}`;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `1. ${text}`;
    case 'to_do': return `${block.to_do?.checked ? '[x]' : '[ ]'} ${text}`;
    case 'toggle': return `> ${text}`;
    case 'code': return `\`\`\`${block.code?.language || ''}\n${text}\n\`\`\``;
    case 'quote': return `> ${text}`;
    case 'divider': return '---';
    default: return text;
  }
}

module.exports = NotionRuntime;
