// server/db.js
// Wraps the official Neo4j driver, pointed at a CognoDB Cloud instance.
// CognoDB speaks openCypher over Bolt 5.x, so the stock neo4j-driver just works.

const neo4j = require('neo4j-driver');

let driver = null;

function getDriver() {
  if (driver) return driver;

  const uri = process.env.COGNODB_URI;
  const user = process.env.COGNODB_USER;
  const password = process.env.COGNODB_PASSWORD;

  if (!uri || !user || !password) {
    throw new Error(
      'Missing CognoDB connection settings. Set COGNODB_URI, COGNODB_USER and ' +
      'COGNODB_PASSWORD in your .env file (see .env.example).'
    );
  }

  driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    maxConnectionPoolSize: 20,
    connectionAcquisitionTimeout: 10000,
  });

  return driver;
}

// Verifies connectivity once at startup so we fail fast with a clear message
// instead of surfacing a cryptic error on the first user request.
async function verifyConnectivity() {
  const d = getDriver();
  await d.verifyConnectivity();
}

// Runs a single Cypher statement inside a managed session and always closes
// the session, even if the query throws.
async function runQuery(cypher, params = {}, { write = false } = {}) {
  const d = getDriver();
  const session = d.session({
    defaultAccessMode: write ? neo4j.session.WRITE : neo4j.session.READ,
  });
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}

// Runs multiple statements in a single write transaction (used by the seed
// script so a failure partway through doesn't leave a half-loaded graph).
async function runWriteTransaction(work) {
  const d = getDriver();
  const session = d.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    return await session.executeWrite(work);
  } finally {
    await session.close();
  }
}

async function closeDriver() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

module.exports = { getDriver, verifyConnectivity, runQuery, runWriteTransaction, closeDriver, neo4j };
