// The performance diagnostics pages, meant for the local network:
//   /perf         recorded sessions from phones, headline numbers per interaction, a before/after comparison of
//                 two sessions, one session's interactions in detail, and the uploaded screen recordings
//   /perf/upload  upload an iPhone screen recording, to check it frame by frame on a computer
import {useEffect, useMemo, useState, type CSSProperties, type ReactNode} from 'react';
import {deviceLine, PERF_COMPONENTS, PERF_INTERACTIONS, type FrameStats, type PerfHeadline, type PerfInteractionName, type PerfListItem, type PerfSession} from '../../shared/perf';

type Video = {id: string; created: number; name: string; size: number; mime: string; label: string};

const LABEL: Record<PerfInteractionName, string> = {open: 'Open', swipe: 'Swipe', close: 'Close', tab: 'Tab switch', scroll: 'Hand scroll'};
const MAX_UPLOAD = 250 * 1024 * 1024;

const page: CSSProperties = {minHeight: '100%', padding: '28px 24px 60px', maxWidth: 1400, margin: '0 auto'};
const card: CSSProperties = {background: 'var(--dusk-2)', borderRadius: 16, padding: 18, boxShadow: 'inset 0 0 0 1px var(--rim)'};
const th: CSSProperties = {textAlign: 'left', fontWeight: 600, fontSize: 13, lineHeight: 1.2, color: 'var(--ice-dim)', padding: '6px 8px', verticalAlign: 'bottom', borderBottom: '1px solid var(--rim-strong)'};
const td: CSSProperties = {padding: '7px 8px', fontSize: 14, borderBottom: '1px solid var(--rim)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'};

export function PerfApp() {
  useEffect(() => { document.title = 'Mars Ledger · performance'; }, []);
  return location.pathname.startsWith('/perf/upload') ? <UploadPage /> : <ListPage />;
}

const when = (t: number) => new Date(t).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
const fmt = (v: number | undefined, d = 1) => (v === undefined || Number.isNaN(v) ? '–' : v.toFixed(d).replace(/\.0$/, ''));
const head = (it: PerfListItem, name: PerfInteractionName) => it.headlines.find((h) => h.name === name);

