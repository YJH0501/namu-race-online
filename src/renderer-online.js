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
  expandedPaths: new Set(),
  joinCode: '',
  mode: 'daily',
  nickname: '',
  notice: '',
  roundCount: 3,
  restoring: true,
  room: null,
  serverUrl: localStorage.getItem(SERVER_KEY) || '',
  session: readSession(),
  wikiLoading: false,
};

let socket = null;
let socketRetry = null;
let socketHeartbeat = null;
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

function applyRoom(room) {
  const previousRound = state.room?.round;
  state.room = room;
  if (previousRound && room?.round && previousRound !== room.round) {
    state.expandedPaths.clear();
  }
  if (!state.session || !room) return;

  if (room.hostPlayerId === state.session.playerId && room.hostToken) {
    if (state.session.hostToken !== room.hostToken) {
      saveSession({ ...state.session, hostToken: room.hostToken });
    }
  } else if (state.session.hostToken) {
    const { hostToken: _hostToken, ...session } = state.session;
    saveSession(session);
  }
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
  return mode === 'daily' ? '오늘의 레이스' : mode === 'custom' ? '직접 지정' : mode === 'rounds' ? '라운드 레이스' : '랜덤 레이스';
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
    if (data.room) applyRoom(data.room);
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
  return '<div class="mode-panel"><p><strong>나무위키 전체 문서에서 무작위로 선택합니다.</strong><br><span class="muted">출발과 목표는 모두가 준비한 뒤 시작과 동시에 공개돼요.</span></p></div>';
}

function roundsPanel() {
  return `<div class="mode-panel"><p><strong>여러 랜덤 경로를 연속으로 달립니다.</strong><br><span class="muted">클릭 수 70%와 완주 시간 30%를 점수로 환산해 누적합니다.</span></p><div class="round-count"><label for="round-count">전체 라운드</label><select id="round-count" data-field="roundCount">${Array.from({ length: 9 }, (_, index) => index + 2).map((count) => `<option value="${count}" ${Number(state.roundCount) === count ? 'selected' : ''}>${count}라운드</option>`).join('')}</select></div></div>`;
}

