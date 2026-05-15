import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createScribeCatServer } from './server.js';

interface Env {
  CONVEX_SITE_URL: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Authorization',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// Stateless auth code: base64url({ k: apiKey, c: codeChallenge })
function encodeAuthCode(apiKey: string, codeChallenge: string): string {
  const payload = JSON.stringify({ k: apiKey, c: codeChallenge });
  return btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeAuthCode(code: string): { k: string; c: string } | null {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (padded.length % 4)) % 4;
    return JSON.parse(atob(padded + '='.repeat(pad)));
  } catch {
    return null;
  }
}

async function verifyPkce(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const base64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return base64url === codeChallenge;
}

async function handleOAuthMetadata(request: Request): Promise<Response> {
  const { protocol, host } = new URL(request.url);
  const base = `${protocol}//${host}`;
  return jsonResponse({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read'],
  });
}

async function handleAuthorize(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const codeChallenge = url.searchParams.get('code_challenge') ?? '';
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? '';

    if (!redirectUri || !codeChallenge || codeChallengeMethod !== 'S256') {
      return htmlResponse('<h1>Bad Request</h1><p>Missing required OAuth parameters.</p>', 400);
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connect ScribeCat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1E1830;
      color: #F7F5FA;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .card {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 2rem;
      width: 100%;
      max-width: 420px;
    }
    .logo { font-size: 2rem; margin-bottom: 0.5rem; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 0.25rem; }
    p { color: #B0A8C4; font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.5; }
    label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: #DBD5E2; }
    input[type="text"] {
      width: 100%;
      padding: 0.65rem 0.9rem;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.08);
      color: #F7F5FA;
      font-size: 0.95rem;
      font-family: monospace;
      outline: none;
      margin-bottom: 1rem;
    }
    input[type="text"]:focus { border-color: #88739E; }
    button {
      width: 100%;
      padding: 0.75rem;
      border-radius: 8px;
      border: none;
      background: #88739E;
      color: #fff;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #9985b0; }
    .hint { font-size: 0.8rem; color: #8CBDB9; margin-top: 1rem; text-align: center; }
    .error { color: #f87171; font-size: 0.85rem; margin-bottom: 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🐱</div>
    <h1>Connect ScribeCat</h1>
    <p>Enter your ScribeCat API key to give this AI assistant access to your lecture sessions.</p>
    <form method="POST">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
      <label for="apiKey">API Key</label>
      <input type="text" id="apiKey" name="api_key" placeholder="sc_..." autocomplete="off" />
      <button type="submit">Connect</button>
    </form>
    <p class="hint">Find your API key in ScribeCat → Settings → API Keys</p>
  </div>
</body>
</html>`;

    return htmlResponse(html);
  }

  if (request.method === 'POST') {
    const formData = await request.formData();
    const apiKey = (formData.get('api_key') as string | null)?.trim() ?? '';
    const redirectUri = (formData.get('redirect_uri') as string | null) ?? '';
    const state = (formData.get('state') as string | null) ?? '';
    const codeChallenge = (formData.get('code_challenge') as string | null) ?? '';

    if (!apiKey.startsWith('sc_')) {
      const html = buildAuthorizeForm(redirectUri, state, codeChallenge, 'Invalid API key — must start with sc_');
      return htmlResponse(html, 400);
    }

    const code = encodeAuthCode(apiKey, codeChallenge);
    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);

    return Response.redirect(redirectUrl.toString(), 302);
  }

  return new Response('Method Not Allowed', { status: 405 });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildAuthorizeForm(redirectUri: string, state: string, codeChallenge: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connect ScribeCat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1E1830; color: #F7F5FA; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 2rem; width: 100%; max-width: 420px; }
    .logo { font-size: 2rem; margin-bottom: 0.5rem; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 0.25rem; }
    p { color: #B0A8C4; font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.5; }
    label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: #DBD5E2; }
    input[type="text"] { width: 100%; padding: 0.65rem 0.9rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: #F7F5FA; font-size: 0.95rem; font-family: monospace; outline: none; margin-bottom: 1rem; }
    input[type="text"]:focus { border-color: #88739E; }
    button { width: 100%; padding: 0.75rem; border-radius: 8px; border: none; background: #88739E; color: #fff; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { background: #9985b0; }
    .hint { font-size: 0.8rem; color: #8CBDB9; margin-top: 1rem; text-align: center; }
    .error { color: #f87171; font-size: 0.85rem; margin-bottom: 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🐱</div>
    <h1>Connect ScribeCat</h1>
    <p>Enter your ScribeCat API key to give this AI assistant access to your lecture sessions.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="POST">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
      <label for="apiKey">API Key</label>
      <input type="text" id="apiKey" name="api_key" placeholder="sc_..." autocomplete="off" />
      <button type="submit">Connect</button>
    </form>
    <p class="hint">Find your API key in ScribeCat → Settings → API Keys</p>
  </div>
</body>
</html>`;
}

async function handleToken(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  let body: Record<string, string> = {};

  if (contentType.includes('application/x-www-form-urlencoded')) {
    body = Object.fromEntries(new URLSearchParams(await request.text()));
  } else {
    body = (await request.json()) as Record<string, string>;
  }

  const grantType = body.grant_type;

  if (grantType === 'authorization_code') {
    const code = body.code;
    const codeVerifier = body.code_verifier;

    if (!code || !codeVerifier) {
      return jsonResponse({ error: 'invalid_request', error_description: 'Missing code or code_verifier' }, 400);
    }

    const decoded = decodeAuthCode(code);
    if (!decoded) {
      return jsonResponse({ error: 'invalid_grant', error_description: 'Invalid authorization code' }, 400);
    }

    const valid = await verifyPkce(codeVerifier, decoded.c);
    if (!valid) {
      return jsonResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }

    return jsonResponse({ access_token: decoded.k, token_type: 'Bearer', expires_in: 31536000 });
  }

  return jsonResponse({ error: 'unsupported_grant_type' }, 400);
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const apiKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : url.searchParams.get('key');

  if (!apiKey?.startsWith('sc_')) {
    return jsonResponse({ error: 'Missing or invalid API key' }, 401);
  }

  const convexUrl = env.CONVEX_SITE_URL ?? 'https://spotted-vulture-584.convex.site';
  const server = createScribeCatServer(apiKey, convexUrl);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  await server.connect(transport);
  const mcpResponse = await transport.handleRequest(request);

  const headers = new Headers(mcpResponse.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);

  return new Response(mcpResponse.body, { status: mcpResponse.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (pathname === '/.well-known/oauth-authorization-server') {
      return handleOAuthMetadata(request);
    }

    if (pathname === '/authorize') {
      return handleAuthorize(request);
    }

    if (pathname === '/token' && request.method === 'POST') {
      return handleToken(request);
    }

    if (pathname === '/mcp') {
      return handleMcp(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};
