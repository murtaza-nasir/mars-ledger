// Fly over Mars (experimental): the relay between a phone flying the TV camera and the TVs. Nothing is stored. The
// latest phone to start flies (a clear takeover: everyone hears who it is); only its stick packets reach the TVs, at
// most FLY_MAX_HZ a second; the TVs report whether they can fly, which every phone hears.
import type {GameState} from '../shared/game';
import {FLY_MAX_HZ, unpackFly} from '../shared/fly';
import type {FlyStatus, FlyTvState} from '../shared/fly';

export type FlyOp = 'start' | 'input' | 'stop';
export type FlyRelayOut = {op: FlyOp; from: {id: string; name: string; color: string}; i?: number[]};

const RANK: Record<FlyTvState, number> = {off: 0, ready: 1, flying: 2};

export class FlyRelay {
  /** the seat whose phone flies now */
  pilot: string | null = null;
  /** the pilot's socket: a second phone of the same seat takes over by starting, like anyone else */
  private pilotSock: unknown = null;
  private tvs = new Map<unknown, FlyTvState>();
  private rate = {at: 0, n: 0};

  status(): FlyStatus {
    let tv: FlyTvState = 'off';
    for (const s of this.tvs.values()) if (RANK[s] > RANK[tv]) tv = s;
    return {tv, pilot: this.pilot};
  }

  /** A TV says what it can do; when no TV flies any more, the phone's flight is over. Returns whether the status changed. */
  tvReport(sock: unknown, state: unknown, pilot: unknown): boolean {
    if (state !== 'off' && state !== 'ready' && state !== 'flying') return false;
    const before = JSON.stringify(this.status());
    this.tvs.set(sock, state);
    // a TV that stopped flying the phone's flight (Esc, a minute idle, a tile placement) ends it for the phone too
    if (this.pilot && (![...this.tvs.values()].includes('flying') || (state === 'flying' && pilot === null))) { this.pilot = null; this.pilotSock = null; }
    return JSON.stringify(this.status()) !== before;
  }

  /** A socket went away (a TV, or the pilot's phone). Returns whether the status changed. */
  forget(sock: unknown): boolean {
    const before = JSON.stringify(this.status());
    this.tvs.delete(sock);
    if (this.pilotSock === sock) { this.pilot = null; this.pilotSock = null; this.rate = {at: 0, n: 0}; }
    return JSON.stringify(this.status()) !== before;
  }

  /**
   * A phone's message: only a seated player, only as itself. `relay` goes to the TVs; `changed` means the status
   * (who flies) changed and every phone should hear it.
   */
  phone(sock: unknown, state: GameState, speaker: string | null, msg: {playerId?: unknown; op?: unknown; i?: unknown}, now: number):
    {relay?: FlyRelayOut; changed: boolean; error?: string} {
    const p = state.players.find((x) => x.id === msg.playerId);
    if (!p || p.bot) return {changed: false, error: 'Only players at the table can fly the camera'};
    if (speaker !== null && speaker !== p.id) return {changed: false, error: 'A phone can only fly as its own player'};
    const from = {id: p.id, name: p.name, color: p.color};
    if (msg.op === 'start') {
      if (this.status().tv === 'off') return {changed: false, error: 'Flying is off on the TV'};
      const changed = this.pilot !== p.id;
      this.pilot = p.id;
      this.pilotSock = sock;
      this.rate = {at: 0, n: 0};
      return {relay: {op: 'start', from}, changed};
    }
    if (msg.op === 'stop') {
      if (this.pilotSock !== sock) return {changed: false};
      this.pilot = null;
      this.pilotSock = null;
      return {relay: {op: 'stop', from}, changed: true};
    }
    if (msg.op === 'input') {
      if (this.pilotSock !== sock) return {changed: false};
      const i = unpackFly(msg.i);
      if (!i) return {changed: false};
      // at most FLY_MAX_HZ packets a second from the pilot
      const r = this.rate;
      if (now - r.at >= 1000) { r.at = now; r.n = 0; }
      if (++r.n > FLY_MAX_HZ) return {changed: false};
      return {relay: {op: 'input', from, i: msg.i as number[]}, changed: false};
    }
    return {changed: false};
  }
}
