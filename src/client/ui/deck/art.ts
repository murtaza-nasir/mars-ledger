// Card illustrations live at /cards/<number>.webp (3:2). A manifest lists which exist, so cards
// without art never request a missing file; before the manifest arrives we fall back to trying the
// image and hiding it on error.
import {useEffect, useState} from 'react';

let known: Set<string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function collect(v: unknown, out: Set<string>) {
  if (typeof v === 'string') {
    const m = v.match(/(?:^|\/)([A-Z]?\d{1,3})(?:\.webp)?$/i);
    if (m) out.add(m[1].toUpperCase());
  } else if (Array.isArray(v)) {
    for (const x of v) collect(x, out);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (/^[A-Z]?\d{1,3}$/i.test(k)) out.add(k.toUpperCase());
      collect(x, out);
    }
  }
}

function load() {
  loading ??= fetch('/cards/manifest.json', {cache: 'no-cache'})
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j) { known = new Set(); collect(j, known); }
    })
    .catch(() => {})
    .finally(() => { for (const f of listeners) f(); });
  return loading;
}

export function artUrl(number: string | null | undefined): string | null {
  if (!number) return null;
  const n = number.replace(/^#/, '').toUpperCase();
  if (known && !known.has(n)) return null;
  return `/cards/${n}.webp`;
}

/** The art URL for a card number, or null; re-renders once the manifest is known. */
export function useArt(number: string | null | undefined): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((x) => x + 1);
    listeners.add(f);
    void load();
    return () => { listeners.delete(f); };
  }, []);
  return artUrl(number);
}

// Decoded art. An <img> that has to decode on its first paint draws empty (or half drawn) for a frame in WebKit,
// which flickered every time a card was lifted or swiped in. Art is decoded off screen first (img.decode()) and a
// reference to each decoded image is kept, so the browser keeps its bitmap; an <img> shown afterwards with the
// same URL paints complete in its first frame.
const decoded = new Set<string>();
const decoding = new Map<string, Promise<void>>();
const held = new Map<string, HTMLImageElement>();
const HOLD = 24;

/** Whether this art URL is decoded and can be shown without a blank frame. */
export function isDecoded(url: string | null | undefined): boolean {
  return !!url && decoded.has(url);
}

/** Decode an art URL off screen; resolves once it can paint in one frame (also on error, so callers never hang). */
export function decodeArt(url: string): Promise<void> {
  if (decoded.has(url)) return Promise.resolve();
  let p = decoding.get(url);
  if (p) return p;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  p = (typeof img.decode === 'function' ? img.decode() : new Promise<void>((ok, no) => { img.onload = () => ok(); img.onerror = no; }))
    .then(() => {
      decoded.add(url);
      held.delete(url); held.set(url, img);
      // keep the most recent few decoded (a hand plus its table), oldest first out
      while (held.size > HOLD) { const k = held.keys().next().value!; held.delete(k); }
    })
    .catch(() => { /* missing or broken file: the plate stays */ })
    .finally(() => { decoding.delete(url); });
  decoding.set(url, p);
  return p;
}

/** Decode the art of the next cards in a deck so swiping never waits on a decode. */
export function preloadArt(numbers: Array<string | null | undefined>) {
  const go = () => { for (const n of numbers) { const u = artUrl(n); if (u) void decodeArt(u); } };
  if (known) go(); else void load().then(go);
}
