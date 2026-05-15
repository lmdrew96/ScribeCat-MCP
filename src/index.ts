#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_KEY = process.env.SCRIBECAT_API_KEY;
const API_URL = process.env.SCRIBECAT_API_URL;

if (!API_KEY || !API_URL) {
  console.error(
    'Missing required env vars: SCRIBECAT_API_KEY and SCRIBECAT_API_URL\n' +
      'Example: SCRIBECAT_API_URL=https://<your-deployment>.convex.site',
  );
  process.exit(1);
}

async function callApi(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${API_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ScribeCat API error ${response.status}: ${body}`);
  }

  return response.json() as unknown;
}

const server = new Server(
  { name: 'scribecat-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_sessions',
      description:
        "List the user's ScribeCat lecture sessions. Returns metadata for each session. Optionally filter by course name and limit the count.",
      inputSchema: {
        type: 'object',
        properties: {
          course: {
            type: 'string',
            description: 'Filter by course name (e.g. "CISC 220")',
          },
          limit: {
            type: 'number',
            description: 'Max sessions to return (default 50, max 100)',
          },
        },
      },
    },
    {
      name: 'get_session',
      description:
        "Get the full content of a ScribeCat session including its transcript and notes. Use list_sessions first to find the session's ID.",
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The session ID returned by list_sessions',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'search_sessions',
      description:
        "Search the user's ScribeCat sessions by keyword. Searches in notes content and session titles. Optionally filter to a specific course.",
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword or phrase to search for',
          },
          course: {
            type: 'string',
            description: 'Optionally restrict results to a specific course',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'list_courses',
      description:
        "List all course names the user has tagged their ScribeCat sessions with. Useful for knowing what filter values to pass to list_sessions or search_sessions.",
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case 'list_sessions': {
        const queryParams: Record<string, string> = {};
        if (params.course) queryParams.course = String(params.course);
        if (params.limit) queryParams.limit = String(params.limit);
        const data = await callApi('/mcp/sessions', queryParams);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'get_session': {
        if (!params.id) throw new Error('id is required');
        const data = await callApi('/mcp/session', { id: String(params.id) });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'search_sessions': {
        if (!params.query) throw new Error('query is required');
        const queryParams: Record<string, string> = { q: String(params.query) };
        if (params.course) queryParams.course = String(params.course);
        const data = await callApi('/mcp/sessions/search', queryParams);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_courses': {
        const data = await callApi('/mcp/courses');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