function ListPage() {
  const [data, setData] = useState<{sessions: PerfListItem[]; videos: Video[]} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const load = () => fetch('/api/perf').then((r) => r.json()).then(setData).catch(() => setError('Could not load the sessions'));
  useEffect(() => { void load(); }, []);
  const sessions = data?.sessions ?? [];
  const sa = sessions.find((s) => s.id === a);
  const sb = sessions.find((s) => s.id === b);
  return (
    <div style={page} data-perf-page="list">
      <header style={{display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 18}}>
        <h1 style={{margin: 0, fontSize: 28, fontVariationSettings: "'wdth' 90"}}>Performance recordings</h1>
        <span className="muted">Phones with “Record performance” on send these. Frame times are in ms; lower is better.</span>
        <span style={{flex: 1}} />
        <button className="btn ghost" style={{minHeight: 38, fontSize: 15, background: 'rgba(255,255,255,.07)', color: 'var(--ice)'}} onClick={() => void load()}>Refresh</button>
        <a href="/perf/upload" style={{color: 'var(--tr)'}}>Upload a screen recording</a>
      </header>
      {error && <p role="alert" style={{color: 'var(--ember)'}}>{error}</p>}
      {data && !sessions.length && <p className="muted" data-perf-empty>No sessions yet. Turn on Record performance in a phone's ⋯ menu, play for a moment, then tap Send recording.</p>}
      {sessions.length > 0 && (
        <section style={{...card, padding: 0, overflowX: 'auto'}}>
          <table style={{borderCollapse: 'collapse', width: '100%'}} data-perf-sessions>
            <thead><tr>
              <th style={{...th, whiteSpace: 'nowrap'}} title="A = before, B = after">A · B</th>
              <th style={th}>When</th><th style={th}>Label</th><th style={th}>Device · build</th><th style={th}>Hz</th>
              <th style={th}>Open p95</th><th style={th}>Swipes</th><th style={th}>Swipe p95</th><th style={th}>Dropped / swipe</th><th style={th}>Renders / swipe</th>
              <th style={th}>Close p95</th><th style={th}>Tab p95</th><th style={th}>Scroll p95</th><th style={th}>All frames p95</th><th style={th} />
            </tr></thead>
            <tbody>
              {sessions.map((s) => {
                const sw = head(s, 'swipe');
                return (
                  <tr key={s.id} data-session={s.id} style={{background: detail === s.id ? 'rgba(111,184,232,.08)' : undefined}}>
                    <td style={td}>
                      <input type="radio" name="a" aria-label={`Before: ${s.id}`} checked={a === s.id} onChange={() => setA(s.id)} />
                      <input type="radio" name="b" aria-label={`After: ${s.id}`} checked={b === s.id} onChange={() => setB(s.id)} style={{marginLeft: 8}} />
                    </td>
                    <td style={td}>{when(s.startedAt)}</td>
                    <td style={{...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis'}} title={s.label}>{s.label || <span className="faint">–</span>}</td>
                    <td style={td}>{deviceLine(s.ua)}<div className="faint" style={{fontSize: 11.5}}>{s.build}</div></td>
                    <td style={td}>{s.refreshHz}</td>
                    <td style={td}>{fmt(head(s, 'open')?.p95)}</td>
                    <td style={td}>{sw?.count ?? 0}</td>
                    <td style={td}>{fmt(sw?.p95)}</td>
                    <td style={td}>{fmt(sw?.droppedPer)}</td>
                    <td style={td}>{fmt(sw?.rendersTotalPer)}</td>
                    <td style={td}>{fmt(head(s, 'close')?.p95)}</td>
                    <td style={td}>{fmt(head(s, 'tab')?.p95)}</td>
                    <td style={td}>{fmt(head(s, 'scroll')?.p95)}</td>
                    <td style={td}>{fmt(s.overall.p95)}</td>
                    <td style={td}><button style={{color: 'var(--tr)'}} onClick={() => setDetail(detail === s.id ? null : s.id)}>{detail === s.id ? 'Hide' : 'Details'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {sessions.length > 1 && (!sa || !sb) && <p className="muted" style={{marginTop: 10}}>Pick a session in column A (before) and one in column B (after) to compare them.</p>}
      {sa && sb && <Compare a={sa} b={sb} />}
      {detail && <Detail id={detail} />}
      <Videos videos={data?.videos ?? []} />
    </div>
  );
}

type Metric = {key: string; label: string; get: (h: PerfHeadline | undefined) => number | undefined; d?: number};
const METRICS: Metric[] = [
  {key: 'count', label: 'Interactions', get: (h) => h?.count, d: 0},
  {key: 'p95', label: 'p95 frame (median of each)', get: (h) => h?.p95},
  {key: 'max', label: 'Worst frame', get: (h) => h?.max},
  {key: 'dropped', label: 'Dropped frames each', get: (h) => h?.droppedPer},
  {key: 'over50', label: 'Frames over 50 ms each', get: (h) => h?.over50Per},
  {key: 'dur', label: 'Duration', get: (h) => h?.dur, d: 0},
  {key: 'renders', label: 'Renders each (all counted)', get: (h) => h?.rendersTotalPer},
  ...PERF_COMPONENTS.map((c): Metric => ({key: `r-${c}`, label: `  ${c} renders each`, get: (h) => h?.rendersPer[c] ?? (h ? 0 : undefined)})),
];

function Compare({a, b}: {a: PerfListItem; b: PerfListItem}) {
  const rows: ReactNode[] = [];
  for (const name of PERF_INTERACTIONS) {
    const ha = head(a, name), hb = head(b, name);
    if (!ha && !hb) continue;
    rows.push(<tr key={name}><td colSpan={4} style={{...td, fontWeight: 700, paddingTop: 14, color: 'var(--ice)'}}>{LABEL[name]}</td></tr>);
    for (const m of METRICS) {
      const va = m.get(ha), vb = m.get(hb);
      if (m.key.startsWith('r-') && !va && !vb) continue;
      rows.push(<CompareRow key={name + m.key} label={m.label} a={va} b={vb} d={m.d} neutral={m.key === 'count'} name={`${name}.${m.key}`} />);
    }
  }
  const o = (s: FrameStats) => s;
  return (
    <section style={{...card, marginTop: 18}} data-perf-compare>
      <h2 style={{margin: '0 0 4px', fontSize: 20}}>Before and after</h2>
      <p className="muted" style={{margin: '0 0 10px', fontSize: 14}}>
        A: {when(a.startedAt)} {a.label && `“${a.label}”`} · {deviceLine(a.ua)} · {a.build} &nbsp;→&nbsp; B: {when(b.startedAt)} {b.label && `“${b.label}”`} · {deviceLine(b.ua)} · {b.build}
      </p>
      <table style={{borderCollapse: 'collapse', minWidth: 560}}>
        <thead><tr><th style={th} /><th style={th}>A (before)</th><th style={th}>B (after)</th><th style={th}>Change</th></tr></thead>
        <tbody>
          <tr><td colSpan={4} style={{...td, fontWeight: 700, color: 'var(--ice)'}}>All frames</td></tr>
          <CompareRow label="p95 frame" a={o(a.overall).p95} b={o(b.overall).p95} name="overall.p95" />
          <CompareRow label="Dropped (share of frames, %)" a={pct(a.overall)} b={pct(b.overall)} name="overall.dropped" />
          <CompareRow label="Frames over 50 ms" a={a.overall.over50} b={b.overall.over50} d={0} name="overall.over50" />
          {rows}
        </tbody>
      </table>
    </section>
  );
}
const pct = (s: FrameStats) => (s.frames ? (100 * s.dropped) / s.frames : undefined);

function CompareRow({label, a, b, d = 1, neutral, name}: {label: string; a?: number; b?: number; d?: number; neutral?: boolean; name: string}) {
  const delta = a !== undefined && b !== undefined ? b - a : undefined;
  const better = delta !== undefined && !neutral && Math.abs(delta) > 1e-9 ? delta < 0 : null;
  const rel = delta !== undefined && a ? ` (${delta > 0 ? '+' : ''}${Math.round((100 * delta) / a)}%)` : '';
  return (
    <tr data-metric={name}>
      <td style={{...td, color: 'var(--ice-dim)', whiteSpace: 'pre'}}>{label}</td>
      <td style={td}>{fmt(a, d)}</td>
      <td style={td}>{fmt(b, d)}</td>
      <td style={{...td, color: better === null ? 'var(--ice-dim)' : better ? '#7FD1A0' : '#FF9C85', fontWeight: 600}}>
        {delta === undefined ? '–' : `${delta > 0 ? '+' : ''}${fmt(delta, d)}${rel}`}
      </td>
    </tr>
  );
}

function Detail({id}: {id: string}) {
  const [s, setS] = useState<PerfSession | null>(null);
  useEffect(() => { setS(null); fetch(`/api/perf/${id}`).then((r) => r.json()).then(setS).catch(() => {}); }, [id]);
  const [only, setOnly] = useState<PerfInteractionName | 'all'>('all');
  const shown = useMemo(() => (s ? s.interactions.filter((i) => only === 'all' || i.name === only) : []), [s, only]);
  if (!s) return <section style={{...card, marginTop: 18}} className="muted">Loading…</section>;
  const dv = s.device;
  return (
    <section style={{...card, marginTop: 18}} data-perf-detail={s.id}>
      <h2 style={{margin: '0 0 4px', fontSize: 20}}>Session {s.id.slice(0, 8)} {s.label && <span className="muted">“{s.label}”</span>}</h2>
      <p className="muted" style={{margin: '0 0 6px', fontSize: 14, whiteSpace: 'normal'}}>{dv.ua}</p>
      <p style={{margin: '0 0 12px', fontSize: 14}}>
        {deviceLine(dv.ua)} · screen {dv.screen.w}×{dv.screen.h} @{dv.dpr}x · viewport {dv.viewport.w}×{dv.viewport.h} · {dv.refreshHz} Hz (estimated) ·
        build {dv.build} · {dv.standalone ? 'home-screen app' : 'browser tab'} · long tasks {dv.longTaskSupported ? 'measured' : 'not available (Safari)'} ·
        recorded {Math.round(s.duration / 1000)} s from {when(s.startedAt)}
      </p>
      <p style={{margin: '0 0 12px', fontSize: 14}}>
        All frames: {s.overall.frames} · dropped {s.overall.dropped} · p50 {s.overall.p50} · p95 {s.overall.p95} · max {s.overall.max} · over 33 ms {s.overall.over33} · over 50 ms {s.overall.over50}
      </p>
      <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10}}>
        {(['all', ...PERF_INTERACTIONS] as const).map((k) => (
          <button key={k} onClick={() => setOnly(k)} style={{padding: '4px 12px', borderRadius: 999, fontSize: 14,
            background: only === k ? 'var(--ice)' : 'rgba(255,255,255,.07)', color: only === k ? 'var(--dusk-1)' : 'var(--ice)'}}>
            {k === 'all' ? 'All' : LABEL[k]} {k === 'all' ? s.interactions.length : s.interactions.filter((i) => i.name === k).length}
          </button>
        ))}
      </div>
      <div style={{overflowX: 'auto'}}>
        <table style={{borderCollapse: 'collapse', width: '100%'}}>
          <thead><tr>
            <th style={th}>#</th><th style={th}>Interaction</th><th style={th}>At (s)</th><th style={th}>Duration</th><th style={th}>Frames</th><th style={th}>Dropped</th>
            <th style={th}>p50</th><th style={th}>p95</th><th style={th}>Max</th><th style={th}>&gt;33 ms</th><th style={th}>&gt;50 ms</th><th style={th}>Renders</th><th style={th}>Long tasks</th><th style={th}>Slowest frames</th>
          </tr></thead>
          <tbody>
            {shown.map((i, k) => (
              <tr key={k} data-interaction={i.name}>
                <td style={td} className="faint">{k + 1}</td>
                <td style={td}>{LABEL[i.name]}</td>
                <td style={td}>{(i.start / 1000).toFixed(1)}</td>
                <td style={td}>{i.dur}</td>
                <td style={td}>{i.stats.frames}</td>
                <td style={{...td, color: i.stats.dropped ? '#FF9C85' : undefined}}>{i.stats.dropped}</td>
                <td style={td}>{i.stats.p50}</td>
                <td style={td}>{i.stats.p95}</td>
                <td style={td}>{i.stats.max}</td>
                <td style={td}>{i.stats.over33}</td>
                <td style={td}>{i.stats.over50}</td>
                <td style={{...td, fontSize: 13}}>{Object.entries(i.renders).map(([c, n]) => `${c} ${n}`).join(' · ') || <span className="faint">none</span>}</td>
                <td style={td}>{i.longTasks === null ? <span className="faint">n/a</span> : i.longTasks.length ? i.longTasks.join(', ') : '0'}</td>
                <td style={{...td, fontSize: 13}} className="muted">{[...i.deltas].sort((x, y) => y - x).slice(0, 4).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Videos({videos}: {videos: Video[]}) {
  return (
    <section style={{...card, marginTop: 18}} data-perf-videos>
      <h2 style={{margin: '0 0 4px', fontSize: 20}}>Screen recordings</h2>
      <p className="muted" style={{margin: '0 0 10px', fontSize: 14}}>
        Download one to check it frame by frame on a computer.
      </p>
      {!videos.length ? <p className="faint" style={{margin: 0}}>None uploaded yet. <a href="/perf/upload" style={{color: 'var(--tr)'}}>Upload one</a>.</p> : (
        <table style={{borderCollapse: 'collapse'}}>
          <thead><tr><th style={th}>Id</th><th style={th}>Uploaded</th><th style={th}>File</th><th style={th}>Label</th><th style={th}>Size</th><th style={th} /></tr></thead>
          <tbody>
            {videos.map((v) => (
              <tr key={v.id} data-video={v.id}>
                <td style={{...td, fontFamily: 'ui-monospace, monospace'}}>{v.id}</td>
                <td style={td}>{when(v.created)}</td>
                <td style={td}>{v.name}</td>
                <td style={td}>{v.label || <span className="faint">–</span>}</td>
                <td style={td}>{mb(v.size)}</td>
                <td style={td}><a href={`/api/perf/video/${v.id}`} style={{color: 'var(--tr)'}}>Download</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ok: boolean; text: string; id?: string} | null>(null);
  const tooBig = !!file && file.size > MAX_UPLOAD;
  const upload = () => {
    if (!file || tooBig) return;
    const form = new FormData();
    form.append('label', label);
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/perf/video');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(e.loaded / e.total); };
    xhr.onload = () => {
      setProgress(null);
      let body: {id?: string; error?: string; message?: string} = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 200 && body.id) setResult({ok: true, id: body.id, text: `Uploaded. Its id is ${body.id}.`});
      else setResult({ok: false, text: body.error ?? body.message ?? `The upload failed (${xhr.status}).`});
    };
    xhr.onerror = () => { setProgress(null); setResult({ok: false, text: 'The upload failed: no connection to the server.'}); };
    setResult(null); setProgress(0);
    xhr.send(form);
  };
  return (
    <div style={{...page, maxWidth: 560, padding: 'calc(24px + env(safe-area-inset-top)) 18px 60px'}} data-perf-page="upload">
      <h1 style={{margin: '0 0 6px', fontSize: 26, fontVariationSettings: "'wdth' 90"}}>Upload a screen recording</h1>
      <p className="muted" style={{marginTop: 0}}>An iPhone screen recording (.mp4 or .mov, up to {MAX_UPLOAD / 1048576} MB) of the test routine. Download it later to check it frame by frame for flashes, blank frames and freezes.</p>
      <div style={{...card, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14}}>
        <label style={{display: 'grid', gap: 6}}>
          <span style={{fontWeight: 650}}>Video</span>
          <input type="file" style={{maxWidth: '100%'}} data-upload-file accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        </label>
        {file && <span className={tooBig ? undefined : 'muted'} style={{fontSize: 14, color: tooBig ? 'var(--ember)' : undefined}}>{file.name} · {mb(file.size)}{tooBig ? ' · too large' : ''}</span>}
        <label style={{display: 'grid', gap: 6}}>
          <span style={{fontWeight: 650}}>Label <span className="faint" style={{fontWeight: 400}}>(optional)</span></span>
          <input data-upload-label value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. lifted view after the fix"
            style={{width: '100%', minWidth: 0, padding: '10px 12px', borderRadius: 12, border: 'none', background: 'rgba(255,255,255,.07)', fontSize: 16}} />
        </label>
        <button className="btn" data-upload-go disabled={!file || tooBig || progress !== null} onClick={upload}>{progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Upload'}</button>
        {progress !== null && (
          <div style={{height: 6, borderRadius: 3, background: 'rgba(255,255,255,.1)', overflow: 'hidden'}}>
            <div style={{height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--tr)'}} />
          </div>
        )}
        {result && <p role="status" data-upload-result={result.ok ? 'ok' : 'error'} style={{margin: 0, color: result.ok ? '#7FD1A0' : 'var(--ember)', fontWeight: 600}}>{result.text}</p>}
      </div>
      <p style={{marginTop: 18}}><a href="/perf" style={{color: 'var(--tr)'}}>All recordings</a></p>
    </div>
  );
}
