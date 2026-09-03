import assert from 'node:assert/strict';

const debugOrigin = process.env.NAMU_RACE_DEBUG_ORIGIN || 'http://127.0.0.1:9222';

async function targets() {
  const response = await fetch(`${debugOrigin}/json/list`);
  assert.equal(response.ok, true, 'Electron 디버그 목록을 읽을 수 없습니다.');
  return response.json();
}

async function waitFor(check, message, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error(message);
}

const hud = await waitFor(async () => {
  const list = await targets();
  return list.find((item) => item.url?.endsWith('/src/index-online.html'));
}, 'HUD 페이지를 찾지 못했습니다.');

const socket = new WebSocket(hud.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '페이지 평가 실패');
  return result.result.value;
}

await command('Runtime.enable');
await waitFor(() => evaluate("Boolean(document.querySelector('[data-field=nickname]'))"), '시작 화면이 나타나지 않았습니다.');
assert.equal(await evaluate("document.querySelector('.daily-route')?.innerText.includes('출발')"), true);

await evaluate(`(() => {
  const input = document.querySelector('[data-field=nickname]');
  input.value = '앱테스터';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-action=create]').click();
  return true;
})()`);

await waitFor(() => evaluate("Boolean(document.querySelector('[data-action=start]:not([disabled])'))"), '온라인 대기방이 열리지 않았습니다.');
const roomCode = await evaluate("document.querySelector('.room-code')?.dataset.copy");
assert.match(roomCode, /^[A-Z0-9]{6}$/);
await evaluate("document.querySelector('[data-action=start]').click(); true");

await waitFor(() => evaluate("Boolean(document.querySelector('#wiki-slot'))"), '레이스 HUD가 열리지 않았습니다.');
const wiki = await waitFor(async () => {
  const list = await targets();
  return list.find((item) => item.url?.startsWith('https://namu.wiki/w/'));
}, '원본 나무위키 WebContentsView가 열리지 않았습니다.', 20_000);

const statusText = await evaluate("document.querySelector('.race-note')?.textContent");
assert.match(statusText, /본문 링크|불러오는 중/);
socket.close(1000, 'complete');

console.log(JSON.stringify({
  ok: true,
  roomCode,
  hud: 'desktop-local',
  wikiUrl: wiki.url,
}));
