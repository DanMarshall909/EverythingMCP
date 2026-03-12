import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import koffi from 'koffi';

// --- Configuration ---
const EVERYTHING_API_URL = process.env.EVERYTHING_API_URL || 'http://localhost:9090';
const EVERYTHING_AUTH = process.env.EVERYTHING_AUTH || '';

// Dynamically determine architecture for the correct DLL
const is64Bit = process.arch === 'x64';
const DLL_NAME = is64Bit ? 'Everything64.dll' : 'Everything32.dll';

const DEFAULT_SDK_PATH = `C:\\Program Files\\Everything\\Everything-SDK\\dll\\${DLL_NAME}`;
const SDK_PATH = process.env.EVERYTHING_SDK_PATH;

let useHttp = false;
let lib: any;

// --- Concurrency Control ---
// Everything SDK uses global state. We must lock it to prevent race conditions 
// when multiple tool calls come in simultaneously.
class Mutex {
  private mutex = Promise.resolve();
  lock(): Promise<() => void> {
    let begin: (unlock: () => void) => void = () => {};
    this.mutex = this.mutex.then(() => new Promise(begin));
    return new Promise((res) => { begin = res; });
  }
}
const sdkMutex = new Mutex();

// Try to load SDK
try {
  try {
    lib = koffi.load(DLL_NAME);
    console.error(`[EverythingMCP] Loaded SDK (${DLL_NAME}) from PATH`);
  } catch (pathError) {
    const loadPath = SDK_PATH || DEFAULT_SDK_PATH;
    try {
      lib = koffi.load(loadPath);
      console.error(`[EverythingMCP] Loaded SDK from: ${loadPath}`);
    } catch (explicitError) {
      console.error(`[EverythingMCP] ERROR: Failed to load Everything SDK.`);
      console.error(`[EverythingMCP] Falling back to HTTP API at ${EVERYTHING_API_URL}`);
      useHttp = true;
    }
  }
} catch (error) {
  console.error(`[EverythingMCP] Unexpected error loading SDK, falling back to HTTP.`, error);
  useHttp = true;
}

// --- Everything SDK Constants & Functions ---
const EVERYTHING_REQUEST_FILE_NAME = 0x00000001;
const EVERYTHING_REQUEST_PATH = 0x00000002;
const EVERYTHING_REQUEST_SIZE = 0x00000010;
const EVERYTHING_REQUEST_DATE_CREATED = 0x00000020;
const EVERYTHING_REQUEST_DATE_MODIFIED = 0x00000040;
const EVERYTHING_REQUEST_DATE_ACCESSED = 0x00000080;
const EVERYTHING_REQUEST_ATTRIBUTES = 0x00000100;
const EVERYTHING_REQUEST_EXTENSION = 0x00000200;

const EVERYTHING_SORT_NAME_ASCENDING = 1;
const EVERYTHING_SORT_NAME_DESCENDING = 2;
const EVERYTHING_SORT_PATH_ASCENDING = 3;
const EVERYTHING_SORT_PATH_DESCENDING = 4;
const EVERYTHING_SORT_SIZE_ASCENDING = 5;
const EVERYTHING_SORT_SIZE_DESCENDING = 6;
const EVERYTHING_SORT_EXTENSION_ASCENDING = 7;
const EVERYTHING_SORT_EXTENSION_DESCENDING = 8;
const EVERYTHING_SORT_DATE_CREATED_ASCENDING = 11;
const EVERYTHING_SORT_DATE_CREATED_DESCENDING = 12;
const EVERYTHING_SORT_DATE_MODIFIED_ASCENDING = 13;
const EVERYTHING_SORT_DATE_MODIFIED_DESCENDING = 14;

