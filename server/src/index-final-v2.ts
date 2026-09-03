import baseWorker, { RaceRoom as BaseRaceRoom } from './index';
// @ts-expect-error Shared runtime modules intentionally stay plain ESM for Node tests.
import { dailyRoute } from '../../shared/routes.mjs';
// @ts-expect-error Shared runtime modules intentionally stay plain ESM for Node tests.
import { koreaDateKey } from '../../shared/korea-date.mjs';

interface Env {
  RACE_ROOMS: DurableObjectNamespace<RaceRoom>;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}

function cleanNickname(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 12) : '';
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function createDailyRoom(request: Request, env: Env) {
  let body: { nickname?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: '요청 형식이 올바르지 않아요.' }, 400);
  }
  const nickname = cleanNickname(body.nickname);
  if (nickname.length < 2) return json({ error: '닉네임은 2글자 이상 입력해 주세요.' }, 400);
  const route = dailyRoute(koreaDateKey());
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = makeCode();
    const stub = env.RACE_ROOMS.getByName(code);
    const response = await stub.fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ code, nickname, route }),
    });
    if (response.status !== 409) {
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, { status: response.status, headers });
    }
  }
  return json({ error: '방 코드를 만들지 못했어요. 다시 시도해 주세요.' }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/daily') {
      return json({ route: dailyRoute(koreaDateKey()) });
    }
    if (request.method === 'POST' && url.pathname === '/rooms') {
      const clone = request.clone();
      try {
        const body = await clone.json<{ mode?: string }>();
        if (body.mode === 'daily') return createDailyRoom(request, env);
      } catch {
        return json({ error: '요청 형식이 올바르지 않아요.' }, 400);
      }
    }
    return baseWorker.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;

export class RaceRoom extends BaseRaceRoom {
  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    const validCode = code >= 1000 && code <= 4999 && ![1004, 1005, 1006].includes(code) ? code : 1000;
    socket.close(validCode, reason || '연결이 종료되었습니다.');
  }
}
