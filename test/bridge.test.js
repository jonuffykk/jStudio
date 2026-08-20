'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { StudioBridge } = require('../src/main/bridge');
const { BRIDGE } = require('../src/main/config');

const post = (path, body) =>
  fetch(`http://${BRIDGE.host}:${BRIDGE.port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then(response => response.json());

const get = path =>
  fetch(`http://${BRIDGE.host}:${BRIDGE.port}${path}`).then(response => response.json());


test('bridge tracks connection, scans, selection and mappings', async t => {
  const bridge = new StudioBridge();
  await bridge.start();
  t.after(() => bridge.stop());

  const forged = await fetch(`http://${BRIDGE.host}:${BRIDGE.port}/connect`, {
    method: 'POST',
    headers: { origin: 'https://not-studio.example' },
    body: '{}',
  });
  assert.equal(forged.status, 403, 'a web page must not be able to drive the bridge');
  assert.equal(bridge.isConnected(), false);

  const connected = once(bridge, 'status');
  assert.deepEqual(await post('/connect', { placeId: 42, placeName: 'Test Place' }), { ok: true });
  const [status] = await connected;
  assert.equal(status.connected, true);
  assert.equal(status.connection.placeName, 'Test Place');

  bridge.requestScan({ assetType: 'Animation', selectedOnly: true });
  const poll = await get('/poll');
  assert.deepEqual(poll.scanRequest, { assetType: 'Animation', selectedOnly: true });
  assert.deepEqual(await get('/poll'), {});

  const scanned = once(bridge, 'scan');
  await post('/scan-result', { status: 'completed', results: ['1 - Idle - U: 5'] });
  const [scan] = await scanned;
  assert.equal(scan.status, 'completed');
  assert.deepEqual(scan.results, ['1 - Idle - U: 5']);

  const selected = once(bridge, 'selection');
  await post('/selection', { count: '3' });
  assert.deepEqual((await selected)[0], { count: 3 });

  bridge.pushMappings(['1=2']);
  assert.deepEqual((await get('/poll')).mappings, ['1=2']);

  const replaced = once(bridge, 'replace');
  await post('/replace-complete', { replacedCount: 7, elapsed: 1.5 });
  assert.equal((await replaced)[0].replacedCount, 7);

  const unknown = await fetch(`http://${BRIDGE.host}:${BRIDGE.port}/nope`);
  assert.equal(unknown.status, 404);

  const disconnected = once(bridge, 'status');
  await post('/disconnect');
  assert.equal((await disconnected)[0].connected, false);
  assert.equal(bridge.isConnected(), false);
});

