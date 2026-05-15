import type { IncomingMessage, ServerResponse } from 'node:http';

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk as ArrayBuffer)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseFields(raw: string, contentType: string): Record<string, string> {
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const raw = await readBody(req);
  const contentType = req.headers['content-type'] ?? '';
  const body = parseFields(raw, contentType);

  // Also support client_secret_basic (Authorization: Basic base64(id:secret))
  let clientSecret = body.client_secret;
  const authHeader = req.headers.authorization;
  if (!clientSecret && authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    clientSecret = decoded.split(':')[1] ?? '';
  }

  if (body.grant_type !== 'client_credentials') {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
    return;
  }

  if (!clientSecret?.startsWith('sc_')) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Client secret must be a valid ScribeCat API key (sc_...)' }));
    return;
  }

  // The API key IS the access token — no separate token store needed
  res.writeHead(200);
  res.end(
    JSON.stringify({
      access_token: clientSecret,
      token_type: 'Bearer',
      expires_in: 31536000, // 1 year
    }),
  );
}
