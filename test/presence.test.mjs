import assert from 'node:assert/strict';
import test from 'node:test';
import { PRESENCE_TIMEOUT_MS, presenceDeadline } from '../shared/presence.mjs';

test('presence grace tolerates short gaps, renews after disconnect and expires at a fixed deadline', () => {
  assert.equal(PRESENCE_TIMEOUT_MS, 120000);
  assert.equal(presenceDeadline({ joinedAt: 1000 }), 121000);
  assert.equal(presenceDeadline({ joinedAt: 1000, lastSeenAt: 5000 }), 125000);
  assert.equal(presenceDeadline({ lastSeenAt: 5000, disconnectedAt: 7000 }), 127000);
  assert.equal(presenceDeadline({ lastSeenAt: 9000, disconnectedAt: 7000 }), 129000);
});
