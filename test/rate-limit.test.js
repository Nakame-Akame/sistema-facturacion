process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-only-session-secret';
process.env.LOGIN_RATE_LIMIT = '2';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const app = require('../server');

let server;
let api;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  api = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('login rate limit rejects repeated attempts', async () => {
  const request = () => fetch(`${api}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'unknown@test.local', password: 'wrong-password' }),
  });

  assert.equal((await request()).status, 401);
  assert.equal((await request()).status, 401);
  assert.equal((await request()).status, 429);
});