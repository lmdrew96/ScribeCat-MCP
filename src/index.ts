#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createScribeCatServer } from './server.js';

const SCRIBECAT_URL = process.env.SCRIBECAT_URL;

if (!SCRIBECAT_URL) {
  console.error(
    'Missing required env var: SCRIBECAT_URL\n' +
      'Format: https://<deployment>.convex.site?key=sc_...',
  );
  process.exit(1);
}

const _parsed = new URL(SCRIBECAT_URL);
const API_KEY = _parsed.searchParams.get('key');
if (!API_KEY) {
  console.error('SCRIBECAT_URL must include ?key=<api-key>');
  process.exit(1);
}
_parsed.searchParams.delete('key');
const API_URL = _parsed.toString().replace(/\/$/, '');

const server = createScribeCatServer(API_KEY, API_URL);
const transport = new StdioServerTransport();
await server.connect(transport);
