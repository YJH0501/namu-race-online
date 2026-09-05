// Test-only entry point. Never included in the production Wrangler configuration.
import { RaceRoom as BaseRaceRoom } from '../server/src/index-final-v2';
export { default } from '../server/src/index-final-v2';
export class RaceRoom extends BaseRaceRoom {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === '/__test/advance-hint') {
      const self = this as any;
      self.room.hint.revealedAt -= 60000;
      await self.persistAndBroadcast();
      return new Response('ok');
    }
    if (new URL(request.url).pathname === '/__test/disconnect') {
      const self = this as any;
      const id = await request.text();
      self.room.players.find((p: any) => p.id === id).disconnectedAt = Date.now() - 10000;
      await this.alarm();
      return new Response('ok');
    }
    return super.fetch(request);
  }
}
