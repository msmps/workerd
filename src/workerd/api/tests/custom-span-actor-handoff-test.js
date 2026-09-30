// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import * as assert from 'node:assert';
import { DurableObject, tracing } from 'cloudflare:workers';

const WORK_MS = 200;

export class SpanLifetimeActor extends DurableObject {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/start/')) {
      [, , this.eventType, this.mode] = path.split('/');
      this.started = false;
      this.finished = false;
      if (this.eventType === 'alarm') {
        await this.ctx.storage.setAlarm(Date.now());
      } else {
        this.startWork();
      }
      return new Response(null, { status: 202 });
    }

    return Response.json({
      started: this.started ?? false,
      finished: this.finished ?? false,
    });
  }

  alarm() {
    this.startWork();
  }

  startWork() {
    // Keep the span open after the alarm or fetch returns.
    const work = tracing.startActiveSpan(
      `actor-handoff.${this.eventType}.${this.mode}`,
      async (span) => {
        this.started = true;
        await scheduler.wait(WORK_MS);
        span.setAttribute('work.finished', true);
        span.end();
        this.finished = true;
      }
    );

    // Cover both implicit actor task lifetime and explicit registration.
    if (this.mode === 'wait-until') this.ctx.waitUntil(work);
    else void work;
  }
}

async function runCase(env, eventType, mode) {
  const name = `${eventType}.${mode}`;
  const stub = env.ACTORS.getByName(name);
  assert.strictEqual(
    (await stub.fetch(`https://example.com/start/${eventType}/${mode}`)).status,
    202
  );

  // A status request during the work takes over actor task draining.
  let sawRunning = false;
  for (let i = 0; i < 100; i++) {
    const status = await stub.fetch('https://example.com/status');
    const state = await status.json();
    if (state.started && !state.finished) sawRunning = true;
    if (state.finished) {
      assert.ok(sawRunning, `${name}: no request arrived during the work`);
      return;
    }
    await scheduler.wait(5);
  }
  assert.fail(`${name}: work did not finish`);
}

export const test = {
  async test(_controller, env) {
    await runCase(env, 'alarm', 'implicit');
    await runCase(env, 'alarm', 'wait-until');
    await runCase(env, 'fetch', 'implicit');
    await runCase(env, 'fetch', 'wait-until');
  },
};
