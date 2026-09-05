import assert from 'node:assert/strict';

// Run only against a dedicated test profile started with --remote-debugging-port.
const origin = process.env.NAMU_RACE_DEBUG_ORIGIN || 'http://127.0.0.1:9333';
const response = await fetch(`${origin}/json/list`);
const target = (await response.json()).find((item) => item.url?.endsWith('/src/index-online.html'));
assert.ok(target, 'packaged HUD must load');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const pending = new Map();
let id = 0;
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
async function evaluate(expression) {
  const next = ++id;
  const promise = new Promise((resolve, reject) => pending.set(next, { resolve, reject }));
  socket.send(JSON.stringify({ id: next, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const result = await promise;
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  let result;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    result = await evaluate(`(async () => ({ panel: Boolean(document.querySelector('#update-panel button')), update: await window.namuRace.getUpdateState() }))()`);
    if (result.panel) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(result.panel, true, 'updater panel must appear independently of the online game');
  assert.equal(result.update.currentVersion, '0.4.1-beta.1');
  assert.notEqual(result.update.phase, 'unsupported', 'packaged Windows updater must be enabled');
  assert.equal(await evaluate(`(() => {
    const input = document.querySelector('[data-field=nickname]');
    input.value = '업데이트검사';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return localStorage.getItem('namu-race-online-nickname-v1');
  })()`), '업데이트검사');

  // Update events must not replace the input or reset its focus while the user types.
  await evaluate(`globalThis.updateTestInput = document.querySelector('[data-field=nickname]'); updateTestInput.focus(); true`);
  const status = await evaluate('window.namuRace.checkUpdate()');
  assert.equal(await evaluate('updateTestInput === document.querySelector("[data-field=nickname]") && document.activeElement === updateTestInput'), true);
  if (process.env.NAMU_RACE_EXPECT_LATEST === '1') assert.equal(status.phase, 'current');
  else assert.ok(['current', 'error'].includes(status.phase));
  assert.equal(await evaluate(`(() => {
    const panel = document.querySelector('#update-panel').getBoundingClientRect();
    return panel.width > 0 && panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight;
  })()`), true, 'update controls must fit in the window');
  console.log(JSON.stringify({ ok: true, version: result.update.currentVersion, updatePhase: status.phase, preservesInput: true, nicknameStored: true }));
} finally {
  socket.close();
}
