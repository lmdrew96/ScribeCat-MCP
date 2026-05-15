#!/usr/bin/env node
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createScribeCatServer } from './server.js';

const CONVEX_SITE_URL =
  process.env.CONVEX_SITE_URL ?? 'https://spotted-vulture-584.convex.site';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — needed for browser-based MCP clients (claude.ai)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Authorization');
  next();
});
app.options('*', (_req, res) => { res.sendStatus(204); });

// ─── OAuth discovery ─────────────────────────────────────────────────────────

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: base,
    token_endpoint: `${base}/token`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    scopes_supported: ['read'],
  });
});

// ─── Token endpoint ───────────────────────────────────────────────────────────
// The user's ScribeCat API key (sc_...) is the client secret.
// We hand it back as the bearer token — no separate token store needed.

app.post('/token', (req, res) => {
  let clientSecret = req.body?.client_secret as string | undefined;

  // Also support client_secret_basic (Authorization: Basic base64(id:secret))
  const authHeader = req.headers.authorization;
  if (!clientSecret && authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    clientSecret = decoded.split(':')[1] ?? '';
  }

  if (req.body?.grant_type !== 'client_credentials') {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }

  if (!clientSecret?.startsWith('sc_')) {
    res.status(401).json({
      error: 'invalid_client',
      error_description: 'Client secret must be your ScribeCat API key (sc_...)',
    });
    return;
  }

  res.json({ access_token: clientSecret, token_type: 'Bearer', expires_in: 31536000 });
});

// ─── MCP endpoint ─────────────────────────────────────────────────────────────

app.all('/mcp', async (req, res) => {
  // Accept key via Bearer token (OAuth) or ?key= query param (direct)
  const authHeader = req.headers.authorization;
  const apiKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (req.query.key as string | undefined);

  if (!apiKey?.startsWith('sc_')) {
    res.status(401).json({ error: 'Missing or invalid API key' });
    return;
  }

  const server = createScribeCatServer(apiKey, CONVEX_SITE_URL);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body as unknown);
  } finally {
    await server.close();
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`ScribeCat MCP server on port ${PORT}`);
});
