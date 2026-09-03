import { DurableObject } from 'cloudflare:workers';
// @ts-expect-error Shared runtime module intentionally stays plain ESM for Node tests.
import { cleanTitle, customRoute, dailyRoute, randomRoute, utcDateKey } from '../../shared/routes.mjs';

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
};

type Room = {
  code: string;
  hostToken: string;
  mode: RaceMode;
  dateKey: string | null;
  status: 'waiting' | 'racing' | 'finished';
  startTitle: string;
  goalTitle: string;
  createdAt: number;
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

function publicRoom(room: Room) {
  return {
    code: room.code,
    mode: room.mode,
    dateKey: room.dateKey,
    status: room.status,
    startTitle: room.startTitle,
    goalTitle: room.goalTitle,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    players: [...room.players]
      .sort((a, b) => {
        if (a.finishedAt && b.finishedAt) return a.finishedAt - b.finishedAt;
        if (a.finishedAt) return -1;
        if (b.finishedAt) return 1;
        return a.joinedAt - b.joinedAt;
      })
      .map(({ token: _token, path: _path, ...player }) => player),
  };
}

function routeFor(mode: RaceMode, startTitle?: unknown, goalTitle?: unknown) {
  if (mode === 'daily') return dailyRoute(utcDateKey());
  if (mode === 'custom') return customRoute(startTitle, goalTitle);
  return randomRoute();
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
        const route = routeFor(mode, body.startTitle, body.goalTitle);
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
    const targetPath = operation === 'room' ? '/room' : `/${operation}`;
    const response = await stub.fetch(new Request(`https://room${targetPath}`, request));
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
      return this.room ? json({ room: publicRoom(this.room) }) : json({ error: '방을 찾을 수 없어요.' }, 404);
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
    };
    this.room = {
      code,
      hostToken: crypto.randomUUID(),
      mode: route.mode,
      dateKey: route.dateKey,
      status: 'waiting',
      startTitle: route.startTitle,
      goalTitle: route.goalTitle,
      createdAt: now,
      startedAt: null,
      players: [player],
    };
    await this.persist();
    await this.ctx.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
    return json({
      room: publicRoom(this.room),
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
    };
    this.room.players.push(player);
    await this.persistAndBroadcast();
    return json({ room: publicRoom(this.room), session: { code: this.room.code, playerId: player.id, playerToken: player.token } });
  }

  private async action(payload: ActionPayload) {
    if (!this.room) return json({ error: '방을 찾을 수 없어요.' }, 404);
    if (payload.action === 'ready') {
      const player = this.findPlayer(payload);
      if (!player) return json({ error: '참가자 정보를 확인할 수 없어요.' }, 401);
      player.ready = !player.ready;
      await this.persistAndBroadcast();
      return json({ room: publicRoom(this.room) });
    }
    if (payload.action === 'start') {
      if (payload.hostToken !== this.room.hostToken) return json({ error: '방장만 시작할 수 있어요.' }, 403);
      if (!this.room.players.every((player) => player.ready)) return json({ error: '모든 참가자가 준비해야 시작할 수 있어요.' }, 409);
      this.room.status = 'racing';
      this.room.startedAt = Date.now();
      for (const player of this.room.players) {
        player.clicks = 0;
        player.currentTitle = this.room.startTitle;
        player.path = [this.room.startTitle];
        player.finishedAt = null;
      }
      await this.persistAndBroadcast();
      return json({ room: publicRoom(this.room) });
    }
    if (payload.action === 'progress') {
      if (this.room.status !== 'racing') return json({ error: '진행 중인 게임이 아니에요.' }, 409);
      const player = this.findPlayer(payload);
      if (!player) return json({ error: '참가자 정보를 확인할 수 없어요.' }, 401);
      if (player.finishedAt) return json({ error: '이미 도착했어요.' }, 409);
      const nextTitle = cleanTitle(payload.nextTitle);
      if (!nextTitle || nextTitle === player.currentTitle) return json({ error: '이동할 문서를 확인해 주세요.' }, 409);
      player.currentTitle = nextTitle;
      player.clicks += 1;
      player.path = [...player.path, nextTitle].slice(-80);
      if (nextTitle === this.room.goalTitle) player.finishedAt = Date.now();
      if (this.room.players.every((item) => item.finishedAt)) this.room.status = 'finished';
      await this.persistAndBroadcast();
      return json({ room: publicRoom(this.room) });
    }
    return json({ error: '지원하지 않는 요청이에요.' }, 400);
  }

  private async connectSocket(url: URL) {
    if (!this.room) return json({ error: '방을 찾을 수 없어요.' }, 404);
    const playerId = url.searchParams.get('playerId');
    const token = url.searchParams.get('token');
    const player = this.room.players.find((item) => item.id === playerId && item.token === token);
    if (!player) return json({ error: '참가자 정보를 확인할 수 없어요.' }, 401);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.serializeAttachment({ playerId: player.id });
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'room', room: publicRoom(this.room) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') socket.send('pong');
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
  }

  async alarm() {
    for (const socket of this.ctx.getWebSockets()) socket.close(1001, '방이 만료되었습니다.');
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  private findPlayer(payload: ActionPayload) {
    return this.room?.players.find((player) => player.id === payload.playerId && player.token === payload.playerToken);
  }

  private async persist() {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  private async persistAndBroadcast() {
    await this.persist();
    if (!this.room) return;
    const message = JSON.stringify({ type: 'room', room: publicRoom(this.room) });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Closed sockets are discarded by the runtime.
      }
    }
  }
}
