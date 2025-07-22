import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const EVERYTHING_API_URL = process.env.EVERYTHING_API_URL || 'http://localhost:9090';
const EVERYTHING_AUTH = process.env.EVERYTHING_AUTH || '';

// Helper function to format file sizes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

interface EverythingSearchResult {
  type?: string;
  name?: string;
  path?: string;
  full_path_and_name?: string;
  extension?: string;
  size?: number | string;
  date_created?: number | string;
  date_modified?: number | string;
  date_accessed?: number | string;
  attributes?: number | string;
  file_list_file_name?: string;
  run_count?: number;
  date_run?: number | string;
  date_recently_changed?: number | string;
  highlighted_file_name?: string;
  highlighted_path?: string;
  highlighted_full_path_and_file_name?: string;
}

interface EverythingResponse {
  totalResults: number;
  results: EverythingSearchResult[];
  request_id?: number;
  sort?: string;
  ascending?: boolean;
  offset?: number;
  max?: number;
  query?: string;
}

const server = new Server(
  {
    name: 'everything-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

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
              description: 'Sort order: name, path, size, extension, type, date_created, date_modified, date_accessed, attributes, file_list_filename, run_count, date_run, date_recently_changed',
              enum: ['name', 'path', 'size', 'extension', 'type', 'date_created', 'date_modified', 'date_accessed', 'attributes', 'file_list_filename', 'run_count', 'date_run', 'date_recently_changed'],
              default: 'name',
            },
            ascending: {
              type: 'boolean',
              description: 'Sort order ascending (true) or descending (false)',
              default: true,
            },
            case: {
              type: 'boolean',
              description: 'Match case',
              default: false,
            },
            wholeword: {
              type: 'boolean',
              description: 'Match whole word',
              default: false,
            },
            path_search: {
              type: 'boolean',
              description: 'Search in path',
              default: false,
            },
            regex: {
              type: 'boolean',
              description: 'Use regex',
              default: false,
            },
            diacritics: {
              type: 'boolean',
              description: 'Match diacritics',
              default: false,
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error(`[MCP] Received request:`, JSON.stringify(request, null, 2));
  
  if (request.params.name === 'search_files') {
    const args = request.params.arguments as any;
    
    console.error(`[DEBUG] Received search request with args:`, JSON.stringify(args, null, 2));
    
    try {
      const params = new URLSearchParams({
        search: args.query,
        j: '1', // JSON output
        sort: args.sort || 'name',
        ascending: String(args.ascending !== false ? 1 : 0),
        offset: String(args.offset || 0),
        count: String(args.count || 100),
        // Search options
        case: String(args.case ? 1 : 0),
        wholeword: String(args.wholeword ? 1 : 0),
        path: String(args.path_search ? 1 : 0),
        regex: String(args.regex ? 1 : 0),
        diacritics: String(args.diacritics ? 1 : 0),
        // Request ALL available columns
        path_column: '1',
        size_column: '1',
        extension_column: '1',
        type_column: '1',
        date_created_column: '1',
        date_modified_column: '1',
        date_accessed_column: '1',
        attributes_column: '1',
        file_list_file_name_column: '1',
        run_count_column: '1',
        date_run_column: '1',
        date_recently_changed_column: '1',
        highlighted_file_name_column: '1',
        highlighted_path_column: '1',
        highlighted_full_path_and_file_name_column: '1',
      });

      if (args.path) {
        params.append('path', args.path);
      }

      const url = `${EVERYTHING_API_URL}/?${params.toString()}`;
      const headers = {
        ...(EVERYTHING_AUTH ? { 'Authorization': EVERYTHING_AUTH } : {}),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      };

      console.error(`[DEBUG] Making request to: ${url}`);
      console.error(`[DEBUG] Headers:`, JSON.stringify(headers, null, 2));

      const response = await axios.get<EverythingResponse>(url, { headers });

      console.error(`[DEBUG] Response status: ${response.status}`);
      console.error(`[DEBUG] Response data type: ${typeof response.data}`);
      console.error(`[DEBUG] Response data:`, JSON.stringify(response.data, null, 2));

      // Helper function to convert Windows FILETIME to ISO string
      const filetimeToIso = (filetime: string | number | undefined): string | undefined => {
        if (!filetime) return undefined;
        const filetimeNum = typeof filetime === 'string' ? parseInt(filetime) : filetime;
        // FILETIME is 100-nanosecond intervals since January 1, 1601
        const unixEpochFiletime = 116444736000000000; // Unix epoch in FILETIME
        const unixTimestamp = (filetimeNum - unixEpochFiletime) / 10000; // Convert to milliseconds
        return new Date(unixTimestamp).toISOString();
      };

      const results = response.data.results.map((result) => {
        const sizeNum = result.size ? (typeof result.size === 'string' ? parseInt(result.size) : result.size) : undefined;
        
        return {
          type: result.type,
          name: result.name,
          path: result.path,
          full_path: result.path && result.name ? `${result.path}\\${result.name}` : result.full_path_and_name || result.name,
          extension: result.extension,
          size: sizeNum,
          size_formatted: sizeNum ? formatBytes(sizeNum) : undefined,
          date_created: filetimeToIso(result.date_created),
          date_modified: filetimeToIso(result.date_modified),
          date_accessed: filetimeToIso(result.date_accessed),
          date_run: filetimeToIso(result.date_run),
          date_recently_changed: filetimeToIso(result.date_recently_changed),
          attributes: result.attributes,
          file_list_file_name: result.file_list_file_name,
          run_count: result.run_count,
          highlighted_file_name: result.highlighted_file_name,
          highlighted_path: result.highlighted_path,
          highlighted_full_path_and_file_name: result.highlighted_full_path_and_file_name,
        };
      });

      const responsePayload = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                totalResults: response.data.totalResults,
                resultsReturned: results.length,
                requestInfo: {
                  request_id: response.data.request_id,
                  query: response.data.query,
                  sort: response.data.sort,
                  ascending: response.data.ascending,
                  offset: response.data.offset,
                  max: response.data.max,
                },
                results,
              },
              null,
              2
            ),
          },
        ],
      };

      console.error(`[MCP] Sending response:`, JSON.stringify(responsePayload, null, 2));
      return responsePayload;
    } catch (error) {
      console.error(`[DEBUG] Error occurred:`, error);
      if (error instanceof Error) {
        console.error(`[DEBUG] Error message: ${error.message}`);
        console.error(`[DEBUG] Error stack: ${error.stack}`);
      }
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
console.error(`[DEBUG] EVERYTHING_API_URL: ${EVERYTHING_API_URL}`);
console.error(`[DEBUG] EVERYTHING_AUTH: ${EVERYTHING_AUTH ? '[SET]' : '[NOT SET]'}`);