function landingView() {
  const panel = state.mode === 'daily' ? dailyPanel() : state.mode === 'custom' ? customPanel() : state.mode === 'rounds' ? roundsPanel() : randomPanel();
  return `
    <main class="shell">
      <section class="landing">
        <div class="hero">${brand()}<h1>원본 나무위키에서,<br><span>모두 함께 달리자.</span></h1><p class="muted">Windows와 Mac에서 같은 방 코드로 접속하세요. 각자의 프로그램 안에 실제 나무위키를 열고, 링크 이동과 순위만 온라인으로 동기화합니다.</p><div class="features"><span><i></i>Windows · macOS</span><span><i></i>6자리 방 코드</span><span><i></i>원본 나무위키</span></div></div>
        <section class="card start-card">
          <p class="eyebrow">Cross-platform race</p><h2>온라인 레이스</h2><p class="muted">레이스 방식을 고르고 방을 만들거나 친구의 코드로 참가하세요.</p>
          <div class="field"><label for="nickname">닉네임</label><input id="nickname" data-field="nickname" maxlength="12" value="${escapeHtml(state.nickname)}" placeholder="2~12글자"></div>
          <div class="mode-picker"><button class="mode-button ${state.mode === 'daily' ? 'active' : ''}" data-mode="daily">오늘</button><button class="mode-button ${state.mode === 'random' ? 'active' : ''}" data-mode="random">랜덤</button><button class="mode-button ${state.mode === 'custom' ? 'active' : ''}" data-mode="custom">직접 지정</button><button class="mode-button ${state.mode === 'rounds' ? 'active' : ''}" data-mode="rounds">라운드</button></div>
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
  if (room.routeHidden) {
    return '<div class="route hidden-route"><div><small>출발 문서</small><strong>시작 시 공개</strong></div><span class="route-arrow">?</span><div><small>목표 문서</small><strong>시작 시 공개</strong></div></div>';
  }
  return `<div class="route"><div><small>출발 문서</small><strong>${escapeHtml(room.startTitle)}</strong></div><span class="route-arrow">→</span><div><small>목표 문서</small><strong>${escapeHtml(room.goalTitle)}</strong></div></div>`;
}

function playerPathDetails(room, player) {
  if (!Array.isArray(player.path)) return '';
  const rounds = room.mode === 'rounds' ? player.roundResults || [] : [];
  const summary = rounds.length
    ? `자세히보기 · ${rounds.length}개 라운드`
    : `자세히보기 · ${player.path.length - 1}번 이동`;
  const content = rounds.length
    ? rounds.map((result) => `<section class="round-path"><strong>${result.round}라운드 · ${result.score}점 · ${result.finished ? '완주' : '포기'}</strong><div class="path-list">${result.path.map((title, pathIndex) => `<span>${escapeHtml(title)}</span>${pathIndex < result.path.length - 1 ? '<b>→</b>' : ''}`).join('')}</div></section>`).join('')
    : `<div class="path-list">${player.path.map((title, pathIndex) => `<span>${escapeHtml(title)}</span>${pathIndex < player.path.length - 1 ? '<b>→</b>' : ''}`).join('')}</div>`;
  return `<details class="path-details" data-player-path="${escapeHtml(player.id)}" ${state.expandedPaths.has(player.id) ? 'open' : ''}><summary>${summary}</summary>${content}</details>`;
}

function playerList(room, racing = false) {
  return room.players.map((player, index) => `
    <div class="${racing ? 'rank-row' : 'player-row'} ${player.id === state.session.playerId ? 'me' : ''}">
      ${racing ? `<span class="rank">${index + 1}</span>` : ''}<span class="avatar">${escapeHtml(player.nickname?.[0] || '?')}</span>
      ${racing ? `<span class="player-detail"><strong>${escapeHtml(player.nickname)}</strong><small>${player.finishedAt ? '목표 도착' : player.forfeitedAt ? '레이스 포기' : player.currentTitle ? escapeHtml(player.currentTitle) : '경로 비공개'}</small></span><span class="clicks ${player.forfeitedAt ? 'forfeited' : ''}">${room.mode === 'rounds' ? `${player.score || 0}점 · ` : ''}${player.clicks} 클릭${player.finishedAt ? ' 🏁' : player.forfeitedAt ? ' 포기' : ''}</span>` : `<span class="player-name">${escapeHtml(player.nickname)}${player.id === state.session.playerId ? ' <small class="muted">(나)</small>' : ''}${room.mode === 'rounds' && room.round > 1 ? ` <small class="accent">${player.score || 0}점</small>` : ''}</span><span class="status ${player.ready ? 'ready' : ''}">${player.ready ? '준비' : '대기'}</span>`}
      ${playerPathDetails(room, player)}
    </div>`).join('');
}

function lobbyView(room) {
  const me = currentPlayer();
  const host = Boolean(state.session.hostToken);
  return `<main class="shell"><section class="lobby"><div class="lobby-top">${brand()}<div><span class="mode-label">${escapeHtml(modeName(room.mode))}${room.mode === 'rounds' ? ` · ${room.round}/${room.totalRounds}` : ''}</span><button class="room-code" data-copy="${escapeHtml(room.code)}">${escapeHtml(room.code)} ${state.copied ? '✓' : '⎘'}</button><button class="button ghost" data-action="leave">나가기</button></div></div><article class="card lobby-card"><header class="lobby-head"><div><p class="eyebrow">Online waiting room</p><h1>${room.mode === 'rounds' && room.round > 1 ? `${room.round}라운드 준비` : '친구들을 기다리는 중'}</h1><p class="muted">6자리 방 코드를 공유하고 모두 준비되면 출발하세요.</p></div><span class="status ready">${room.players.length} / 8명</span></header><div class="lobby-body"><div>${routeView(room)}<div class="host-box"><strong>${room.mode === 'rounds' ? `${room.round} / ${room.totalRounds}라운드` : 'Windows·Mac 공통 방 코드'}</strong><br>${room.mode === 'rounds' ? '새 경로는 모두가 준비한 뒤 시작할 때 공개됩니다.' : '다른 네트워크에 있는 친구도 코드만 입력하면 참가할 수 있어요.'}<br><span class="connection-state ${state.connection === 'live' ? 'live' : ''}"><i class="online-dot"></i>${state.connection === 'live' ? '실시간 연결됨' : '재연결 중'}</span></div><p class="notice">${escapeHtml(state.notice)}</p></div><div><div class="player-list">${playerList(room)}</div><div class="lobby-actions">${host ? `<button class="button" data-action="start" ${state.busy || !allReady() ? 'disabled' : ''}>${allReady() ? `${room.mode === 'rounds' ? `${room.round}라운드` : '레이스'} 시작` : '모두의 준비를 기다리는 중'}</button>` : `<button class="button ${me?.ready ? 'secondary' : ''}" data-action="ready" ${state.busy ? 'disabled' : ''}>${me?.ready ? '준비 취소' : '준비 완료'}</button>`}</div></div></div></article></section></main>`;
}

function raceView(room, me) {
  const activity = state.notice || (state.wikiLoading ? '나무위키 문서를 불러오는 중…' : '본문 링크만 눌러서 이동하세요.');
  return `<main class="shell race"><header class="race-top">${brand()}<div class="race-route"><span>${escapeHtml(me.currentTitle)}</span><b class="muted">→</b><span class="goal">${escapeHtml(room.goalTitle)}</span></div><div class="race-meta"><span class="race-note ${state.notice || state.wikiLoading ? 'active' : ''}">${escapeHtml(activity)}</span><div class="metric"><strong data-elapsed>${formatElapsed(room.startedAt)}</strong><small>경과 시간</small></div><div class="metric"><strong>${me.clicks}</strong><small>클릭 수</small></div><button class="room-code" data-copy="${escapeHtml(room.code)}">${escapeHtml(room.code)}</button><button class="button secondary compact" data-action="back" ${state.busy || !me.canGoBack ? 'disabled' : ''}>← 뒤로가기 (+1)</button><button class="button danger compact" data-action="forfeit" ${state.busy ? 'disabled' : ''}>포기하기</button></div></header><div class="race-grid"><div id="wiki-slot" class="wiki-slot" aria-label="나무위키 원문"></div><aside class="card scoreboard"><div class="score-head"><h2>실시간 순위</h2><p class="muted">${escapeHtml(modeName(room.mode))}${room.mode === 'rounds' ? ` · ${room.round}/${room.totalRounds}` : ''} · ${room.players.length}명</p></div>${playerList(room, true)}</aside></div></main>`;
}

function finishView(room, me) {
  const forfeited = Boolean(me.forfeitedAt);
  const endAt = me.finishedAt || me.forfeitedAt;
  const settled = room.status === 'finished';
  const roundComplete = room.status === 'round_result';
  const host = Boolean(state.session.hostToken);
  return `<main class="shell"><section class="finish"><article class="card finish-card"><span class="finish-icon ${forfeited ? 'forfeited' : ''}">${forfeited ? '⚑' : '★'}</span><p class="eyebrow">${settled ? 'Final results' : roundComplete ? 'Round results' : 'Spectating'}</p><h1>${settled ? '최종 결과가 나왔어요' : roundComplete ? `${room.round}라운드 결과` : forfeited ? '이번 레이스를 포기했어요' : '목표 문서에 도착!'}</h1><p class="muted">${settled || roundComplete ? '자세히보기를 열면 이번 라운드의 이동 경로를 확인할 수 있어요.' : '다른 참가자의 현재 위치와 이미 도착한 참가자의 자세한 경로를 바로 볼 수 있어요.'}</p><div class="finish-stats">${room.mode === 'rounds' ? `<div><strong>${me.score || 0}</strong><small>누적 점수</small></div>` : ''}<div><strong>${me.clicks}</strong><small>클릭</small></div><div><strong>${formatElapsed(room.startedAt, endAt)}</strong><small>${forfeited ? '진행 시간' : '완주 시간'}</small></div></div><div class="player-list">${playerList(room, true)}</div><div class="result-actions">${roundComplete && host ? `<button class="button" data-action="next-round" ${state.busy ? 'disabled' : ''}>다음 라운드 준비</button>` : roundComplete ? '<p class="muted rematch-note">방장이 다음 라운드를 열 때까지 기다리는 중…</p>' : settled && host ? `<button class="button" data-action="rematch" ${state.busy ? 'disabled' : ''}>같은 방에서 다시하기</button>` : settled ? '<p class="muted rematch-note">방장이 다시하기를 누르면 같은 방에서 새 경기를 준비합니다.</p>' : '<p class="muted rematch-note">남은 참가자들의 이동 상황을 기다리는 중…</p>'}<button class="button secondary" data-action="leave">첫 화면으로</button></div></article></section></main>`;
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
  if (me.finishedAt || me.forfeitedAt) {
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
  window.clearInterval(socketHeartbeat);
  socketHeartbeat = null;
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
    socket.onopen = () => {
      state.connection = 'live';
      socket.send('ping');
      socketHeartbeat = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
      }, 2500);
      render();
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'room' && message.room) {
          applyRoom(message.room);
          state.notice = '';
          render();
        }
      } catch {
        // Ignore non-state messages such as pong.
      }
    };
    socket.onerror = () => { state.connection = 'offline'; };
    socket.onclose = () => {
      window.clearInterval(socketHeartbeat);
      socketHeartbeat = null;
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
    const query = new URLSearchParams({ playerId: state.session.playerId, token: state.session.playerToken });
    const data = await request('GET', `/rooms/${state.session.code}?${query}`);
    applyRoom(data.room);
    render();
  } catch (error) {
    state.notice = error instanceof Error ? error.message : '방 정보를 갱신하지 못했어요.';
    render();
  } finally {
    schedulePoll();
  }
}

function leaveRoom() {
  const departing = state.session;
  closeSocket();
  window.clearTimeout(pollTimer);
  localStorage.removeItem(SESSION_KEY);
  state.session = null;
  state.room = null;
  state.notice = '';
  state.restoring = false;
  render();
  if (departing) {
    void request('POST', `/rooms/${departing.code}/action`, {
      action: 'leave',
      playerId: departing.playerId,
      playerToken: departing.playerToken,
    }).catch(() => undefined);
  }
}

document.addEventListener('toggle', (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  const playerId = details.dataset.playerPath;
  if (!playerId) return;
  if (details.open) state.expandedPaths.add(playerId);
  else state.expandedPaths.delete(playerId);
}, true);

document.addEventListener('input', (event) => {
  const field = event.target.dataset?.field;
  if (!field || !(field in state)) return;
  state[field] = event.target.value;
  if (field === 'serverUrl') {
    state.serverUrl = state.serverUrl.trim();
    localStorage.setItem(SERVER_KEY, state.serverUrl);
  }
});

document.addEventListener('change', (event) => {
  const field = event.target.dataset?.field;
  if (field !== 'roundCount') return;
  state.roundCount = Number(event.target.value) || 3;
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
      roundCount: Number(state.roundCount),
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
  if (action === 'forfeit') {
    if (!window.confirm('이번 레이스를 포기할까요? 순위에는 포기로 표시됩니다.')) return;
    return runAction(async () => request('POST', `/rooms/${state.session.code}/action`, {
      action: 'forfeit', playerId: state.session.playerId, playerToken: state.session.playerToken,
    }));
  }
  if (action === 'back') {
    return runAction(async () => request('POST', `/rooms/${state.session.code}/action`, {
      action: 'back', playerId: state.session.playerId, playerToken: state.session.playerToken,
    }));
  }
  if (action === 'next-round') {
    return runAction(async () => request('POST', `/rooms/${state.session.code}/action`, {
      action: 'next-round', hostToken: state.session.hostToken,
    }));
  }
  if (action === 'rematch') {
    return runAction(async () => request('POST', `/rooms/${state.session.code}/action`, {
      action: 'rematch', hostToken: state.session.hostToken,
    }));
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
      const query = new URLSearchParams({ playerId: state.session.playerId, token: state.session.playerToken });
      const data = await request('GET', `/rooms/${state.session.code}?${query}`);
      applyRoom(data.room);
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
