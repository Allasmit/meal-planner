import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { isBlockedAddress, safeFetchText, SafeFetchError } from '../src/lib/safe-fetch';

test('private, loopback, link-local and metadata addresses are blocked', () => {
  for (const addr of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.70', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:192.168.0.5', 'not-an-ip',
  ]) {
    assert.equal(isBlockedAddress(addr), true, addr);
  }
});

test('public addresses are allowed', () => {
  for (const addr of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(addr), false, addr);
  }
});

test('loopback / private literals and localhost are refused without touching the network', async () => {
  for (const url of ['http://127.0.0.1:1/', 'http://[::1]:1/', 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.70/', 'http://localhost:1/']) {
    await assert.rejects(() => safeFetchText(url), (e: unknown) => e instanceof SafeFetchError, url);
  }
});

test('non-http schemes and credentials are refused', async () => {
  await assert.rejects(() => safeFetchText('file:///etc/passwd'), SafeFetchError);
  await assert.rejects(() => safeFetchText('ftp://example.com/x'), SafeFetchError);
  await assert.rejects(() => safeFetchText('http://user:pass@example.com/'), SafeFetchError);
  await assert.rejects(() => safeFetchText('not a url'), SafeFetchError);
});

let server: http.Server;
let base: string;

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/ok') { res.setHeader('content-type', 'text/html'); res.end('<h1>hello</h1>'); return; }
    if (url === '/gzip') {
      res.setHeader('content-encoding', 'gzip');
      res.end(zlib.gzipSync('compressed body'));
      return;
    }
    if (url === '/redirect') { res.statusCode = 302; res.setHeader('location', '/ok'); res.end(); return; }
    if (url === '/loop') { res.statusCode = 302; res.setHeader('location', '/loop'); res.end(); return; }
    if (url === '/to-file') { res.statusCode = 302; res.setHeader('location', 'file:///etc/passwd'); res.end(); return; }
    if (url === '/big') { res.end('x'.repeat(200_000)); return; }
    if (url === '/slow') { setTimeout(() => res.end('late'), 2000); return; }
    if (url === '/missing') { res.statusCode = 404; res.end('nope'); return; }
    res.statusCode = 500; res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

// allowPrivateNetwork is a test-only switch so the fetch logic can be exercised against a local server.
const local = { allowPrivateNetwork: true };

test('fetches a page and reports non-2xx statuses without throwing', async () => {
  assert.equal((await safeFetchText(`${base}/ok`, local)).body, '<h1>hello</h1>');
  assert.equal((await safeFetchText(`${base}/missing`, local)).status, 404);
});

test('decompresses gzip responses', async () => {
  assert.equal((await safeFetchText(`${base}/gzip`, local)).body, 'compressed body');
});

test('follows redirects, but not forever and not to other schemes', async () => {
  const result = await safeFetchText(`${base}/redirect`, local);
  assert.equal(result.body, '<h1>hello</h1>');
  assert.ok(result.url.endsWith('/ok'));
  await assert.rejects(() => safeFetchText(`${base}/loop`, local), /too many times/);
  await assert.rejects(() => safeFetchText(`${base}/to-file`, local), /Only http and https/);
});

test('enforces the size cap and the timeout', async () => {
  await assert.rejects(() => safeFetchText(`${base}/big`, { ...local, maxBytes: 1000 }), /too large/);
  await assert.rejects(() => safeFetchText(`${base}/slow`, { ...local, timeoutMs: 300 }), /too long/);
});
