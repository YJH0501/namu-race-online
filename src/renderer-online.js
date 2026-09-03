'use strict';

const SESSION_KEY = 'namu-race-online-session-v1';
const SERVER_KEY = 'namu-race-online-server-v1';
const appRoot = document.querySelector('#app');

const state = {
  busy: false,
  connection: 'offline',
  copied: false,
  customGoal: '',
  customStart: '',
  daily: null,
  joinCode: '',
  mode: 'daily',
  nickname: '',
  notice: '',
  restoring: true,
  room: null,
  serverUrl: localStorage.getItem(SERVER_KEY) || '',
  session: readSession(),
  wikiLoading: false,
};

let socket = null;
let socketRetry = null;
let pollTimer = null;

function readSession() {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(session) {
  state.session = { ...session, serverUrl: state.serverUrl };
  localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatElapsed(startedAt, finishedAt = null) {
  if (!startedAt) return '00:00';
  const seconds = Math.max(0, Math.floor(((finishedAt || Date.now()) - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function modeName(mode) {
  return mode === 'daily' ? '오늘의 레이스' : mode === 'custom' ? '직접 지정' : '랜덤 레이스';
}

function currentPlayer() {
  return state.room?.players?.find((player) => player.id === state.session?.playerId) || null;
}

function allReady() {
  return Boolean(state.room?.players?.length && state.room.players.every((player) => Boolean(player.ready)));
}

async function request(method, path, body) {
  const response = await window.namuRace.request(state.serverUrl, method, path, body);
  if (!response?.ok) throw new Error(response?.data?.error || '요청을 처리하지 못했어요.');
  return response.data;
}

async function runAction(action) {
  if (state.busy) return;
  state.busy = true;
  state.notice = '';
  render();
  try {
    const data = await action();
    if (data.session) saveSession(data.session);
    if (data.room) state.room = data.room;
    connectSocket();
  } catch (error) {
    state.notice = error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.';
  } finally {
    state.busy = false;
    render();
    schedulePoll();
  }
}

function brand() {
  return `<div class="brand"><span class="brand-mark">♣</span><span>나무레이스</span><span class="online-badge"><i class="online-dot"></i>ONLINE</span></div>`;
}

function dailyPanel() {
  const route = state.daily;
  if (!route) return '<div class="mode-panel"><p class="muted">오늘의 경로를 불러오는 중…</p></div>';
  return `<div class="mode-panel"><p><strong>모든 플레이어에게 하루 동안 같은 경로</strong></p><div class="daily-route"><div><small>출발</small><strong>${escapeHtml(route.startTitle)}</strong></div><span class="accent">→</span><div><small>목표</small><strong>${escapeHtml(route.goalTitle)}</strong></div></div></div>`;
}

function customPanel() {
  return `<div class="mode-panel"><div class="custom-grid"><div class="field"><label for="custom-start">출발 문서</label><input id="custom-start" data-field="customStart" maxlength="200" value="${escapeHtml(state.customStart)}" placeholder="예: 축구"></div><div class="field"><label for="custom-goal">목표 문서</label><input id="custom-goal" data-field="customGoal" maxlength="200" value="${escapeHtml(state.customGoal)}" placeholder="예: 인공지능"></div></div></div>`;
}

function randomPanel() {
  return '<div class="mode-panel"><p><strong>출발과 목표를 서버가 무작위로 선택합니다.</strong><br><span class="muted">방을 만든 후 선택된 두 문서를 확인할 수 있어요.</span></p></div>';
}

function landingView() {
  const panel = state.mode === 'daily' ? dailyPanel() : state.mode === 'custom' ? customPanel() : randomPanel();
  return `
    <main class="shell">
      <section class="landing">
        <div class="hero">${brand()}<h1>원본 나무위키에서,<br><span>모두 함께 달리자.</span></h1><p class="muted">Windows와 Mac에서 같은 방 코드로 접속하세요. 각자의 프로그램 안에 실제 나무위키를 열고, 링크 이동과 순위만 온라인으로 동기화합니다.</p><div class="features"><span><i></i>Windows · macOS</span><span><i></i>6자리 방 코드</span><span><i></i>원본 나무위키</span></div></div>
        <section class="card start-card">
          <p class="eyebrow">Cross-platform race</p><h2>온라인 레이스</h2><p class="muted">레이스 방식을 고르고 방을 만들거나 친구의 코드로 참가하세요.</p>
          <div class="field"><label for="nickname">닉네임</label><input id="nickname" data-field="nickname" maxlength="12" value="${escapeHtml(state.nickname)}" placeholder="2~12글자"></div>
          <div class="mode-picker"><button class="mode-button ${state.mode === 'daily' ? 'active' : ''}" data-mode="daily">오늘</button><button class="mode-button ${state.mode === 'random' ? 'active' : ''}" data-mode="random">랜덤</button><button class="mode-button ${state.mode === 'custom' ? 'active' : ''}" data-mode="custom">직접 지정</button></div>
          ${panel}
          <button class="button create-button" data-action="create" ${state.busy ? 'disabled' : ''}>새 방 만들기</button>
          <div class="join-section"><div class="join-row"><input data-field="joinCode" maxlength="6" value="${escapeHtml(state.joinCode)}" placeholder="방 코드 6자리"><button class="button secondary" data-action="join" ${state.busy ? 'disabled' : ''}>참가</button></div></div>
          <p class="notice">${escapeHtml(state.notice)}</p>
          <details class="server-settings"><summary>서버 연결 설정</summary><input data-field="serverUrl" value="${escapeHtml(state.serverUrl)}" aria-label="온라인 서버 주소"></details>
        </section>
      </section>
    </main>`;
}

function routeView(room) {
  return `<div class="route"><div><small>출발 문서</small><strong>${escapeHtml(room.startTitle)}</strong></div><span class="route-arrow">→</span><div><small>목표 문서</small><strong>${escapeHtml(room.goalTitle)}</strong></div></div>`;
}

function playerList(room, racing = false) {
  return room.players.map((player, index) => `
    <div class="${racing ? 'rank-row' : 'player-row'} ${player.id === state.session.playerId ? 'me' : ''}">
      ${racing ? `<span class="rank">${index + 1}</span>` : ''}<span class="avatar">${escapeHtml(player.nickname?.[0] || '?')}</span>
      ${racing ? `<span class="player-detail"><strong>${escapeHtml(player.nickname)}</strong><small>${player.finishedAt ? '목표 도착' : escapeHtml(player.currentTitle || room.startTitle)}</small></span><span class="clicks">${player.clicks} 클릭${player.finishedAt ? ' 🏁' : ''}</span>` : `<span class="player-name">${escapeHtml(player.nickname)}${player.id === state.session.playerId ? ' <small class="muted">(나)</small>' : ''}</span><span class="status ${player.ready ? 'ready' : ''}">${player.ready ? '준비' : '대기'}</span>`}
    </div>`).join('');
}

function lobbyView(room) {
  const me = currentPlayer();
  const host = Boolean(state.session.hostToken);
  return `<main class="shell"><section class="lobby"><div class="lobby-top">${brand()}<div><span class="mode-label">${escapeHtml(modeName(room.mode))}</span><button class="room-code" data-copy="${escapeHtml(room.code)}">${escapeHtml(room.code)} ${state.copied ? '✓' : '⎘'}</button><button class="button ghost" data-action="leave">나가기</button></div></div><article class="card lobby-card"><header class="lobby-head"><div><p class="eyebrow">Online waiting room</p><h1>친구들을 기다리는 중</h1><p class="muted">6자리 방 코드를 공유하고 모두 준비되면 출발하세요.</p></div><span class="status ready">${room.players.length} / 8명</span></header><div class="lobby-body"><div>${routeView(room)}<div class="host-box"><strong>Windows·Mac 공통 방 코드</strong><br>다른 네트워크에 있는 친구도 코드만 입력하면 참가할 수 있어요.<br><span class="connection-state ${state.connection === 'live' ? 'live' : ''}"><i class="online-dot"></i>${state.connection === 'live' ? '실시간 연결됨' : '재연결 중'}</span></div><p class="notice">${escapeHtml(state.notice)}</p></div><div><div class="player-list">${playerList(room)}</div><div class="lobby-actions">${host ? `<button class="button" data-action="start" ${state.busy || !allReady() ? 'disabled' : ''}>${allReady() ? '레이스 시작' : '모두의 준비를 기다리는 중'}</button>` : `<button class="button ${me?.ready ? 'secondary' : ''}" data-action="ready" ${state.busy ? 'disabled' : ''}>${me?.ready ? '준비 취소' : '준비 완료'}</button>`}</div></div></div></article></section></main>`;
}

function raceView(room, me) {
  const activity = state.notice || (state.wikiLoading ? '나무위키 문서를 불러오는 중…' : '본문 링크만 눌러서 이동하세요.');
  return `<main class="shell race"><header class="race-top">${brand()}<div class="race-route"><span>${escapeHtml(me.currentTitle)}</span><b class="muted">→</b><span class="goal">${escapeHtml(room.goalTitle)}</span></div><div class="race-meta"><span class="race-note ${state.notice || state.wikiLoading ? 'active' : ''}">${escapeHtml(activity)}</span><div class="metric"><strong data-elapsed>${formatElapsed(room.startedAt)}</strong><small>경과 시간</small></div><div class="metric"><strong>${me.clicks}</strong><small>클릭 수</small></div><button class="room-code" data-copy="${escapeHtml(room.code)}">${escapeHtml(room.code)}</button></div></header><div class="race-grid"><div id="wiki-slot" class="wiki-slot" aria-label="나무위키 원문"></div><aside class="card scoreboard"><div class="score-head"><h2>실시간 순위</h2><p class="muted">${escapeHtml(modeName(room.mode))} · ${room.players.length}명</p></div>${playerList(room, true)}</aside></div></main>`;
}

function finishView(room, me) {
  return `<main class="shell"><section class="finish"><article class="card finish-card"><span class="finish-icon">★</span><p class="eyebrow">Finished</p><h1>목표 문서에 도착!</h1><p class="muted"><strong>${escapeHtml(room.goalTitle)}</strong>까지 완주했어요. 다른 플레이어의 결과도 온라인으로 계속 갱신됩니다.</p><div class="finish-stats"><div><strong>${me.clicks}</strong><small>클릭</small></div><div><strong>${formatElapsed(room.startedAt, me.finishedAt)}</strong><small>완주 시간</small></div></div><div class="player-list">${playerList(room)}</div><button class="button secondary" data-action="leave">첫 화면으로</button></article></section></main>`;
}

function render() {
  if (state.restoring) {
    window.namuRace.hideWiki();
    appRoot.innerHTML = '<main class="loading"><div><div class="spinner"></div><p class="muted">온라인 레이스 서버에 연결하는 중…</p></div></main>';
    return;
  }
  if (!state.session || !state.room) {
    window.namuRace.hideWiki();
    appRoot.innerHTML = landingView();
    return;
  }
  if (state.room.status === 'waiting') {
    window.namuRace.hideWiki();
    appRoot.innerHTML = lobbyView(state.room);
    return;
  }
  const me = currentPlayer();
  if (!me) return leaveRoom();
  if (me.finishedAt) {
    window.namuRace.hideWiki();
    appRoot.innerHTML = finishView(state.room, me);
    return;
  }
  appRoot.innerHTML = raceView(state.room, me);
  requestAnimationFrame(() => {
    updateWikiBounds();
    window.namuRace.showWiki(me.currentTitle || state.room.startTitle);
  });
}

function updateWikiBounds() {
  const slot = document.querySelector('#wiki-slot');
  if (!slot) return;
  const bounds = slot.getBoundingClientRect();
  window.namuRace.setWikiBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
}

function closeSocket() {
  window.clearTimeout(socketRetry);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  state.connection = 'offline';
}

function connectSocket() {
  if (!state.session || !state.room) return;
  closeSocket();
  try {
    const url = new URL(state.serverUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/rooms/${state.session.code}/ws`;
    url.searchParams.set('playerId', state.session.playerId);
    url.searchParams.set('token', state.session.playerToken);
    socket = new WebSocket(url);
    socket.onopen = () => { state.connection = 'live'; render(); };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'room' && message.room) {
          state.room = message.room;
          state.notice = '';
          render();
        }
      } catch {
        // Ignore non-state messages such as pong.
      }
    };
    socket.onerror = () => { state.connection = 'offline'; };
    socket.onclose = () => {
      state.connection = 'offline';
      render();
      socketRetry = window.setTimeout(connectSocket, 2200);
    };
  } catch {
    state.connection = 'offline';
  }
}

function schedulePoll() {
  window.clearTimeout(pollTimer);
  if (!state.session) return;
  pollTimer = window.setTimeout(refreshRoom, state.connection === 'live' ? 5000 : 1800);
}

async function refreshRoom() {
  if (!state.session || state.busy) return schedulePoll();
  try {
    const data = await request('GET', `/rooms/${state.session.code}`);
    state.room = data.room;
    render();
  } catch (error) {
    state.notice = error instanceof Error ? error.message : '방 정보를 갱신하지 못했어요.';
    render();
  } finally {
    schedulePoll();
  }
}

function leaveRoom() {
  closeSocket();
  window.clearTimeout(pollTimer);
  localStorage.removeItem(SESSION_KEY);
  state.session = null;
  state.room = null;
  state.notice = '';
  state.restoring = false;
  render();
}

document.addEventListener('input', (event) => {
  const field = event.target.dataset?.field;
  if (!field || !(field in state)) return;
  state[field] = event.target.value;
  if (field === 'serverUrl') {
    state.serverUrl = state.serverUrl.trim();
    localStorage.setItem(SERVER_KEY, state.serverUrl);
  }
});

document.addEventListener('click', (event) => {
  const modeButton = event.target.closest('[data-mode]');
  if (modeButton) {
    state.mode = modeButton.dataset.mode;
    return render();
  }
  const copyButton = event.target.closest('[data-copy]');
  if (copyButton) {
    void window.namuRace.copyText(copyButton.dataset.copy);
    state.copied = true;
    render();
    return window.setTimeout(() => { state.copied = false; render(); }, 1300);
  }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'leave') return leaveRoom();
  if (action === 'create') {
    if (state.nickname.trim().length < 2) { state.notice = '닉네임은 2글자 이상 입력해 주세요.'; return render(); }
    return runAction(async () => request('POST', '/rooms', {
      nickname: state.nickname.trim(),
      mode: state.mode,
      startTitle: state.customStart,
      goalTitle: state.customGoal,
    }));
  }
  if (action === 'join') {
    const code = state.joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (state.nickname.trim().length < 2 || code.length !== 6) { state.notice = '닉네임과 6자리 방 코드를 확인해 주세요.'; return render(); }
    return runAction(async () => request('POST', `/rooms/${code}/join`, { nickname: state.nickname.trim() }));
  }
  if (action === 'ready') {
    return runAction(async () => request('POST', `/rooms/${state.session.code}/action`, { action: 'ready', playerId: state.session.playerId, playerToken: state.session.playerToken }));
  }
  if (action === 'start') {
    return runAction(async () => request('POST', `/rooms/${state.session.code}/action`, { action: 'start', hostToken: state.session.hostToken }));
  }
});

window.addEventListener('resize', updateWikiBounds);
window.setInterval(() => {
  for (const element of document.querySelectorAll('[data-elapsed]')) element.textContent = formatElapsed(state.room?.startedAt);
}, 500);

window.namuRace.onWikiLink(({ title }) => {
  const me = currentPlayer();
  if (!me || state.busy || state.room?.status !== 'racing') return;
  state.wikiLoading = true;
  state.notice = `“${title}”(으)로 이동하는 중…`;
  render();
  runAction(async () => request('POST', `/rooms/${state.session.code}/action`, {
    action: 'progress', playerId: state.session.playerId, playerToken: state.session.playerToken, nextTitle: title,
  })).finally(() => { state.wikiLoading = false; render(); });
});
window.namuRace.onWikiBlocked(({ message }) => { state.notice = message; render(); });
window.namuRace.onWikiLoadState((payload) => {
  state.wikiLoading = Boolean(payload.loading);
  if (payload.error) state.notice = payload.error;
  render();
});

async function fetchDaily() {
  try {
    const data = await request('GET', '/daily');
    state.daily = data.route;
  } catch (error) {
    state.notice = error instanceof Error ? error.message : '온라인 서버에 연결하지 못했어요.';
  }
}

async function boot() {
  if (!state.serverUrl) state.serverUrl = await window.namuRace.defaultServerUrl();
  if (state.session?.serverUrl) state.serverUrl = state.session.serverUrl;
  localStorage.setItem(SERVER_KEY, state.serverUrl);
  await fetchDaily();
  if (state.session) {
    try {
      const data = await request('GET', `/rooms/${state.session.code}`);
      state.room = data.room;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      state.session = null;
    }
  }
  state.restoring = false;
  render();
  if (state.session && state.room) connectSocket();
  schedulePoll();
}

boot();
