import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const GCLOUD_BUNDLE = new URL('./packages/gcloud-mcp/dist/bundle.js', import.meta.url).pathname;
const PORT = process.env.PORT || 3100;

const app = createMcpExpressApp();
const sessions = {};

// SSE endpoint
app.get('/mcp', async (req, res) => {
  const sessionId = randomUUID();
  console.log(`[${sessionId}] SSE connected`);

  const transport = new SSEServerTransport('/messages', res);
  sessions[sessionId] = { transport, child: null };

  // Spawn gcloud MCP as child process
  const child = spawn('node', [GCLOUD_BUNDLE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${process.env.HOME}/Desktop/google-cloud-sdk/bin:${process.env.PATH}` },
  });

  sessions[sessionId].child = child;

  // Bridge: child stdout → SSE client
  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        transport.send(msg);
      } catch (e) {
        // not JSON, skip
      }
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`[${sessionId}] stderr: ${data.toString().trim()}`);
  });

  child.on('close', (code) => {
    console.log(`[${sessionId}] child exited with code ${code}`);
    delete sessions[sessionId];
  });

  transport.onclose = () => {
    console.log(`[${sessionId}] SSE closed`);
    sessions[sessionId]?.child?.kill();
    delete sessions[sessionId];
  };

  // Send initial endpoint event
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

  // Bridge: HTTP POST → child stdin
  const msg = JSON.stringify(req.body) + '\n';
  session.child.stdin.write(msg);
  res.status(200).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 gcloud MCP SSE wrapper on http://localhost:${PORT}`);
  console.log(`   SSE:     http://localhost:${PORT}/mcp`);
  console.log(`   Messages: http://localhost:${PORT}/messages?sessionId=<id>`);
});

process.on('SIGINT', () => {
  for (const sid in sessions) {
    sessions[sid]?.child?.kill();
  }
  process.exit(0);
});
