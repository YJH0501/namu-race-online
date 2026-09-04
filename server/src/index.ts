import { DurableObject } from 'cloudflare:workers';
// @ts-expect-error Shared runtime module intentionally stays plain ESM for Node tests.
import { cleanTitle, customRoute, dailyRoute, randomRoute, utcDateKey } from '../../shared/routes.mjs';
// @ts-expect-error Generated title snapshot intentionally stays plain ESM.
import { RANDOM_TITLE_POOL } from '../../shared/random-title-pool.mjs';

interface Env {
  RACE_ROOMS: DurableObjectNamespace<RaceRoom>;
}

type RaceMode = 'daily' | 'random' | 'custom';

type Player = {
  id: string;
  nickname: string;
  token: string;
  ready: boolean;
  clicks: number;
  currentTitle: string;
  path: string[];
  joinedAt: number;
  finishedAt: number | null;
  forfeitedAt: number | null;
  disconnectedAt?: number | null;
  lastSeenAt?: number | null;
};

type Room = {
  code: string;
  hostToken: string;
  hostPlayerId: string;
  mode: RaceMode;
  dateKey: string | null;
  status: 'waiting' | 'racing' | 'finished';
  startTitle: string;
  goalTitle: string;
  round: number;
  recentRouteTitles?: string[];
  createdAt: number;
  expiresAt?: number;
  startedAt: number | null;
  players: Player[];
};

type ActionPayload = {
  action?: string;
  nickname?: string;
  playerId?: string;
  playerToken?: string;
  hostToken?: string;
  nextTitle?: string;
};

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const ROOM_LIFETIME_MS = 6 * 60 * 60 * 1000;
const DISCONNECT_GRACE_MS = 5_000;
const PRESENCE_TIMEOUT_MS = 8_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    return await request.json<T>();
  } catch {
    throw new Error('요청 형식이 올바르지 않아요.');
  }
}

function cleanNickname(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 12) : '';
}

