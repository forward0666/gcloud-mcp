import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';

const PORT = process.env.PORT || 3100;
const MCP_SERVER = process.env.MCP_SERVER || 'gcloud';

// Available MCP servers
const SERVERS = {
  gcloud: {
    name: '@google-cloud/gcloud-mcp',
    desc: 'GCP via gcloud CLI (needs gcloud auth)',
  },
  storage: {
    name: '@google-cloud/storage-mcp',
    desc: 'GCS bucket/object management',
  },
  observability: {
    name: '@google-cloud/observability-mcp',
    desc: 'Logs, metrics, traces',
  },
  cloudrun: {
    name: '@google-cloud/cloud-run-mcp',
    desc: 'Cloud Run deployment',
  },
};

function resolveServer(key) {
  const server = SERVERS[key];
  if (!server) return null;
  // Try Docker path first, then local
  const paths = [
    `/app/node_modules/${server.name}/dist/bundle.js`,
    `/app/node_modules/${server.name}/dist/index.js`,
    `${process.cwd()}/node_modules/${server.name}/dist/bundle.js`,
    `${process.cwd()}/node_modules/${server.name}/dist/index.js`,
    `${process.cwd()}/node_modules/${server.name}/mcp-server.js`,
  ];
  for (const p of paths) {
    const found = existsSync(p);
    console.log(`[resolve] ${key}: ${p} -> ${found}`);
    if (found) return p;
  }
  console.log(`[resolve] ${key}: NOT FOUND in any path`);
  return null;
}

const app = createMcpExpressApp();
const sessions = {};

// Health / info endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    server: MCP_SERVER,
    sse: '/mcp',
    messages: '/messages?sessionId=<id>',
    available: Object.keys(SERVERS),
  });
});

// SSE endpoint
app.get('/mcp', async (req, res) => {
  const sessionId = randomUUID();
  console.log(`[${sessionId}] SSE connected (server=${MCP_SERVER})`);

  const serverPath = resolveServer(MCP_SERVER);
  if (!serverPath) {
    res.status(500).send(`Server '${MCP_SERVER}' not found`);
    return;
  }

  const transport = new SSEServerTransport('/messages', res);
  sessions[sessionId] = { transport, child: null };

  const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: `/opt/google-cloud-sdk/bin:${process.env.PATH}`,
    },
  });

  sessions[sessionId].child = child;

  child.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n').filter(l => l.trim())) {
      try {
        transport.send(JSON.parse(line));
      } catch {}
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`[${sessionId}] ${data.toString().trim()}`);
  });

  child.on('close', (code) => {
    console.log(`[${sessionId}] exited ${code}`);
    delete sessions[sessionId];
  });

  transport.onclose = () => {
    console.log(`[${sessionId}] SSE closed`);
    sessions[sessionId]?.child?.kill();
    delete sessions[sessionId];
  };

  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
});

// Messages endpoint
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const session = sessions[sessionId];
  if (!session) {
    res.status(404).send('Session not found');
    return;
  }
  session.child.stdin.write(JSON.stringify(req.body) + '\n');
  res.status(200).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 GCP MCP SSE wrapper on http://0.0.0.0:${PORT}`);
  console.log(`   Server: ${MCP_SERVER}`);
  console.log(`   SSE:    http://localhost:${PORT}/mcp`);
  console.log(`   Set MCP_SERVER env to switch: ${Object.keys(SERVERS).join(', ')}`);
});

process.on('SIGINT', () => {
  for (const sid in sessions) sessions[sid]?.child?.kill();
  process.exit(0);
});
