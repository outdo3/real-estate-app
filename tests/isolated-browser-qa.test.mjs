import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function load(name) {
  const url = new URL(`../src/lib/isolated-qa/${name}.ts`, import.meta.url);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, createRequire(url));
  return module.exports;
}

const { isolatedQaResponse } = load('responses');
const { disabledDatabase } = load('database');
const request = (path, method = 'GET') => isolatedQaResponse(method, new URL(path, 'https://qa.example'));

test('blocks all write methods, including keepalive endpoints and cron', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const path of ['/api/log/view', '/api/log/heartbeat', '/api/log/leave',
      '/api/my/recent/sync', '/api/log/event', '/api/cron/sale-sync?mode=apply', '/map']) {
      assert.equal(request(path, method)?.status, 405, `${method} ${path}`);
    }
  }
});

test('fails closed on unapproved reads and incompatible identities', () => {
  for (const path of ['/api/log/leave', '/api/cron/sale-sync?mode=apply',
    '/api/apt/광안자이/info', '/api/apt/광안자이/score', '/api/officetel/markers',
    '/api/apt/광안자이?type=apt&period=12&lawdCd=26350&dong=광안동',
    '/api/apt/광안자이?type=rent&period=12&lawdCd=26500&dong=광안동']) {
    assert.equal(request(path)?.status, 503, path);
  }
  assert.equal(request('/admin')?.status, 404);
  assert.equal(request('/%E0')?.status, 400);
  assert.equal(request('/map'), null);
});

test('database access is unavailable for queries and mutations alike', () => {
  const database = disabledDatabase();
  for (const member of ['$connect', '$queryRaw', '$executeRaw', '$transaction', 'trade', 'activeSession']) {
    assert.throws(() => database[member], /Database access is disabled/);
  }
});

test('saved apartment response preserves canonical identity and expected one-year sale rows', async () => {
  const response = request('/api/apt/광안자이?type=apt&period=12&lawdCd=26500&dong=광안동');
  assert.equal(response?.status, 200);
  assert.equal(response.headers.get('X-EJIP-Data-Source'), 'saved-public-response');
  const { trades, coordinate } = await response.json();
  assert.equal(trades.length, 196);
  assert.ok(trades.every(row => row.aptSeq === '26500-2281'));
  const snapshotDate = new Date('2026-11-21T00:00:00+09:00');
  const sale = trades.filter(row => row.tradeType === '실거래' || row.tradeType.includes('매매'));
  const filtered = sale.filter(row => snapshotDate - new Date(row.tradeDate) <= 365 * 86400000);
  assert.equal(filtered.length, 54);
  assert.equal(coordinate.status, 'RESOLVED');
});

test('marker route never supplies another region and identifies partial sample', async () => {
  const path = '/api/transactions?type=apt&lawdCd=26500&months=12&fields=marker';
  const { transactions, partial } = await request(path).json();
  assert.equal(partial, true);
  assert.deepEqual(transactions.map(row => [row.aptSeq, row.dong]), [['26500-2281', '광안동']]);
  assert.equal(request(path.replace('26500', '26350'))?.status, 503);
});

test('QA providers omit tracking and branch removes scheduled writers', () => {
  const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const providers = src('src/components/AppProviders.tsx');
  assert.doesNotMatch(providers, /ViewTracker|GoogleAnalytics|RegisterServiceWorker/);
  assert.doesNotMatch(src('src/app/apt/[name]/apt-client.tsx'), /api\/my\/recent\/sync|api\/log\/view|recordApartmentVisit/);
  assert.doesNotMatch(src('src/lib/analytics/trackEvent.ts'), /fetch\(|sendBeacon/);
  assert.equal(JSON.parse(src('vercel.json')).crons, undefined);
});
