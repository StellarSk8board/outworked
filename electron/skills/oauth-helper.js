// ─── OAuth2 Helper ───────────────────────────────────────────────
// Shared OAuth2 flow that opens the consent page in the user's default
// browser and captures the redirect code via a temporary local HTTP server.
// Uses PKCE (code_challenge / code_verifier) for security.
// No external npm dependencies — only built-in modules.

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { shell } = require('electron');

// ── PKCE helpers ────────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ── HTTP helper ─────────────────────────────────────────────────

function httpsPost(urlStr, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const parsed = new URL(urlStr);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Token endpoint returned ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── OAuth2 flow ─────────────────────────────────────────────────

/**
 * Open the OAuth2 consent page in the system browser and capture the
 * authorization code via a temporary local HTTP server on a random port.
 *
 * @param {object} config
 * @param {string} config.authUrl        Authorization endpoint URL
 * @param {string} config.tokenUrl       Token endpoint URL
 * @param {string} config.clientId       OAuth2 client ID
 * @param {string} [config.clientSecret] OAuth2 client secret
 * @param {string} [config.redirectUri]  Ignored — we use our local server
 * @param {string[]} config.scopes       Requested scopes
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number }>}
 */
async function performOAuth2Flow(config) {
  const { authUrl, tokenUrl, clientId, clientSecret, scopes } = config;

  // Generate PKCE pair
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');

  // Start a temporary local HTTP server on a random port to receive the redirect
  const { server, port, codePromise } = await startCallbackServer(state);

  const redirectUri = `http://127.0.0.1:${port}`;

  // Build authorization URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  const fullAuthUrl = `${authUrl}?${params.toString()}`;

  // Open in the user's default browser
  shell.openExternal(fullAuthUrl);

  try {
    // Wait for the user to complete the flow (timeout: 5 minutes)
    const code = await Promise.race([
      codePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OAuth timed out — no response within 5 minutes')), 300000)
      ),
    ]);

    // Exchange code for tokens
    const tokenParams = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    };
    if (clientSecret) {
      tokenParams.client_secret = clientSecret;
    }

    return await httpsPost(tokenUrl, tokenParams);
  } finally {
    server.close();
  }
}

/**
 * Start a temporary HTTP server that listens for the OAuth redirect.
 * Returns the server, port, and a promise that resolves with the auth code.
 */
function startCallbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    let resolveCode, rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const returnedState = url.searchParams.get('state');

      if (error) {
        const desc = url.searchParams.get('error_description') || error;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(successPage(false, `Authentication failed: ${desc}`));
        rejectCode(new Error(`OAuth error: ${desc}`));
        return;
      }

      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(successPage(false, 'No authorization code received.'));
        return;
      }

      if (returnedState !== expectedState) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(successPage(false, 'State mismatch — please try again.'));
        rejectCode(new Error('OAuth state mismatch'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(successPage(true, 'You can close this tab and return to Outworked.'));
      resolveCode(code);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, codePromise });
    });

    server.on('error', reject);
  });
}

function successPage(ok, message) {
  const color = ok ? '#22c55e' : '#ef4444';
  const icon = ok ? '&#10003;' : '&#10007;';
  const title = ok ? 'Connected!' : 'Error';
  return `<!DOCTYPE html>
<html><head><title>Outworked — ${title}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0f0f23; color: #e0e0e0;
    display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; padding: 40px; }
  .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
  h1 { font-size: 20px; color: ${color}; margin: 0 0 8px; }
  p { font-size: 14px; color: #9ca3af; margin: 0; }
</style></head><body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div>
</body></html>`;
}

/**
 * Refresh an OAuth2 access token using a refresh token.
 */
async function refreshOAuth2Token(config, refreshToken) {
  const { tokenUrl, clientId, clientSecret } = config;
  const params = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  };
  if (clientSecret) {
    params.client_secret = clientSecret;
  }
  return httpsPost(tokenUrl, params);
}

module.exports = { performOAuth2Flow, refreshOAuth2Token };
