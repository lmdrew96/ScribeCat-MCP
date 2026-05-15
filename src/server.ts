import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

async function callApi(
  path: string,
  apiKey: string,
  apiBase: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${apiBase}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`ScribeCat API ${res.status}: ${await res.text()}`);
  return res.json() as unknown;
}

export function createScribeCatServer(apiKey: string, apiBase: string): Server {
  const server = new Server(
    { name: 'scribecat-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_sessions',
        description:
          "List the user's ScribeCat lecture sessions. Returns metadata. Optionally filter by course and limit count.",
        inputSchema: {
          type: 'object',
          properties: {
            course: { type: 'string', description: 'Filter by course (e.g. "CISC 220")' },
            limit: { type: 'number', description: 'Max sessions to return (default 50, max 100)' },
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
            id: { type: 'string', description: 'Session ID from list_sessions' },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_sessions',
        description:
          "Search the user's sessions by keyword. Searches in notes content and session titles. Optionally restrict to a course.",
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keyword or phrase to search for' },
            course: { type: 'string', description: 'Optionally restrict results to one course' },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_courses',
        description:
          "List all course names the user has tagged their sessions with. Useful for knowing what values to pass to list_sessions or search_sessions.",
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
          const q: Record<string, string> = {};
          if (params.course) q.course = String(params.course);
          if (params.limit) q.limit = String(params.limit);
          const data = await callApi('/mcp/sessions', apiKey, apiBase, q);
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'get_session': {
          if (!params.id) throw new Error('id is required');
          const data = await callApi('/mcp/session', apiKey, apiBase, { id: String(params.id) });
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'search_sessions': {
          if (!params.query) throw new Error('query is required');
          const q: Record<string, string> = { q: String(params.query) };
          if (params.course) q.course = String(params.course);
          const data = await callApi('/mcp/sessions/search', apiKey, apiBase, q);
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'list_courses': {
          const data = await callApi('/mcp/courses', apiKey, apiBase);
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

  return server;
}
