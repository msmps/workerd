// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import * as assert from 'node:assert';

const spans = new Map();

export default {
  tailStream() {
    // Capture raw events; force-closing orphaned spans happens downstream.
    let span;
    let spanId;
    return (event) => {
      if (
        event.event.type === 'spanOpen' &&
        event.event.name.startsWith('actor-handoff.')
      ) {
        spanId = event.event.spanId;
        span = { name: event.event.name, attributes: [], closeCount: 0 };
        spans.set(span.name, span);
      } else if (event.spanContext.spanId === spanId) {
        if (event.event.type === 'attributes') {
          span.attributes.push(...event.event.info);
        } else if (event.event.type === 'spanClose') {
          span.closeCount++;
        }
      }
    };
  },
};

function resultFor(eventType, mode) {
  const span = spans.get(`actor-handoff.${eventType}.${mode}`);
  return {
    eventType,
    mode,
    attributes: span?.attributes,
    closeCount: span?.closeCount,
  };
}

const expectedAttributes = [{ name: 'work.finished', value: true }];

export const test = {
  async test() {
    await scheduler.wait(100);
    // The originating tracer must accept the final attribute and normal close.
    assert.deepStrictEqual(
      [
        resultFor('alarm', 'implicit'),
        resultFor('alarm', 'wait-until'),
        resultFor('fetch', 'implicit'),
        resultFor('fetch', 'wait-until'),
      ],
      [
        {
          eventType: 'alarm',
          mode: 'implicit',
          attributes: expectedAttributes,
          closeCount: 1,
        },
        {
          eventType: 'alarm',
          mode: 'wait-until',
          attributes: expectedAttributes,
          closeCount: 1,
        },
        {
          eventType: 'fetch',
          mode: 'implicit',
          attributes: expectedAttributes,
          closeCount: 1,
        },
        {
          eventType: 'fetch',
          mode: 'wait-until',
          attributes: expectedAttributes,
          closeCount: 1,
        },
      ]
    );
  },
};
