# Everything MCP Server

An MCP server for [Everything by VoidTools](https://www.voidtools.com/) that provides Claude Desktop with lightning-fast filesystem search on Windows. This implementation uses native C bindings via the Everything SDK for maximum performance, with a transparent fallback to the HTTP API.

## Features

* **Blazing Fast**: Leverages the native `Everything64.dll` for near-instant results.
* **Architecture Aware**: Automatically detects and loads the correct DLL (32-bit or 64-bit) based on your Node.js runtime.
* **Thread Safe**: Implements an internal Mutex to prevent race conditions during concurrent tool calls.
* **Non-Blocking**: Uses asynchronous worker threads for SDK queries to keep the MCP connection responsive.
* **Smart Fallback**: Automatically switches to the Everything HTTP Server if the SDK is unavailable.

## Prerequisites

* **Windows OS**: Required for native SDK functionality.
* **Everything Search**: Must be installed and running.
* **Everything SDK**: [Download here](https://www.voidtools.com/support/everything/sdk/). Ensure the DLLs are in your system PATH or configured via environment variables.
* **Node.js**: Version 18 or higher.

## Installation

1. **Clone and Install**:
```bash
npm install

```


2. **Build the Project**:
```bash
npm run build

```


3. **Configure Claude Desktop**:
Add the following to your `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "everything": {
      "command": "node",
      "args": ["C:\\path\\to\\everything-mcp\\dist\\index.js"],
      "env": {
        "EVERYTHING_SDK_PATH": "C:\\path\\to\\Everything64.dll"
      }
    }
  }
}

```



## Tool: `search_files`

Search for files and folders across your entire system with advanced filtering.

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `query` | string | *(required)* | Search terms (supports Everything search syntax). |
| `count` | number | 100 | Maximum number of results to return (1–1000). |
| `offset` | number | 0 | Pagination offset for large result sets. |
| `sort` | string | `"name"` | `name`, `path`, `size`, `date_created`, `date_modified`, `extension`. |
| `ascending` | boolean | `true` | Set to `false` for descending order. |
| `path` | string | - | Scope search to a specific directory. |
| `regex` | boolean | `false` | Enable regular expression matching. |
| `case` | boolean | `false` | Enable case-sensitive matching. |

## Development & Testing

The project includes a robust test suite to simulate MCP JSON-RPC communication:

```bash
# Run the universal test script
node test-mcp.js

```