let Everything_SetSearchW: any;
let Everything_SetRequestFlags: any;
let Everything_SetSort: any;
let Everything_SetOffset: any;
let Everything_SetMax: any;
let Everything_QueryW: any;
let Everything_GetNumResults: any;
let Everything_GetResultFullPathNameW: any;
let Everything_GetResultFileNameW: any;
let Everything_GetResultExtensionW: any;
let Everything_GetResultSize: any;
let Everything_GetResultDateCreated: any;
let Everything_GetResultDateModified: any;
let Everything_GetResultDateAccessed: any;
let Everything_GetResultAttributes: any;
let Everything_GetResultDateRun: any;
let Everything_GetResultRunCount: any;

if (!useHttp && lib) {
  // Use 'int' for Win32 BOOL compatibility
  Everything_SetSearchW = lib.func('void Everything_SetSearchW(const str16 lpString)');
  Everything_SetRequestFlags = lib.func('void Everything_SetRequestFlags(uint32_t dwRequestFlags)');
  Everything_SetSort = lib.func('void Everything_SetSort(uint32_t dwSort)');
  Everything_SetOffset = lib.func('void Everything_SetOffset(uint32_t dwOffset)');
  Everything_SetMax = lib.func('void Everything_SetMax(uint32_t dwMax)');
  Everything_QueryW = lib.func('int Everything_QueryW(int bWait)'); // Changed bool to int
  Everything_GetNumResults = lib.func('uint32_t Everything_GetNumResults(void)');
  
  // Returns number of characters copied
  Everything_GetResultFullPathNameW = lib.func('uint32_t Everything_GetResultFullPathNameW(uint32_t nIndex, char16_t *lpString, uint32_t nMaxCount)');
  
  Everything_GetResultFileNameW = lib.func('str16 Everything_GetResultFileNameW(uint32_t nIndex)');
  Everything_GetResultExtensionW = lib.func('const str16 Everything_GetResultExtensionW(uint32_t nIndex)');
  
  // Use int for the return BOOL and uint64_t* for the LARGE_INTEGER/FILETIME pointers
  Everything_GetResultSize = lib.func('int Everything_GetResultSize(uint32_t nIndex, uint64_t *lpSize)');
  Everything_GetResultDateCreated = lib.func('int Everything_GetResultDateCreated(uint32_t nIndex, uint64_t *lpFileTime)');
  Everything_GetResultDateModified = lib.func('int Everything_GetResultDateModified(uint32_t nIndex, uint64_t *lpFileTime)');
  Everything_GetResultDateAccessed = lib.func('int Everything_GetResultDateAccessed(uint32_t nIndex, uint64_t *lpFileTime)');
  Everything_GetResultDateRun = lib.func('int Everything_GetResultDateRun(uint32_t nIndex, uint64_t *lpFileTime)');
  
  Everything_GetResultAttributes = lib.func('uint32_t Everything_GetResultAttributes(uint32_t nIndex)');
  Everything_GetResultRunCount = lib.func('uint32_t Everything_GetResultRunCount(uint32_t nIndex)');
}

// --- Types and Interfaces ---
interface SearchFilesArgs {
  query: string;
  count?: number;
  offset?: number;
  sort?: string;
  ascending?: boolean;
  case?: boolean;
  wholeword?: boolean;
  path_search?: boolean;
  regex?: boolean;
  diacritics?: boolean;
  path?: string;
}

interface SearchResult {
  name?: string;
  path?: string;
  full_path?: string;
  type?: 'file' | 'folder' | string;
  extension?: string;
  size?: number | string;
  size_formatted?: string;
  date_created?: string;
  date_modified?: string;
  date_accessed?: string;
  attributes?: number | string;
}

interface EverythingResponse {
  totalResults: number;
  results: any[];
  request_id?: number;
  sort?: string;
  ascending?: boolean;
  offset?: number;
  max?: number;
  query?: string;
}

