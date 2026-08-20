'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Aborted, mapConcurrent, retry, semaphore, sleep } = require('../src/main/lib');

test('semaphore caps concurrent execution', async () => {
  const slot = semaphore(2);
  let active = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 6 }, () =>
      slot(async () => {
        active++;
        peak = Math.max(peak, active);
        await sleep(15);
        active--;
      })
    )
  );

  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('mapConcurrent preserves input order', async () => {
  const results = await mapConcurrent([5, 1, 3], 2, async value => {
    await sleep(value);
    return value * 2;
  });
  assert.deepEqual(results, [10, 2, 6]);
});

test('retry gives up after the configured attempts', async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      () => {
        calls++;
        throw new Error('boom');
      },
      { attempts: 3, delayMs: 1 }
    ),
    /boom/
  );
  assert.equal(calls, 3);
});

test('retry resolves as soon as the call succeeds', async () => {
  let calls = 0;
  const value = await retry(
    () => {
      calls++;
      if (calls < 2) throw new Error('flaky');
      return 'ok';
    },
    { attempts: 5, delayMs: 1 }
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
});

test('retry stops immediately once the signal aborts', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(retry(() => 'never', { signal: controller.signal }), Aborted);
});
