import type { IncomingMessage, ServerResponse } from 'node:http';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const host = req.headers.host ?? 'localhost';
  const base = `https://${host}`;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(
    JSON.stringify({
      issuer: base,
      token_endpoint: `${base}/api/token`,
      grant_types_supported: ['client_credentials'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      scopes_supported: ['read'],
    }),
  );
}