// --- Helper Functions ---
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const filetimeToIso = (filetime: bigint | number | string | undefined): string | undefined => {
  if (!filetime) return undefined;
  if (typeof filetime === 'string' || typeof filetime === 'number') {
    const filetimeNum = typeof filetime === 'string' ? parseInt(filetime) : filetime;
    const unixEpochFiletime = 116444736000000000;
    return new Date((filetimeNum - unixEpochFiletime) / 10000).toISOString();
  }
  const filetimeNum = typeof filetime === 'bigint' ? filetime : BigInt(filetime);
  if (filetimeNum === 0n) return undefined;
  const unixEpochFiletimeBig = 116444736000000000n;
  return new Date(Number((filetimeNum - unixEpochFiletimeBig) / 10000n)).toISOString();
};

function getSortType(sort: string, ascending: boolean): number {
  switch (sort) {
    case 'path': return ascending ? EVERYTHING_SORT_PATH_ASCENDING : EVERYTHING_SORT_PATH_DESCENDING;
    case 'size': return ascending ? EVERYTHING_SORT_SIZE_ASCENDING : EVERYTHING_SORT_SIZE_DESCENDING;
    case 'extension': return ascending ? EVERYTHING_SORT_EXTENSION_ASCENDING : EVERYTHING_SORT_EXTENSION_DESCENDING;
    case 'date_created': return ascending ? EVERYTHING_SORT_DATE_CREATED_ASCENDING : EVERYTHING_SORT_DATE_CREATED_DESCENDING;
    case 'date_modified': return ascending ? EVERYTHING_SORT_DATE_MODIFIED_ASCENDING : EVERYTHING_SORT_DATE_MODIFIED_DESCENDING;
    case 'name':
    default: return ascending ? EVERYTHING_SORT_NAME_ASCENDING : EVERYTHING_SORT_NAME_DESCENDING;
  }
}

function buildSearchQuery(query: string, options: any): string {
  let fullQuery = query;
  if (options.path) fullQuery = `"${options.path}\\" ${fullQuery}`;
  if (options.caseSensitive) fullQuery = 'case:' + fullQuery;
  if (options.wholeWord) fullQuery = 'wholeword:' + fullQuery;
  if (options.pathSearch) fullQuery = 'path:' + fullQuery;
  if (options.regex) fullQuery = 'regex:' + fullQuery;
  if (options.diacritics) fullQuery = 'diacritics:' + fullQuery;
  return fullQuery;
}

function processSdkSearchResults(numResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // OPTIMIZATION: Allocate buffers ONCE outside the loop
  const pathBuf = Buffer.alloc(65536); // 32768 WCHARs
  const sizePtr = Buffer.alloc(8);
  const createdPtr = Buffer.alloc(8);
  const modifiedPtr = Buffer.alloc(8);
  const accessedPtr = Buffer.alloc(8);

  for (let i = 0; i < numResults; i++) {
    Everything_GetResultFullPathNameW(i, pathBuf as any, 32768);
    const fullPath = (() => {
      const str = (pathBuf as any).toString('utf16le');
      const nullIndex = str.indexOf('\0');
      return nullIndex === -1 ? str : str.substring(0, nullIndex);
    })();

    const fileName = Everything_GetResultFileNameW(i);
    const extension = Everything_GetResultExtensionW(i);

    const sizeSuccess = Everything_GetResultSize(i, sizePtr as any);
    const size = sizeSuccess ? sizePtr.readBigUInt64LE() : 0n;

    const createdSuccess = Everything_GetResultDateCreated(i, createdPtr as any);
    const dateCreated = createdSuccess ? createdPtr.readBigUInt64LE() : 0n;

    const modifiedSuccess = Everything_GetResultDateModified(i, modifiedPtr as any);
    const dateModified = modifiedSuccess ? modifiedPtr.readBigUInt64LE() : 0n;

    const accessedSuccess = Everything_GetResultDateAccessed(i, accessedPtr as any);
    const dateAccessed = accessedSuccess ? accessedPtr.readBigUInt64LE() : 0n;

    const attributes = Everything_GetResultAttributes(i);
    const type = extension ? 'file' : 'folder';

    results.push({
      name: fileName,
      path: fullPath,
      full_path: fullPath && fileName ? `${fullPath}\\${fileName}` : fullPath,
      type: type,
      extension: extension || undefined,
      size: Number(size),
      size_formatted: formatBytes(Number(size)),
      date_created: filetimeToIso(dateCreated),
      date_modified: filetimeToIso(dateModified),
      date_accessed: filetimeToIso(dateAccessed),
      attributes: attributes
    });
  }

  return results;
}