function cleanCode(value: unknown) {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

const recentRandomTitles: string[] = [];
const RECENT_RANDOM_LIMIT = 240;

function randomIndex(length: number) {
  if (length <= 1) return 0;
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return value % length;
}

function rememberRandomTitles(titles: string[]) {
  for (const title of titles) {
    const previousIndex = recentRandomTitles.indexOf(title);
    if (previousIndex >= 0) recentRandomTitles.splice(previousIndex, 1);
    recentRandomTitles.push(title);
  }
  if (recentRandomTitles.length > RECENT_RANDOM_LIMIT) {
    recentRandomTitles.splice(0, recentRandomTitles.length - RECENT_RANDOM_LIMIT);
  }
}

function routeFromCandidates(candidates: readonly string[]) {
  if (candidates.length < 2) return null;
  const firstIndex = randomIndex(candidates.length);
  let secondIndex = randomIndex(candidates.length - 1);
  if (secondIndex >= firstIndex) secondIndex += 1;
  const startTitle = candidates[firstIndex];
  const goalTitle = candidates[secondIndex];
  rememberRandomTitles([startTitle, goalTitle]);
  return { mode: 'random' as const, dateKey: null, startTitle, goalTitle };
}

async function randomNamuWikiRoute(excludedTitles: string[] = []) {
  const excluded = new Set([...recentRandomTitles, ...excludedTitles]);
  const candidates = (RANDOM_TITLE_POOL as readonly string[]).filter(
    (title) => !excluded.has(title),
  );
  const snapshotRoute = routeFromCandidates(candidates);
  if (snapshotRoute) return snapshotRoute;

  const emergencyRoute = randomRoute();
  rememberRandomTitles([emergencyRoute.startTitle, emergencyRoute.goalTitle]);
  return emergencyRoute;
}

function publicRoom(room: Room, viewerPlayerId?: string | null) {
  const viewer = room.players.find((player) => player.id === viewerPlayerId);
  const viewerCanSpectate = Boolean(viewer?.finishedAt || viewer?.forfeitedAt);
  const hideRandomRoute = room.mode === 'random' && room.status === 'waiting';
  return {
    code: room.code,
    hostPlayerId: room.hostPlayerId,
    ...(viewerPlayerId === room.hostPlayerId
      ? { hostToken: room.hostToken }
      : {}),
    mode: room.mode,
    dateKey: room.dateKey,
    status: room.status,
    startTitle: hideRandomRoute ? null : room.startTitle,
    goalTitle: hideRandomRoute ? null : room.goalTitle,
    routeHidden: hideRandomRoute,
    round: room.round || 1,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    players: [...room.players]
      .sort((a, b) => {
        if (a.finishedAt && b.finishedAt) return a.finishedAt - b.finishedAt;
        if (a.finishedAt) return -1;
        if (b.finishedAt) return 1;
        if (a.forfeitedAt && b.forfeitedAt) return a.forfeitedAt - b.forfeitedAt;
        if (a.forfeitedAt) return 1;
        if (b.forfeitedAt) return -1;
        return a.joinedAt - b.joinedAt;
      })
      .map(({ token: _token, path, currentTitle, disconnectedAt: _disconnectedAt, lastSeenAt: _lastSeenAt, ...player }) => {
        const canSeePosition =
          room.status === 'finished' || player.id === viewerPlayerId || viewerCanSpectate;
        const canSeePath =
          room.status === 'finished' ||
          (viewerCanSpectate &&
            (player.id === viewerPlayerId || Boolean(player.finishedAt)));
        return {
          ...player,
          currentTitle: canSeePosition ? currentTitle : null,
          ...(canSeePath ? { path } : {}),
        };
      }),
  };
}

async function routeFor(mode: RaceMode, startTitle?: unknown, goalTitle?: unknown) {
  if (mode === 'daily') return dailyRoute(utcDateKey());
  if (mode === 'custom') return customRoute(startTitle, goalTitle);
  return randomNamuWikiRoute();
}

async function roomStub(env: Env, code: string) {
  return env.RACE_ROOMS.getByName(code);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    if (request.method === 'GET' && url.pathname === '/health') {
      return withCors(json({ ok: true, service: 'namu-race-online', date: utcDateKey() }));
    }
    if (request.method === 'GET' && url.pathname === '/daily') {
      return withCors(json({ route: dailyRoute(utcDateKey()) }));
    }
    if (request.method === 'POST' && url.pathname === '/rooms') {
      try {
        const body = await readBody<{ nickname?: unknown; mode?: RaceMode; startTitle?: unknown; goalTitle?: unknown }>(request);
        const nickname = cleanNickname(body.nickname);
        if (nickname.length < 2) return withCors(json({ error: '닉네임은 2글자 이상 입력해 주세요.' }, 400));
        const mode: RaceMode = ['daily', 'random', 'custom'].includes(body.mode || '') ? body.mode! : 'random';
        const route = await routeFor(mode, body.startTitle, body.goalTitle);
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const code = makeCode();
          const stub = await roomStub(env, code);
          const response = await stub.fetch('https://room/init', {
            method: 'POST',
            body: JSON.stringify({ code, nickname, route }),
          });
          if (response.status !== 409) return withCors(response);
        }
        return withCors(json({ error: '방 코드를 만들지 못했어요. 다시 시도해 주세요.' }, 503));
      } catch (error) {
        return withCors(json({ error: error instanceof Error ? error.message : '방을 만들지 못했어요.' }, 400));
      }
    }

    const match = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})(?:\/(join|action|ws))?$/i);
    if (!match) return withCors(json({ error: '지원하지 않는 요청이에요.' }, 404));
    const code = cleanCode(match[1]);
    const operation = match[2] || 'room';
    const stub = await roomStub(env, code);
    if (operation === 'ws') {
      const target = new URL('https://room/ws');
      target.search = url.search;
      return stub.fetch(new Request(target, request));
    }
    const target = new URL(`https://room${operation === 'room' ? '/room' : `/${operation}`}`);
    target.search = url.search;
    const response = await stub.fetch(new Request(target, request));
    return withCors(response);
  },
} satisfies ExportedHandler<Env>;

