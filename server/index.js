// server/index.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { verifyConnectivity, closeDriver } = require('./db');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (req, res) => {
  try {
    await verifyConnectivity();
    res.json({ status: 'ok', database: 'reachable' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'unreachable', message: err.message });
  }
});

app.use('/api', apiRouter);

// Fallback 404 for unknown API routes (keeps static file serving above intact).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

async function start() {
  try {
    await verifyConnectivity();
    console.log('[server] Connected to CognoDB.');
  } catch (err) {
    console.warn('[server] WARNING: could not verify CognoDB connectivity at startup.');
    console.warn(`[server] ${err.message}`);
    console.warn('[server] The server will still start; requests that hit the DB will return 503 until it is reachable.');
  }

  app.listen(PORT, () => {
    console.log(`[server] SkillPath listening on http://localhost:${PORT}`);
  });
}

process.on('SIGINT', async () => {
  console.log('\n[server] Shutting down...');
  await closeDriver();
  process.exit(0);
});

start();
