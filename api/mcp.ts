import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createScribeCatServer } from '../src/server.js';

// ScribeCat's Convex HTTP deployment URL — not a secret, just routing config
const CONVEX_SITE_URL =
  process.env.CONVEX_SITE_URL ?? 'https://spotted-vulture-584.convex.site';

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk as ArrayBuffer)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Extract API key from ?key= query param in the URL
  const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);
  const apiKey = url.searchParams.get('key');

  if (!apiKey?.startsWith('sc_')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid API key. Add ?key=sc_... to the URL.' }));
    return;
  }

  const body = await readBody(req);
  const server = createScribeCatServer(apiKey, CONVEX_SITE_URL);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } finally {
    await server.close();
  }
}
