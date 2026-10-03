import {describe, expect, it} from 'vitest';
import Fastify from 'fastify';
import {DatabaseSync} from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {cleanSession, deviceLine, estimateRefresh, frameStats, headlines, median, quantile, type PerfInteraction, type PerfSession} from '../src/shared/perf';
import {buildInteraction, DeltaHistogram, FrameRing, MarkBook} from '../src/client/perf/core';
import {registerPerf} from '../src/server/perf';

const at60 = 1000 / 60, at120 = 1000 / 120;

describe('perf: frame statistics', () => {
  it('nearest-rank quantiles and the median', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(s, 0.5)).toBe(5);
    expect(quantile(s, 0.95)).toBe(10);
    expect(quantile(s, 0.9)).toBe(9);
    expect(quantile([], 0.5)).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('estimates the refresh rate from the median delta, at 60 and 120 Hz, despite stutters', () => {
    const jitter = (base: number, n: number) => Array.from({length: n}, (_, i) => base + ((i * 7) % 5 - 2) * 0.15);
    expect(estimateRefresh(jitter(at60, 200)).hz).toBe(60);
    expect(estimateRefresh(jitter(at120, 200)).hz).toBe(120);
    // a third of the frames dropped at 120 Hz still reads as 120 Hz
    expect(estimateRefresh([...jitter(at120, 200), ...Array(90).fill(25)]).hz).toBe(120);
    expect(estimateRefresh(jitter(at120, 200)).intervalMs).toBeCloseTo(8.333, 2);
    expect(estimateRefresh([]).hz).toBe(60);
    // 100 Hz and odd rates are not forced onto 120
    expect(estimateRefresh(Array(50).fill(10)).hz).toBe(100);
  });

  it('counts dropped frames against the device interval (1.5x), so a 16.7 ms frame is a drop at 120 Hz but not at 60 Hz', () => {
    // 13 ms at 120 Hz is 1.56 intervals: a drop
    const deltas = [at120, at120, 16.7, at120, 25, at120, 13, 12];
    const s120 = frameStats(deltas, at120);
    expect(s120.frames).toBe(8);
    expect(s120.dropped).toBe(3);
    expect(s120.missed).toBe(1 + 2 + 1);
    const s60 = frameStats([at60, at60, 16.7, 40, 60], at60);
    expect(s60.dropped).toBe(2);
    expect(s60.missed).toBe(1 + 3);
    expect(s60.over33).toBe(2);
    expect(s60.over50).toBe(1);
    expect(s60.max).toBe(60);
  });

  it('p50, p95 and max of a run', () => {
    const deltas = [...Array(95).fill(at60), 20, 30, 40, 50, 100];
    const st = frameStats(deltas, at60);
    expect(st.p50).toBe(16.7);
    expect(st.p95).toBe(16.7);
    expect(st.max).toBe(100);
    expect(st.over50).toBe(1);
    expect(st.over33).toBe(3);
    expect(frameStats([], at60)).toEqual({frames: 0, dropped: 0, missed: 0, p50: 0, p95: 0, max: 0, over33: 0, over50: 0});
  });

  it('the session histogram agrees with the exact statistics', () => {
    const h = new DeltaHistogram();
    const deltas = [...Array(500).fill(at120), ...Array(40).fill(at60), 34, 52, 300];
    for (const d of deltas) h.add(d);
    const exact = frameStats(deltas, at120), approx = h.stats(at120);
    expect(approx.frames).toBe(exact.frames);
    expect(approx.dropped).toBe(exact.dropped);
    expect(approx.over33).toBe(exact.over33);
    expect(approx.over50).toBe(exact.over50);
    expect(approx.max).toBe(300);
    expect(Math.abs(approx.p50 - exact.p50)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(approx.p95 - exact.p95)).toBeLessThanOrEqual(0.5);
    expect(estimateRefresh([h.median()]).hz).toBe(120);
  });

  it('headlines per interaction type: median p95, dropped and renders per interaction', () => {
    const mk = (name: PerfInteraction['name'], p95: number, dropped: number, renders: Record<string, number>): PerfInteraction =>
      ({name, start: 0, dur: 300, stats: {...frameStats([at60], at60), p95, dropped}, renders, longTasks: null, deltas: []});
    const h = headlines([mk('swipe', 10, 2, {Viewer: 2, LiftedFace: 6}), mk('swipe', 20, 0, {Viewer: 2}), mk('swipe', 30, 1, {}), mk('open', 12, 0, {Deck: 1})]);
    expect(h.map((x) => x.name)).toEqual(['open', 'swipe']);
    const sw = h.find((x) => x.name === 'swipe')!;
    expect(sw.count).toBe(3);
    expect(sw.p95).toBe(20);
    expect(sw.droppedPer).toBe(1);
    expect(sw.rendersPer).toEqual({Viewer: 1.3, LiftedFace: 2});
    expect(sw.rendersTotalPer).toBe(3.3);
  });

  it('a short device line from the user agent', () => {
    expect(deviceLine('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1')).toBe('iPhone · iOS 18.6 · Safari');
    expect(deviceLine('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · iOS 17.5 · Chrome');
    expect(deviceLine('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36')).toBe('Android 14 · Chrome');
  });
});

describe('perf: recorder bookkeeping', () => {
  it('the frame ring returns the deltas of frames inside a window, across wrap-around', () => {
    const r = new FrameRing(8);
    for (let i = 1; i <= 20; i++) r.push(i * 10, i);
    expect(r.length).toBe(8);
    expect(r.between(150, 180)).toEqual([16, 17, 18]);
    expect(r.between(0, 120)).toEqual([]); // overwritten
    expect(r.recent(3)).toEqual([18, 19, 20]);
  });

  it('pairs marks: drag start and the move it triggers are one swipe; ends without a start are ignored; stale ones dropped', () => {
    const b = new MarkBook(8000, 1000);
    b.start('swipe', 100, {Viewer: 5});
    b.start('swipe', 400, {Viewer: 6}); // the move after the drag: same swipe
    const r = b.end('swipe', 650, {Viewer: 8, LiftedFace: 3});
    expect(r).toEqual({start: 100, renders: {Viewer: 3, LiftedFace: 3}});
    expect(b.end('swipe', 700, {})).toBeNull();
    // an end that never came: a start 1 s later replaces it
    b.start('tab', 1000, {});
    b.start('tab', 2500, {});
    expect(b.end('tab', 2600, {})?.start).toBe(2500);
    // longer than the stale limit: dropped
    b.start('open', 0, {});
    expect(b.end('open', 9000, {})).toBeNull();
  });

  it('builds an interaction record relative to the session start', () => {
    const i = buildInteraction('swipe', 1100, 1400, [at120, at120, 30.04], at120, {Viewer: 1}, null, 1000);
    expect(i.start).toBe(100);
    expect(i.dur).toBe(300);
    expect(i.stats.dropped).toBe(1);
    expect(i.deltas).toEqual([8.3, 8.3, 30]);
    expect(i.longTasks).toBeNull();
  });
});

// ---- endpoints ------------------------------------------------------------------------------------------------

function session(id: string, o: Partial<PerfSession> = {}): PerfSession {
  return {id, startedAt: 1_700_000_000_000, sentAt: 1_700_000_060_000, duration: 60000, label: 'before',
    device: {ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Safari/604.1', dpr: 3, screen: {w: 390, h: 844}, viewport: {w: 390, h: 664},
      refreshHz: 60, build: 'abc1234-20261001T1200', ios: true, standalone: false, longTaskSupported: false},
    overall: frameStats([at60, at60, 40], at60),
    interactions: [buildInteraction('swipe', 0, 300, [at60, at60, 40], at60, {Viewer: 2, LiftedFace: 3}, null, 0),
      buildInteraction('open', 400, 650, [at60, at60], at60, {Deck: 1}, null, 0)], ...o};
}

async function server(o: {maxSessions?: number; maxVideoBytes?: number; maxVideos?: number} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-perf-'));
  const db = new DatabaseSync(path.join(dir, 'tm.db'));
  const app = Fastify();
  const desk = await registerPerf(app, {db, dataDir: dir, ...o});
  await app.ready();
  return {app, dir, desk};
}

function multipart(file: {name: string; type: string; data: Buffer} | null, fields: Record<string, string> = {}) {
  const boundary = '----tmperf' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {payload: Buffer.concat(parts), headers: {'content-type': `multipart/form-data; boundary=${boundary}`}};
}

describe('perf: endpoints', () => {
  it('stores a session, lists it with headlines, returns it in full, and replaces it on a re-send', async () => {
    const {app} = await server();
    const r = await app.inject({method: 'POST', url: '/api/perf', payload: session('sess-one-1')});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ok: true, id: 'sess-one-1', interactions: 2});
    const list = (await app.inject({url: '/api/perf'})).json();
    expect(list.sessions).toHaveLength(1);
    const item = list.sessions[0];
    expect(item.label).toBe('before');
    expect(item.build).toBe('abc1234-20261001T1200');
    expect(item.headlines.map((h: {name: string}) => h.name)).toEqual(['open', 'swipe']);
    expect(item.headlines[1].droppedPer).toBe(1);
    const detail = (await app.inject({url: '/api/perf/sess-one-1'})).json();
    expect(detail.interactions[0].renders).toEqual({Viewer: 2, LiftedFace: 3});
    expect(detail.device.screen).toEqual({w: 390, h: 844});
    // the 60-second re-send of the same session replaces it
    await app.inject({method: 'POST', url: '/api/perf', payload: session('sess-one-1', {label: 'after'})});
    const again = (await app.inject({url: '/api/perf'})).json();
    expect(again.sessions).toHaveLength(1);
    expect(again.sessions[0].label).toBe('after');
    expect((await app.inject({url: '/api/perf/nope-nope'})).statusCode).toBe(404);
  });

  it('refuses what is not a session and stores nothing beyond the session shape', async () => {
    const {app} = await server();
    expect((await app.inject({method: 'POST', url: '/api/perf', payload: {hello: 1}})).statusCode).toBe(400);
    expect((await app.inject({method: 'POST', url: '/api/perf', payload: {...session('x'), id: 'x'}})).statusCode).toBe(400);
    const sneaky = {...session('sess-two-2'), playerName: 'Ada', game: {id: 'g'},
      device: {...session('a').device, email: 'a@b.c'}, interactions: [{...session('a').interactions[0], name: 'steal', note: 'x'}, {...session('a').interactions[0], extra: 1}]};
    expect((await app.inject({method: 'POST', url: '/api/perf', payload: sneaky})).statusCode).toBe(200);
    const stored = (await app.inject({url: '/api/perf/sess-two-2'})).json();
    expect(stored.playerName).toBeUndefined();
    expect(stored.game).toBeUndefined();
    expect(stored.device.email).toBeUndefined();
    expect(stored.interactions).toHaveLength(1);
    expect(stored.interactions[0].extra).toBeUndefined();
    expect(Object.keys(stored).sort()).toEqual(['device', 'duration', 'id', 'interactions', 'label', 'overall', 'sentAt', 'startedAt']);
    expect(cleanSession(null)).toBeNull();
  });

  it('keeps only the newest sessions', async () => {
    const {app, desk} = await server({maxSessions: 3});
    for (let i = 0; i < 5; i++) {
      await app.inject({method: 'POST', url: '/api/perf', payload: session(`session-${i}`, {startedAt: 1000 + i})});
      await new Promise((r) => setTimeout(r, 3));
    }
    expect(desk.count()).toBe(3);
    const ids = (await app.inject({url: '/api/perf'})).json().sessions.map((s: {id: string}) => s.id);
    expect(ids).toEqual(['session-4', 'session-3', 'session-2']);
  });

  it('streams a video upload to disk, lists it and serves it back byte for byte', async () => {
    const {app, dir} = await server();
    const data = Buffer.alloc(300_000, 7);
    data.write('ftypqt', 4);
    const mp = multipart({name: 'ScreenRecording 10-01.MOV', type: 'video/quicktime', data}, {label: 'after the fix'});
    const r = await app.inject({method: 'POST', url: '/api/perf/video', ...mp});
    expect(r.statusCode).toBe(200);
    const {id, size} = r.json();
    expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(size).toBe(300_000);
    expect(fs.readdirSync(path.join(dir, 'perf-video'))).toEqual([`${id}.mov`]);
    const list = (await app.inject({url: '/api/perf/videos'})).json().videos;
    expect(list[0]).toMatchObject({id, name: 'ScreenRecording 10-01.MOV', size: 300_000, mime: 'video/quicktime', label: 'after the fix'});
    const got = await app.inject({url: `/api/perf/video/${id}`});
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('video/quicktime');
    expect(got.rawPayload.equals(data)).toBe(true);
    expect((await app.inject({url: '/api/perf/video/zzzzzz'})).statusCode).toBe(404);
    expect((await app.inject({url: '/api/perf/video/..%2Ftm.db'})).statusCode).toBe(404);
  });

  it('refuses other file types, oversize files (nothing left on disk) and requests without a file', async () => {
    const {app, dir} = await server({maxVideoBytes: 100_000});
    const txt = await app.inject({method: 'POST', url: '/api/perf/video', ...multipart({name: 'notes.txt', type: 'text/plain', data: Buffer.from('hi')})});
    expect(txt.statusCode).toBe(415);
    const big = await app.inject({method: 'POST', url: '/api/perf/video', ...multipart({name: 'a.mp4', type: 'video/mp4', data: Buffer.alloc(150_000, 1)})});
    expect(big.statusCode).toBe(413);
    expect(fs.readdirSync(path.join(dir, 'perf-video'))).toEqual([]);
    expect((await app.inject({method: 'POST', url: '/api/perf/video', ...multipart(null, {label: 'x'})})).statusCode).toBe(400);
    expect((await app.inject({method: 'POST', url: '/api/perf/video', payload: {a: 1}})).statusCode).toBe(415);
  });

  it('cleans up old uploads beyond the cap', async () => {
    const {app, dir} = await server({maxVideos: 2});
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await app.inject({method: 'POST', url: '/api/perf/video', ...multipart({name: `r${i}.mp4`, type: 'video/mp4', data: Buffer.alloc(1000, i)})});
      ids.push(r.json().id);
      await new Promise((res) => setTimeout(res, 3));
    }
    const list = (await app.inject({url: '/api/perf/videos'})).json().videos.map((v: {id: string}) => v.id);
    expect(list).toEqual([ids[3], ids[2]]);
    expect(fs.readdirSync(path.join(dir, 'perf-video')).sort()).toEqual([`${ids[2]}.mp4`, `${ids[3]}.mp4`].sort());
    expect((await app.inject({url: `/api/perf/video/${ids[0]}`})).statusCode).toBe(404);
  });
});