async function handleSearchFilesSdk(args: SearchFilesArgs) {
  const query = args.query.slice(0, 2000);
  if (!query) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query is required' }) }] };
  }
  
  const count = Math.min(Math.max(1, Math.floor(args.count || 100)), 1000);
  const offset = Math.min(Math.max(0, Math.floor(args.offset || 0)), 1_000_000);
  
  const fullQuery = buildSearchQuery(query, {
    caseSensitive: args.case === true,
    wholeWord: args.wholeword === true,
    pathSearch: args.path_search === true,
    regex: args.regex === true,
    diacritics: args.diacritics === true,
    path: args.path
  });

  const sortType = getSortType(args.sort || 'name', args.ascending !== false);
  const flags = EVERYTHING_REQUEST_FILE_NAME | EVERYTHING_REQUEST_PATH |
                EVERYTHING_REQUEST_SIZE | EVERYTHING_REQUEST_DATE_MODIFIED |
                EVERYTHING_REQUEST_DATE_CREATED | EVERYTHING_REQUEST_DATE_ACCESSED |
                EVERYTHING_REQUEST_ATTRIBUTES | EVERYTHING_REQUEST_EXTENSION;

  // ACQUIRE MUTEX LOCK: Ensures only one request interacts with Everything's global state at a time
  const unlock = await sdkMutex.lock();

  try {
    Everything_SetSearchW(fullQuery);
    Everything_SetRequestFlags(flags);
    Everything_SetSort(sortType);
    Everything_SetMax(count);
    Everything_SetOffset(offset);

    // Use Koffi's .async to prevent blocking the Node.js event loop during the query
    // Note: Everything_QueryW expects an int (0 or 1), not a boolean
    await new Promise<void>((resolve, reject) => {
      Everything_QueryW.async(1, (err: any, success: boolean) => {
        if (err) reject(err);
        else if (!success) reject(new Error('Everything query failed'));
        else resolve();
      });
    });

    const numResults = Everything_GetNumResults();
    const results = processSdkSearchResults(numResults);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalResults: numResults,
          resultsReturned: results.length,
          results
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)
      }]
    };
  } finally {
    unlock();
  }
}

async function handleSearchFilesHttp(args: any) {
  try {
    const params = new URLSearchParams({
      search: args.query,
      j: '1',
      sort: args.sort || 'name',
      ascending: String(args.ascending !== false ? 1 : 0),
      offset: String(args.offset || 0),
      count: String(args.count || 100),
      case: String(args.case ? 1 : 0),
      wholeword: String(args.wholeword ? 1 : 0),
      path: String(args.path_search ? 1 : 0),
      regex: String(args.regex ? 1 : 0),
      diacritics: String(args.diacritics ? 1 : 0),
      path_column: '1',
      name_column: '1',
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
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const response = await axios.get<EverythingResponse>(url, { headers });

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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
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
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: `HTTP Error: ${error instanceof Error ? error.message : String(error)}` }, null, 2)
        }
      ],
      isError: true
    };
  }
}

// --- MCP Server Setup ---
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
  if (request.params.name === 'search_files') {
    const args = (request.params.arguments ?? {}) as unknown as SearchFilesArgs;

    if (useHttp) {
      return await handleSearchFilesHttp(args);
    } else {
      return await handleSearchFilesSdk(args);
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: 'Unknown tool' }, null, 2)
      }
    ],
    isError: true // Good practice to flag unknown tools as errors
  };
});

const transport = new StdioServerTransport();
server.connect(transport);

console.error(`Everything MCP server started (${useHttp ? 'HTTP' : 'SDK'} mode)`);