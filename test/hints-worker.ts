// Test-only entry point. Never included in the production Wrangler configuration.
import { RaceRoom as BaseRaceRoom } from '../server/src/index-final-v2';
export { default } from '../server/src/index-final-v2';
export class RaceRoom extends BaseRaceRoom {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === '/__test/presence') {
      const self = this as any;
      const input = await request.json() as any;
      if (input.id) {
        const player = self.room.players.find((p: any) => p.id === input.id);
        player.lastSeenAt = Date.now() - input.age;
        player.disconnectedAt = input.disconnected ? player.lastSeenAt : null;
        await self.persist();
      }
      if (input.alarm) await this.alarm();
      return Response.json(self.room?.players.map((p: any) => ({
        id: p.id, lastSeenAt: p.lastSeenAt, disconnectedAt: p.disconnectedAt,
      })) || []);
    }
    if (new URL(request.url).pathname === '/__test/goal') {
      const self = this as any;
      if (self.room.status !== 'waiting') return new Response('Waiting only',{status:409});
      self.room.goalTitle = await request.text();
      await self.persist(); return new Response('ok');
    }
    if (new URL(request.url).pathname === '/__test/advance-hint') {
      const self = this as any;
      self.room.hint.revealedAt -= 60000;
      await self.persistAndBroadcast();
      return new Response('ok');
    }
    if (new URL(request.url).pathname === '/__test/disconnect') {
      const self = this as any;
      const id = await request.text();
      const player = self.room.players.find((p: any) => p.id === id);
      player.disconnectedAt = player.lastSeenAt = Date.now() - 121000;
      await this.alarm();
      return new Response('ok');
    }
    return super.fetch(request);
  }
}
