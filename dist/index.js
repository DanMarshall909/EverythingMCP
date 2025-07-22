import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
const EVERYTHING_API_URL = process.env.EVERYTHING_API_URL || 'http://localhost:9090';
const EVERYTHING_AUTH = process.env.EVERYTHING_AUTH || '';
const server = new Server({
    name: 'everything-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'search_files',
                description: 'Search for files and folders using Everything',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query for Everything',
                        },
                        path: {
                            type: 'string',
                            description: 'Optional: Limit search to specific path',
                        },
                        count: {
                            type: 'number',
                            description: 'Maximum number of results (default: 100)',
                            default: 100,
                        },
                        offset: {
                            type: 'number',
                            description: 'Offset for pagination (default: 0)',
                            default: 0,
                        },
                        sort: {
                            type: 'string',
                            description: 'Sort order: name, path, size, date_modified',
                            enum: ['name', 'path', 'size', 'date_modified'],
                            default: 'name',
                        },
                    },
                    required: ['query'],
                },
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'search_files') {
        const args = request.params.arguments;
        try {
            const params = new URLSearchParams({
                s: args.query,
                j: '1', // JSON output
                c: String(args.count || 100),
                o: String(args.offset || 0),
                sort: args.sort || 'name',
            });
            if (args.path) {
                params.append('path', args.path);
            }
            const response = await axios.get(`${EVERYTHING_API_URL}/?${params.toString()}`, {
                headers: {
                    ...(EVERYTHING_AUTH ? { 'Authorization': EVERYTHING_AUTH } : {}),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                }
            });
            const results = response.data.results.map((result) => ({
                type: result.type,
                name: result.name,
                path: result.path,
                size: result.size,
                date_modified: result.date_modified
                    ? new Date(result.date_modified * 1000).toISOString()
                    : undefined,
            }));
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            totalResults: response.data.totalResults,
                            resultsReturned: results.length,
                            results,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error searching Everything: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
    throw new Error(`Unknown tool: ${request.params.name}`);
});
const transport = new StdioServerTransport();
server.connect(transport);
console.error('Everything MCP server started');
//# sourceMappingURL=index.js.map