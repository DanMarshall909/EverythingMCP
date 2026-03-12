import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    EVERYTHING_AUTH: 'Basic ADD YOUR BASE64 ENCODED CREDENTIALS HERE',
    EVERYTHING_API_URL: 'http://localhost:9090'
  }
});

// Test 1: List tools
const listToolsRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {}
};

// Test 2: Search files
const searchRequest = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "search_files",
    arguments: {
      query: "hiberfil",
      count: 3
    }
  }
};

server.stdout.on('data', (data) => {
  console.log('Response:', data.toString());
});

server.stderr.on('data', (data) => {
  console.log('Debug:', data.toString());
});

// Send requests
server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
setTimeout(() => {
  server.stdin.write(JSON.stringify(searchRequest) + '\n');
}, 1000);

setTimeout(() => {
  server.kill();
}, 3000);