export class RaceRoom extends DurableObject<Env> {
  private room: Room | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get<Room>('room')) || null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/init') return this.initialize(await readBody(request));
    if (request.method === 'POST' && url.pathname === '/join') return this.join(await readBody(request));
    if (request.method === 'POST' && url.pathname === '/action') return this.action(await readBody(request));
    if (request.method === 'GET' && url.pathname === '/room') {
      if (!this.room) return json({ error: '방을 찾을 수 없어요.' }, 404);
      const viewer = this.playerFromUrl(url);
      return json({ room: publicRoom(this.room, viewer?.id) });
    }
    if (request.method === 'GET' && url.pathname === '/ws') return this.connectSocket(url);
    return json({ error: '지원하지 않는 요청이에요.' }, 404);
  }

  private async initialize(payload: { code?: unknown; nickname?: unknown; route?: ReturnType<typeof dailyRoute> }) {
    if (this.room) return json({ error: '이미 사용 중인 방 코드예요.' }, 409);
    const code = cleanCode(payload.code);
    const nickname = cleanNickname(payload.nickname);
    const route = payload.route;
    if (code.length !== 6 || nickname.length < 2 || !route) return json({ error: '방 설정이 올바르지 않아요.' }, 400);
    const now = Date.now();
    const player: Player = {
      id: crypto.randomUUID(),
      nickname,
      token: crypto.randomUUID(),
      ready: true,
      clicks: 0,
      currentTitle: route.startTitle,
      path: [route.startTitle],
      joinedAt: now,
      finishedAt: null,
      forfeitedAt: null,
    };
    this.room = {
      code,
      hostToken: crypto.randomUUID(),
      hostPlayerId: player.id,
      mode: route.mode,
      dateKey: route.dateKey,
      status: 'waiting',
      startTitle: route.startTitle,
      goalTitle: route.goalTitle,
      round: 1,
      recentRouteTitles: route.mode === 'random' ? [route.startTitle, route.goalTitle] : [],
      createdAt: now,
      expiresAt: now + ROOM_LIFETIME_MS,
      startedAt: null,
      players: [player],
    };
    await this.persist();
    await this.scheduleAlarm();
    return json({
      room: publicRoom(this.room, player.id),
      session: { code, playerId: player.id, playerToken: player.token, hostToken: this.room.hostToken },
    });
  }

  private async join(payload: { nickname?: unknown }) {
    if (!this.room) return json({ error: '방을 찾을 수 없어요.' }, 404);
    if (this.room.status !== 'waiting') return json({ error: '이미 게임이 시작된 방이에요.' }, 409);
    const nickname = cleanNickname(payload.nickname);
    if (nickname.length < 2) return json({ error: '닉네임은 2글자 이상 입력해 주세요.' }, 400);
    if (this.room.players.length >= 8) return json({ error: '방이 가득 찼어요.' }, 409);
    if (this.room.players.some((player) => player.nickname === nickname)) return json({ error: '같은 닉네임을 사용하는 참가자가 있어요.' }, 409);
    const player: Player = {
      id: crypto.randomUUID(),
      nickname,
      token: crypto.randomUUID(),
      ready: false,
      clicks: 0,
      currentTitle: this.room.startTitle,
      path: [this.room.startTitle],
      joinedAt: Date.now(),
      finishedAt: null,
      forfeitedAt: null,
    };
    this.room.players.push(player);
    await this.persistAndBroadcast();
    return json({ room: publicRoom(this.room, player.id), session: { code: this.room.code, playerId: player.id, playerToken: player.token } });
  }

  private async action(payload: ActionPayload) {
    if (!this.room) return json({ error: '방을 찾을 수 없어요.' }, 404);
    if (payload.action === 'leave') {
      const player = this.findPlayer(payload);
      if (!player) return json({ error: '참가자 정보를 확인할 수 없어요.' }, 401);
      const wasHost = player.id === this.room.hostPlayerId;
      this.room.players = this.room.players.filter((item) => item.id !== player.id);

      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
        if (attachment?.playerId === player.id) socket.close(1000, '방에서 나갔습니다.');
      }

      if (this.room.players.length === 0) {
        await this.ctx.storage.deleteAll();
        this.room = null;
        return json({ left: true });
      }

      if (wasHost) {
        this.room.hostPlayerId = this.room.players[0].id;
        this.room.hostToken = crypto.randomUUID();
      }
      if (
        this.room.status === 'racing' &&
        this.room.players.every((item) => item.finishedAt || item.forfeitedAt)
      ) {
        this.room.status = 'finished';
      }
      await this.persistAndBroadcast();
      await this.scheduleAlarm();
      return json({ left: true });
    }
    if (payload.action === 'ready') {
      if (this.room.status !== 'waiting') return json({ error: '대기실에서만 준비 상태를 바꿀 수 있어요.' }, 409);
      const player = this.findPlayer(payload);
      if (!player) return json({ error: '참가자 정보를 확인할 수 없어요.' }, 401);
      player.ready = !player.ready;
      await this.persistAndBroadcast();
      return json({ room: publicRoom(this.room, player.id) });
    }
    if (payload.action === 'start') {
      if (payload.hostToken !== this.room.hostToken) return json({ error: '방장만 시작할 수 있어요.' }, 403);
      if (this.room.status !== 'waiting') return json({ error: '대기 중인 방만 시작할 수 있어요.' }, 409);
      if (!this.room.players.every((player) => player.ready)) return json({ error: '모든 참가자가 준비해야 시작할 수 있어요.' }, 409);
      this.room.status = 'racing';
      this.room.startedAt = Date.now();
      for (const player of this.room.players) {
        player.clicks = 0;
        player.currentTitle = this.room.startTitle;
        player.path = [this.room.startTitle];
        player.finishedAt = null;
        player.forfeitedAt = null;
      }
      await this.persistAndBroadcast();
      return json({ room: publicRoom(this.room, this.hostPlayerId()) });
    }
    if (payload.action === 'progress') {
      if (this.room.status !== 'racing') return json({ error: '진행 중인 게임이 아니에요.' }, 409);
      const player = this.findPlayer(payload);
      if (!player) return json({ error: '참가자 정보를 확인할 수 없어요.' }, 401);
      if (player.finishedAt) return json({ error: '이미 도착했어요.' }, 409);
      if (player.forfeitedAt) return json({ error: '이미 포기한 레이스예요.' }, 409);
      const nextTitle = cleanTitle(payload.nextTitle);
      if (!nextTitle || nextTitle === player.currentTitle) return json({ error: '이동할 문서를 확인해 주세요.' }, 409);
      player.currentTitle = nextTitle;
      player.clicks += 1;
      if (player.path.length < 500) player.path.push(nextTitle);
      if (nextTitle === this.room.goalTitle) player.finishedAt = Date.now();
      if (this.room.players.every((item) => item.finishedAt || item.forfeitedAt)) this.room.status = 'finished';
      await this.persistAndBroadcast();
      return json({ room: publicRoom(this.room, player.id) });
    }
    if (payload.action === 'forfeit') {
      if (this.room.status !== 'racing') return json({ error: '진행 중인 게임이 아니에요.' }, 409);
      const player = this.findPlayer(payload);
      if (!player) return json({ error: '참가자 정보를 확인할 수 없어요.' }, 401);
      if (player.finishedAt) return json({ error: '이미 도착했어요.' }, 409);
      if (player.forfeitedAt) return json({ room: publicRoom(this.room, player.id) });
      player.forfeitedAt = Date.now();
      if (this.room.players.every((item) => item.finishedAt || item.forfeitedAt)) this.room.status = 'finished';
      await this.persistAndBroadcast();
      return json({ room: publicRoom(this.room, player.id) });
    }
    if (payload.action === 'rematch') {
      if (payload.hostToken !== this.room.hostToken) return json({ error: '방장만 다시 시작할 수 있어요.' }, 403);
      if (this.room.status !== 'finished') return json({ error: '모든 참가자의 결과가 확정된 뒤 다시 할 수 있어요.' }, 409);
      if (this.room.mode === 'random') {
        const route = await randomNamuWikiRoute(this.room.recentRouteTitles || []);
        this.room.startTitle = route.startTitle;
        this.room.goalTitle = route.goalTitle;
        this.room.recentRouteTitles = [
          ...(this.room.recentRouteTitles || []),
          route.startTitle,
          route.goalTitle,
        ].slice(-80);
      }
      this.room.status = 'waiting';
      this.room.startedAt = null;
      this.room.round = (this.room.round || 1) + 1;
      const hostPlayerId = this.hostPlayerId();
      for (const player of this.room.players) {
        player.ready = player.id === hostPlayerId;
        player.clicks = 0;
        player.currentTitle = this.room.startTitle;
        player.path = [this.room.startTitle];
        player.finishedAt = null;
        player.forfeitedAt = null;
      }
      await this.persistAndBroadcast();
      return json({ room: publicRoom(this.room, hostPlayerId) });
    }
    return json({ error: '지원하지 않는 요청이에요.' }, 400);
  }

  private async connectSocket(url: URL) {
    if (!this.room) return json({ error: '방을 찾을 수 없어요.' }, 404);
    const playerId = url.searchParams.get('playerId');
    const token = url.searchParams.get('token');
    const player = this.room.players.find((item) => item.id === playerId && item.token === token);
    if (!player) return json({ error: '참가자 정보를 확인할 수 없어요.' }, 401);
    if (player.disconnectedAt) {
      player.disconnectedAt = null;
    }
    player.lastSeenAt = Date.now();
    await this.persistAndBroadcast();
    await this.scheduleAlarm();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.serializeAttachment({ playerId: player.id });
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'room', room: publicRoom(this.room, player.id) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message !== 'ping') return;
    const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
    const player = this.room?.players.find((item) => item.id === attachment?.playerId);
    if (player) {
      player.lastSeenAt = Date.now();
      player.disconnectedAt = null;
      await this.persist();
      await this.scheduleAlarm();
    }
    socket.send('pong');
  }

  async webSocketClose(socket: WebSocket, _code: number, _reason: string) {
    await this.markDisconnected(socket);
  }

  async webSocketError(socket: WebSocket) {
    await this.markDisconnected(socket);
  }

  private async markDisconnected(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
    if (!this.room || !attachment?.playerId) return;
    const hasAnotherSocket = this.ctx.getWebSockets().some((candidate) => {
      if (candidate === socket) return false;
      const other = candidate.deserializeAttachment() as { playerId?: string } | null;
      return other?.playerId === attachment.playerId;
    });
    if (hasAnotherSocket) return;
    const player = this.room.players.find((item) => item.id === attachment.playerId);
    if (!player) return;
    player.disconnectedAt = Date.now();
    await this.persistAndBroadcast();
    await this.scheduleAlarm();
  }

  async alarm() {
    if (!this.room) return;
    const now = Date.now();
    const expiresAt = this.room.expiresAt || this.room.createdAt + ROOM_LIFETIME_MS;
    if (now >= expiresAt) {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, '방이 만료되었습니다.');
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }

    const leavingIds = new Set(
      this.room.players
        .filter(
          (player) =>
            (player.disconnectedAt &&
              player.disconnectedAt + DISCONNECT_GRACE_MS <= now) ||
            (player.lastSeenAt &&
              player.lastSeenAt + PRESENCE_TIMEOUT_MS <= now),
        )
        .map((player) => player.id),
    );
    if (leavingIds.size) {
      const hostLeft = leavingIds.has(this.room.hostPlayerId);
      this.room.players = this.room.players.filter(
        (player) => !leavingIds.has(player.id),
      );
      if (!this.room.players.length) {
        await this.ctx.storage.deleteAll();
        this.room = null;
        return;
      }
      if (hostLeft) {
        this.room.hostPlayerId = this.room.players[0].id;
        this.room.hostToken = crypto.randomUUID();
      }
      if (
        this.room.status === 'racing' &&
        this.room.players.every((item) => item.finishedAt || item.forfeitedAt)
      ) {
        this.room.status = 'finished';
      }
      await this.persistAndBroadcast();
    }
    await this.scheduleAlarm();
  }

  private findPlayer(payload: ActionPayload) {
    return this.room?.players.find((player) => player.id === payload.playerId && player.token === payload.playerToken);
  }

  private playerFromUrl(url: URL) {
    const playerId = url.searchParams.get('playerId');
    const token = url.searchParams.get('token');
    return this.room?.players.find((player) => player.id === playerId && player.token === token);
  }

  private hostPlayerId() {
    if (!this.room) return '';
    return this.room.hostPlayerId || this.room.players[0]?.id || '';
  }

  private async persist() {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  private async scheduleAlarm() {
    if (!this.room) return;
    const expiresAt = this.room.expiresAt || this.room.createdAt + ROOM_LIFETIME_MS;
    const disconnectDeadlines = this.room.players
      .map((player) =>
        player.disconnectedAt
          ? player.disconnectedAt + DISCONNECT_GRACE_MS
          : player.lastSeenAt
            ? player.lastSeenAt + PRESENCE_TIMEOUT_MS
            : Number.POSITIVE_INFINITY,
      );
    await this.ctx.storage.setAlarm(Math.min(expiresAt, ...disconnectDeadlines));
  }

  private async persistAndBroadcast() {
    await this.persist();
    if (!this.room) return;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
        if (!this.room.players.some((player) => player.id === attachment?.playerId)) {
          socket.close(1000, '방에서 나갔습니다.');
          continue;
        }
        socket.send(JSON.stringify({ type: 'room', room: publicRoom(this.room, attachment?.playerId) }));
      } catch {
        // Closed sockets are discarded by the runtime.
      }
    }
  }
}
