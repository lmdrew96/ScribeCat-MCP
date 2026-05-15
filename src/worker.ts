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

async function handleOAuthMetadata(request: Request): Promise<Response> {
  const { protocol, host } = new URL(request.url);
  const base = `${protocol}//${host}`;
  return jsonResponse({
    issuer: base,
    token_endpoint: `${base}/token`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    scopes_supported: ['read'],
  });
}

async function handleToken(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  let body: Record<string, string> = {};

  if (contentType.includes('application/x-www-form-urlencoded')) {
    body = Object.fromEntries(new URLSearchParams(await request.text()));
  } else {
    body = (await request.json()) as Record<string, string>;
  }

  // Support client_secret_basic (Authorization: Basic base64(id:secret))
  let clientSecret = body.client_secret;
  const authHeader = request.headers.get('authorization');
  if (!clientSecret && authHeader?.startsWith('Basic ')) {
    const decoded = atob(authHeader.slice(6));
    clientSecret = decoded.split(':')[1] ?? '';
  }

  if (body.grant_type !== 'client_credentials') {
    return jsonResponse({ error: 'unsupported_grant_type' }, 400);
  }

  if (!clientSecret?.startsWith('sc_')) {
    return jsonResponse(
      {
        error: 'invalid_client',
        error_description: 'Client secret must be your ScribeCat API key (sc_...)',
      },
      401,
    );
  }

  return jsonResponse({ access_token: clientSecret, token_type: 'Bearer', expires_in: 31536000 });
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

  // Merge CORS headers into the MCP response
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

    if (pathname === '/token' && request.method === 'POST') {
      return handleToken(request);
    }

    if (pathname === '/mcp') {
      return handleMcp(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};
