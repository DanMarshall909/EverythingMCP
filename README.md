# Everything MCP Server

A quick MCP server for Everything by VoidTools that allows Claude Desktop to search your filesystem.

## Prerequisites

- Everything by VoidTools running on `localhost:9090` with HTTP server enabled
- Node.js installed

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build the TypeScript code:
```bash
npm run build
```

3. Add to Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "everything": {
      "command": "node",
      "args": ["C:\\path\\to\\EverythingMCP\\dist\\index.js"],
      "env": {
        "EVERYTHING_AUTH": "Basic YOUR_BASE64_ENCODED_CREDENTIALS",
        "EVERYTHING_API_URL": "http://localhost:9090"
      }
    }
  }
}
```

Note: 
- If Everything requires authentication, set the `EVERYTHING_AUTH` environment variable to your Basic auth header value.
- If running from WSL, you may need to set `EVERYTHING_API_URL` to `http://10.255.255.254:9090` (or your Windows host IP).

## Usage

Once configured, Claude can use the `search_files` tool to search your filesystem:

- `query`: Search query (required)
- `path`: Limit search to specific path (optional)
- `count`: Maximum results (default: 100)
- `offset`: For pagination (default: 0)
- `sort`: Sort by name, path, size, or date_modified

## Development

Run in development mode:
```bash
npm run dev
```