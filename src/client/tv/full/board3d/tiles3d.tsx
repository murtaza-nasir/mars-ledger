// How each kind of tile stands on the 3D board. Each space is raised, and it keeps the flat tile drawing on
// its top (the hex texture); a model stands on it: clusters of glass domes and lit towers, swaying
// forests, rippling water, and a distinct structure for every special tile, each with its own build-in.
//
// Everything is drawn from code (no downloaded assets). Geometries and materials are shared at module level so
// a late-game board stays cheap; one ticker (WorldTicker) advances the clock, the night and every animated
// material once per frame. Canvas textures are made lazily, since tests import this module in node.
//
// Legibility: special tiles keep their model in the back half of the hex, so the painted name in the front band
// stays readable; every owned tile carries its owner's cube on the front corner and a glowing edge in their colour.
import {useFrame, useThree} from '@react-three/fiber';
import {Component, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Color} from '../../../../shared/full';
import {TILE, tileKind} from '../../../../shared/full';
import {PLAYER_HEX} from '../../../ui/Icons';
import {TILE_HEIGHT} from './geometry3d';
import type {ModelMeta, ModelProps} from './models/contract';
import {tracked, unprimed} from './primer';
import {compilesInFlight} from './primer';
import {DEFAULT_SET, resolveModel, setOf} from './tilesets';
import type {Detail} from './tilesets';

export type TileKind3 = 'ocean' | 'greenery' | 'city' | 'special';

export type TileModelProps = {
  /** the space id: seeds each tile's own arrangement */
  id: string;
  tileType: number;
  color?: Color;
  /** placed in the last moments: play the build-in */
  fresh: boolean;
  /** the prism's circumradius and the height of its top, in world units */
  radius: number;
  top: number;
  /** the night's depth (0 day … 1 deepest night), for windows and glows */
  night: number;
  /** ocean tiles: which of the six edges border another ocean tile (ModelProps.oceanEdges; tilesets.ts EDGE_DIRS) */
  oceanEdges?: readonly boolean[];
};

export type TileRenderer = {
  /** height of the space's prism when this tile sits on it */
  height: number;
  /** a 3D model standing on the prism's top */
  Model?: (p: TileModelProps) => React.ReactElement | null;
};

// ---- the shared clock -------------------------------------------------------------------------------------
/** One clock for every tile: time in seconds, the night's depth, and whether motion is reduced. */
export const world = {t: 0, night: 0, reduced: false,
  /** 0 at the resting camera, 1 when dived in: the painted tops (labels, bonus icons) fade out so the models lead */
  topFade: 0,
  /** seconds a build-in waits after a placement, so the camera has dived in before it starts (0 when it stays put) */
  lead: 0};
/** A placement nudges the camera: Board3D's rig adds a small damped bounce from this. */
export const cameraKick = {at: -1e9, strength: 0};
// (test hook: window.__board3dTimeScale slows the build-ins down for frame-by-frame captures)
const timeScale = () => (typeof window === 'undefined' ? 1 : (window as unknown as {__board3dTimeScale?: number}).__board3dTimeScale ?? 1);
const now = () => (performance.now() / 1000) * timeScale();
/** The bounce lands with the tile, after the build-in's wait for the camera. */
export function kick(strength: number) { cameraKick.at = now() + world.lead + 0.35; cameraKick.strength = strength; }
/** The bounce's vertical offset (world units) at this moment: a quick dip and a damped rebound. */
export function kickOffset(): number {
  const k = now() - cameraKick.at;
  if (k < 0 || k > 1.4) return 0;
  return -cameraKick.strength * Math.exp(-k * 4.5) * Math.sin(k * 16);
}

/** A deterministic random stream per space (FNV-1a hash into mulberry32). */
export function seeded(id: string, salt = 0): () => number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeOutBack = (x: number) => { const c = 1.9, k = clamp01(x) - 1; return 1 + (c + 1) * k * k * k + c * k * k; };
const easeInCubic = (x: number) => clamp01(x) ** 3;

/** Seconds since this tile was placed while its build-in plays; Infinity once done (and under reduced motion). */
function useBirth(fresh: boolean, length: number): () => number {
  // (negative while the build-in waits for the camera: every model holds its start state until 0)
  const born = useRef<number | null>(fresh ? now() + world.lead : null);
  useEffect(() => { if (fresh) born.current = now() + world.lead; }, [fresh]);
  return useMemo(() => () => {
    if (born.current === null || world.reduced) return Infinity;
    const a = now() - born.current;
    if (a > length) { born.current = null; return Infinity; }
    return a;
  }, [length]);
}

// ---- lazily made canvas textures --------------------------------------------------------------------------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function lazy<T>(make: () => T): () => T { let v: T | undefined; return () => (v ??= make()); }

/** Window light: a black wall with rows of windows, most of them lit warm (the towers' emissive map). */
const WINDOWS = lazy(() => canvasTex(64, 128, (g) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  const r = seeded('windows');
  for (let y = 3; y < 128; y += 8) for (let x = 2; x < 64; x += 8) {
    const lit = r();
    if (lit < 0.3) continue;
    g.fillStyle = `rgb(255,${170 + Math.floor(r() * 70)},${90 + Math.floor(r() * 70)})`;
    g.globalAlpha = 0.55 + lit * 0.45;
    g.fillRect(x, y, 5, 4);
  }
}));
/** The same walls by day: pale panels with blue-grey windows on the same grid (the towers' colour map). */
const FACADE = lazy(() => canvasTex(64, 128, (g) => {
  g.fillStyle = '#ece6dc'; g.fillRect(0, 0, 64, 128);
  const r = seeded('facade');
  for (let y = 3; y < 128; y += 8) for (let x = 2; x < 64; x += 8) {
    const v = 70 + Math.floor(r() * 40);
    g.fillStyle = `rgb(${v - 10},${v + 8},${v + 30})`;
    g.fillRect(x, y, 5, 4);
  }
  g.fillStyle = 'rgba(0,0,0,.12)';
  for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 64, 1.5);
}));
/** A tileable sum of waves turned into a normal map, for ripples. */
const RIPPLES = lazy(() => canvasTex(256, 256, (g) => {
  const N = 256, h = new Float32Array(N * N), r = seeded('ripples');
  const waves = Array.from({length: 16}, () => ({kx: Math.round(1 + r() * 7), ky: Math.round(-6 + r() * 12), p: r() * 6.28, a: 0.3 + r()}));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const w of waves) v += w.a / Math.hypot(w.kx, w.ky) * Math.sin(((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.p);
    h[y * N + x] = v;
  }
  const img = g.createImageData(N, N);
  const n = new THREE.Vector3();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
    const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
    n.set(-dx * 2.2, -dy * 2.2, 1).normalize();
    const i = (y * N + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}, false));
/** Moss and undergrowth for the forest floor. */
const MOSS = lazy(() => canvasTex(128, 128, (g) => {
  g.fillStyle = '#35602c'; g.fillRect(0, 0, 128, 128);
  const r = seeded('moss');
  for (let i = 0; i < 900; i++) {
    const x = r() * 128, y = r() * 128, s = 1 + r() * 3;
    g.fillStyle = `hsl(${85 + r() * 45},${35 + r() * 30}%,${16 + r() * 24}%)`;
    g.beginPath(); g.arc(x, y, s, 0, 6.29); g.fill();
  }
}));
/** Cracked lava: dark crust plates over glowing veins (the bright part of the emissive map). */
const LAVA = lazy(() => canvasTex(256, 256, (g) => {
  g.fillStyle = '#ff8a2a'; g.fillRect(0, 0, 256, 256);
  const r = seeded('lava');
  for (let i = 0; i < 80; i++) {
    const x = r() * 256, y = r() * 256, s = 12 + r() * 24;
    g.fillStyle = `rgb(${10 + r() * 20},${4 + r() * 8},${2 + r() * 6})`;
    g.beginPath();
    for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.28 + r() * 0.5, rr = s * (0.7 + r() * 0.4); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
}));
/** Yellow-black hazard band for the nuclear zone. */
const HAZARD = lazy(() => canvasTex(128, 16, (g) => {
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 128, 16);
  g.fillStyle = '#F2C230';
  for (let x = -16; x < 144; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8, 0); g.lineTo(x, 16); g.lineTo(x - 8, 16); g.fill(); }
}));

/** A soft round glow for halos (a cheap stand-in for bloom). */
const GLOW = lazy(() => canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
}));
type GlowMat = {m: THREE.SpriteMaterial; day: number; blink: number};
const glowMats = new Map<string, GlowMat>();
/** A halo material: `day` is its strength in daylight (it reaches full strength at night); `blink` > 0 blinks it. */
function glow(color: string, day = 0.3, blink = 0): THREE.SpriteMaterial {
  const key = `${color}|${day}|${blink}`;
  let g = glowMats.get(key);
  if (!g) {
    g = {m: new THREE.SpriteMaterial({map: GLOW(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false}), day, blink};
    glowMats.set(key, g);
  }
  return g.m;
}
function Halo({color, size, at, day, blink, sy = 1}: {color: string; size: number; at: [number, number, number]; day?: number; blink?: number; sy?: number}) {
  return <sprite material={glow(color, day, blink)} scale={[size, size * sy, 1]} position={at} renderOrder={9} />;
}

/** Vertical fade for light columns: bright at the base, gone at the top. */
const FADE_UP = lazy(() => canvasTex(4, 64, (g) => {
  const r = g.createLinearGradient(0, 64, 0, 0);
  r.addColorStop(0, '#fff'); r.addColorStop(0.35, '#777'); r.addColorStop(1, '#000');
  g.fillStyle = r; g.fillRect(0, 0, 4, 64);
}, false));

// ---- shared geometries ------------------------------------------------------------------------------------
/** a flat hex of radius 1 in the ground plane, pointy-top like the prisms */
const HEX_DISC = new THREE.CircleGeometry(1, 6, Math.PI / 2); HEX_DISC.rotateX(-Math.PI / 2);
const HEX_RING = new THREE.RingGeometry(0.955, 1, 6, 1, Math.PI / 2); HEX_RING.rotateX(-Math.PI / 2);
/** the owner rim: a dark under-stroke with a bright band of the player's colour on it */
export const RIM_UNDER = new THREE.RingGeometry(0.87, 1.0, 6, 1, Math.PI / 2); RIM_UNDER.rotateX(-Math.PI / 2);
export const RIM = new THREE.RingGeometry(0.9, 0.975, 6, 1, Math.PI / 2); RIM.rotateX(-Math.PI / 2);
const DISC = new THREE.CircleGeometry(1, 40); DISC.rotateX(-Math.PI / 2);
const RING = new THREE.RingGeometry(0.82, 1, 48); RING.rotateX(-Math.PI / 2);
const DOME = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
const TOWER = (() => { const g = new THREE.CylinderGeometry(0.8, 1, 1, 8, 1); g.translate(0, 0.5, 0); return g; })();
const BOX = (() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; })();
const CUBE = (() => { const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1); g.translate(0, 0.5, 0); return g; })();
/** a dashed hex rim (three dashes per edge) in the ground plane, radius 1, pointy-top */
const DASHED_RIM = (() => {
  const pos: number[] = [];
  const corner = (i: number, r: number) => { const a = Math.PI / 2 + (i * Math.PI) / 3; return [Math.cos(a) * r, Math.sin(a) * r]; };
  for (let i = 0; i < 6; i++) {
    for (let d = 0; d < 3; d++) {
      const t0 = (d + 0.15) / 3, t1 = (d + 0.85) / 3;
      const q = [[t0, 0.99], [t1, 0.99], [t1, 0.91], [t0, 0.91]].map(([t, r]) => {
        const [ax, az] = corner(i, r), [bx, bz] = corner(i + 1, r);
        return [ax + (bx - ax) * t, 0, az + (bz - az) * t];
      });
      pos.push(...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
})();
/** a pennant: a triangle hanging from its top-left corner at the pole, pointing +x */
const FLAG = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, -0.5, 0, 0, -1, 0], 3));
  g.computeVertexNormals();
  return g;
})();
const STICK = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 6); g.translate(0, 0.5, 0); return g; })();
const BALL = new THREE.SphereGeometry(1, 12, 8);
const CONE = (() => { const g = new THREE.ConeGeometry(1, 1, 16); g.translate(0, 0.5, 0); return g; })();
const TORUS = new THREE.TorusGeometry(1, 0.08, 8, 40);
const RAIL = new THREE.TorusGeometry(1, 0.02, 4, 48);
const SHAFT = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); g.translate(0, 0.5, 0); return g; })();
/** a truncated cone with a crater lip */
const VOLCANO = (() => {
  const pts = [[1, 0], [0.75, 0.25], [0.45, 0.7], [0.26, 0.95], [0.22, 1], [0.17, 0.94]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 18);
})();
const COOLING = (() => {
  const pts = [0, 0.2, 0.45, 0.7, 1].map((y) => new THREE.Vector2(0.62 - 0.3 * Math.sin(y * Math.PI * 0.85) + y * 0.1, y));
  return new THREE.LatheGeometry(pts, 20);
})();
/** Trees: unit tall; the trunk is dark and the canopy is white × the instance colour (vertex colours). */
function tinted(g: THREE.BufferGeometry, c: string) {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function bare(g: THREE.BufferGeometry) { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }
const trunk = () => { const t = new THREE.CylinderGeometry(0.045, 0.07, 0.3, 5); t.translate(0, 0.15, 0); return tinted(bare(t), '#4a2c1a'); };
const CONIFER = (() => {
  const a = new THREE.ConeGeometry(0.33, 0.5, 7); a.translate(0, 0.45, 0);
  const b = new THREE.ConeGeometry(0.25, 0.42, 7); b.translate(0, 0.72, 0);
  const c = new THREE.ConeGeometry(0.15, 0.3, 7); c.translate(0, 0.94, 0);
  return mergeGeometries([trunk(), tinted(bare(a), '#d8e6d4'), tinted(bare(b), '#f0f8ea'), tinted(bare(c), '#ffffff')])!;
})();
const BROADLEAF = (() => {
  const a = new THREE.IcosahedronGeometry(0.34, 1); a.scale(1, 0.85, 1); a.translate(0, 0.56, 0);
  const b = new THREE.IcosahedronGeometry(0.22, 1); b.translate(0.13, 0.78, 0.05);
  const c = new THREE.IcosahedronGeometry(0.2, 1); c.translate(-0.15, 0.7, -0.08);
  return mergeGeometries([trunk(), tinted(bare(a), '#d8e6cc'), tinted(bare(b), '#ffffff'), tinted(bare(c), '#eef7e2')])!;
})();

// ---- shared materials (animated by the ticker) ------------------------------------------------------------
const sway = {uTime: {value: 0}, uAmp: {value: 0.05}};
/** Wind in the vertex shader: the higher a vertex, the further it moves; each tree has its own phase. */
function swaying<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sway.uTime; sh.uniforms.uAmp = sway.uAmp;
    sh.vertexShader = 'uniform float uTime;\nuniform float uAmp;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 swayAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #else
        vec3 swayAt = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #endif
      float swayPh = swayAt.x * 23.0 + swayAt.z * 17.0;
      float swayH = max(position.y - 0.18, 0.0);
      float gust = 0.55 + 0.45 * sin(uTime * 0.4 + swayAt.x * 1.7 - swayAt.z);
      transformed.x += sin(uTime * 1.7 + swayPh) * uAmp * swayH * swayH * gust;
      transformed.z += cos(uTime * 1.3 + swayPh * 1.31) * uAmp * 0.6 * swayH * swayH * gust;`);
  };
  return m;
}

const M = {
  facade: lazy(() => {
    const map = FACADE(), em = WINDOWS();
    map?.repeat.set(1, 0.75); em?.repeat.set(1, 0.75);
    return new THREE.MeshStandardMaterial({color: '#ffffff', map, metalness: 0.3, roughness: 0.38, emissive: '#ffffff', emissiveMap: em, emissiveIntensity: 0.1});
  }),
  block: lazy(() => {
    const map = FACADE()?.clone() ?? null, em = WINDOWS()?.clone() ?? null;
    map?.repeat.set(3, 0.6); em?.repeat.set(3, 0.6);
    if (map) map.needsUpdate = true;
    if (em) em.needsUpdate = true;
    return new THREE.MeshStandardMaterial({color: '#ffffff', map, metalness: 0.2, roughness: 0.5, emissive: '#ffffff', emissiveMap: em, emissiveIntensity: 0.1});
  }),
  glass: lazy(() => new THREE.MeshPhysicalMaterial({color: '#bfe4f4', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.4,
    emissive: '#ffbf80', emissiveIntensity: 0.04, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.05})),
  park: lazy(() => new THREE.MeshStandardMaterial({color: '#5aa85a', roughness: 0.9, emissive: '#ffd59a', emissiveIntensity: 0})),
  concrete: lazy(() => new THREE.MeshStandardMaterial({color: '#cfc6bb', roughness: 0.7, metalness: 0.05})),
  darkMetal: lazy(() => new THREE.MeshStandardMaterial({color: '#4a4440', roughness: 0.45, metalness: 0.75})),
  gold: lazy(() => new THREE.MeshStandardMaterial({color: '#e8c070', metalness: 0.9, roughness: 0.25, emissive: '#ffb84a', emissiveIntensity: 0.15})),
  beaconA: lazy(() => new THREE.MeshBasicMaterial({color: '#ff4a3a', transparent: true, toneMapped: false})),
  beaconB: lazy(() => new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, toneMapped: false})),
  amber: lazy(() => new THREE.MeshBasicMaterial({color: '#ffb23a', transparent: true, toneMapped: false})),
  trees: lazy(() => swaying(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.8, flatShading: true}))),
  moss: lazy(() => new THREE.MeshStandardMaterial({map: MOSS(), roughness: 1, color: '#a8c498'})),
  water: lazy(() => {
    const n = RIPPLES();
    n?.repeat.set(1.3, 1.3);
    return new THREE.MeshPhysicalMaterial({color: '#2a6f9e', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92,
      normalMap: n, normalScale: new THREE.Vector2(0.55, 0.55), emissive: '#0a2a46', emissiveIntensity: 0.2, clearcoat: 1, clearcoatRoughness: 0.03});
  }),
  water2: lazy(() => {
    const n = RIPPLES()?.clone() ?? null;
    if (n) { n.repeat.set(2.4, 2.4); n.needsUpdate = true; }
    return new THREE.MeshStandardMaterial({color: '#7cc4ec', roughness: 0.02, metalness: 0.5, transparent: true, opacity: 0.3,
      normalMap: n, normalScale: new THREE.Vector2(0.9, 0.9), depthWrite: false});
  }),
  foam: lazy(() => new THREE.MeshBasicMaterial({color: '#eaf8ff', transparent: true, opacity: 0.35, depthWrite: false})),
  lava: lazy(() => new THREE.MeshStandardMaterial({color: '#1e0c06', roughness: 0.85, emissive: '#ff5a10', emissiveMap: LAVA(), emissiveIntensity: 1.4})),
  hazard: lazy(() => new THREE.MeshStandardMaterial({map: HAZARD(), roughness: 0.6, side: THREE.DoubleSide})),
  core: lazy(() => new THREE.MeshBasicMaterial({color: '#9dff6a', transparent: true, toneMapped: false})),
  shaft: lazy(() => new THREE.MeshBasicMaterial({color: '#ff8a2a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false})),
  column: lazy(() => new THREE.MeshBasicMaterial({color: '#ff9a40', alphaMap: FADE_UP(), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false})),
  pit: lazy(() => new THREE.MeshStandardMaterial({color: '#1a0d09', roughness: 1})),
  neonA: lazy(() => new THREE.MeshBasicMaterial({color: '#ff3fb4', toneMapped: false})),
  neonB: lazy(() => new THREE.MeshBasicMaterial({color: '#3fe0ff', toneMapped: false})),
  holo: lazy(() => new THREE.MeshBasicMaterial({color: '#7fe9ff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false})),
  scanAmber: lazy(() => new THREE.MeshBasicMaterial({color: '#ffcf70', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false})),
  scan: lazy(() => new THREE.MeshBasicMaterial({color: '#ff5040', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false})),
  ore: lazy(() => new THREE.MeshStandardMaterial({color: '#9a6436', roughness: 0.85, flatShading: true})),
  oreTi: lazy(() => new THREE.MeshStandardMaterial({color: '#9aa3b8', roughness: 0.4, metalness: 0.7, flatShading: true})),
  rock: lazy(() => new THREE.MeshStandardMaterial({color: '#5e3424', roughness: 0.95, flatShading: true})),
  flash: lazy(() => new THREE.MeshBasicMaterial({color: '#fff3d8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false})),
};
type OwnerMats = {ring: THREE.MeshBasicMaterial; dash: THREE.MeshBasicMaterial; cube: THREE.MeshStandardMaterial; flag: THREE.MeshStandardMaterial};
export const RIM_DARK = new THREE.MeshBasicMaterial({color: '#000000', transparent: true, opacity: 0.55, depthWrite: false});
const ownerMats = new Map<string, OwnerMats>();
function owner(color?: Color): OwnerMats | null {
  if (!color || color === 'neutral') return null;
  const c = PLAYER_HEX[color] ?? '#ffffff';
  let m = ownerMats.get(c);
  if (!m) {
    m = {ring: new THREE.MeshBasicMaterial({color: c, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false}),
      dash: new THREE.MeshBasicMaterial({color: c, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false, side: THREE.DoubleSide}),
      cube: new THREE.MeshStandardMaterial({color: c, roughness: 0.35, metalness: 0.1, emissive: c, emissiveIntensity: 0.25}),
      flag: new THREE.MeshStandardMaterial({color: c, roughness: 0.6, emissive: c, emissiveIntensity: 0.3, side: THREE.DoubleSide})};
    ownerMats.set(c, m);
  }
  return m;
}

// ---- motes: soft points drifting in a shader (pollen, sparkle, glints, smoke, heat) ------------------------
const MOTE_VS = `uniform float uTime; uniform float uSize; uniform float uRise; uniform float uScale;
attribute float aPhase; attribute float aSpeed; varying float vA;
void main() {
  float k = fract(uTime * aSpeed + aPhase);
  vec3 p = position; p.y += k * uRise; p.x += sin(uTime * 0.9 + aPhase * 30.0) * 0.02; p.z += cos(uTime * 0.7 + aPhase * 20.0) * 0.02;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vA = sin(k * 3.14159) * (0.55 + 0.45 * sin(uTime * 4.0 + aPhase * 50.0));
  gl_PointSize = uSize * uScale / -mv.z * (0.7 + 0.6 * fract(aPhase * 7.0));
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FS = `uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor, a * a * vA * uOpacity); }`;
const moteUniforms: Array<{uTime: {value: number}; uScale: {value: number}}> = [];
function moteMaterial(color: string, size: number, rise: number, opacity = 1, additive = true) {
  const u = {uTime: {value: 0}, uSize: {value: size}, uRise: {value: rise}, uColor: {value: new THREE.Color(color)}, uOpacity: {value: opacity}, uScale: {value: 1000}};
  moteUniforms.push(u);
  return new THREE.ShaderMaterial({uniforms: u, vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending});
}
const MOTES = {
  pollen: lazy(() => moteMaterial('#fff0a8', 0.02, 0.22, 0.85)),
  sparkle: lazy(() => moteMaterial('#ffffff', 0.026, 0.004, 1)),
  glint: lazy(() => moteMaterial('#ffe08a', 0.024, 0.16, 0.95)),
  smoke: lazy(() => moteMaterial('#9a8f86', 0.1, 0.5, 0.5, false)),
  heat: lazy(() => moteMaterial('#ffa040', 0.028, 0.4, 0.95)),
  green: lazy(() => moteMaterial('#b6ff9a', 0.022, 0.14, 0.9)),
  /** bioluminescent glints among the trees: only at night (the ticker sets their strength) */
  firefly: lazy(() => moteMaterial('#c8ff7a', 0.022, 0.08, 0)),
};
function moteGeometry(seed: string, n: number, r: number, y0: number, y1: number): THREE.BufferGeometry {
  const rnd = seeded(seed, 7), pos = new Float32Array(n * 3), ph = new Float32Array(n), sp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
    pos[i * 3] = Math.cos(a) * d; pos[i * 3 + 1] = y0 + rnd() * (y1 - y0); pos[i * 3 + 2] = Math.sin(a) * d;
    ph[i] = rnd(); sp[i] = 0.08 + rnd() * 0.18;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
  return g;
}
function Motes({seed, kind, n, r, y0 = 0.02, y1 = 0.2, at}: {seed: string; kind: keyof typeof MOTES; n: number; r: number; y0?: number; y1?: number; at?: [number, number, number]}) {
  const geo = useMemo(() => moteGeometry(seed + kind, n, r, y0, y1), [seed, kind, n, r, y0, y1]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <points geometry={geo} material={MOTES[kind]()} position={at} frustumCulled={false} renderOrder={6} />;
}

/** A burst of particles for a build-in: thrown up and outward, falling back, gone after `length` seconds. */
function Burst({seed, color, n, r, up, age, at = 0, length, size = 0.03}: {seed: string; color: string; n: number; r: number; up: number; age: () => number; at?: number; length: number; size?: number}) {
  const ref = useRef<THREE.Points>(null);
  const data = useMemo(() => {
    const rnd = seeded(seed, 99), v = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, s = 0.25 + rnd() * 0.75; v[i * 3] = Math.cos(a) * r * s; v[i * 3 + 1] = up * (0.4 + rnd() * 0.9); v[i * 3 + 2] = Math.sin(a) * r * s; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return {v, g};
  }, [seed, n, r, up]);
  const mat = useMemo(() => new THREE.PointsMaterial({color, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}), [color, size]);
  useEffect(() => () => { data.g.dispose(); mat.dispose(); }, [data, mat]);
  useFrame(() => {
    const p = ref.current;
    if (!p) return;
    const a = age() - at;
    if (!(a > 0 && a < length)) { p.visible = false; return; }
    p.visible = true;
    const t = a / length, e = 1 - (1 - t) * (1 - t), pos = data.g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) pos.setXYZ(i, data.v[i * 3] * e * 1.2, Math.max(0, data.v[i * 3 + 1] * (e * 1.6 - t * t * 1.4)), data.v[i * 3 + 2] * e * 1.2);
    pos.needsUpdate = true;
    mat.opacity = Math.min(1, (1 - t) * 1.5);
  });
  return <points ref={ref} geometry={data.g} material={mat} frustumCulled={false} visible={false} renderOrder={7} />;
}

/** A soft flash (lights flicking on, a stamp landing): a glowing ball that blooms and fades. */
function Flash({age, at, length = 0.5, size, y = 0, z = 0}: {age: () => number; at: number; length?: number; size: number; y?: number; z?: number}) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => M.flash().clone(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const k = (age() - at) / length;
    m.visible = k > 0 && k < 1;
    if (m.visible) { m.scale.set(size * (0.3 + k * 1.4), size * (0.15 + k * 0.6), size * (0.3 + k * 1.4)); mat.opacity = 0.8 * (1 - k) * Math.min(1, k * 6); }
  });
  return <mesh ref={ref} geometry={BALL} material={mat} position={[0, y, z]} visible={false} renderOrder={8} />;
}

/** A shockwave in the owner's colour, spreading across the ground from the tile's centre. */
function Shock({age, at, color, R, length = 0.9}: {age: () => number; at: number; color?: Color; R: number; length?: number}) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({color: color && color !== 'neutral' ? PLAYER_HEX[color] ?? '#fff' : '#fff', transparent: true,
    opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending}), [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const k = (age() - at) / length;
    m.visible = k > 0 && k < 1;
    if (m.visible) { m.scale.setScalar(R * (0.3 + easeOutCubic(k) * 1.6)); mat.opacity = 0.9 * (1 - k); }
  });
  return <mesh ref={ref} geometry={RING} material={mat} position={[0, 0.006, 0]} visible={false} renderOrder={8} />;
}

// ---- owner identity -----------------------------------------------------------------------------------------
/** Whether the board draws every owner rim itself, two instanced draws for the whole board (Board3D OwnerRims);
 *  until then (and in the labs, which show one model) each tile draws its own. */
export const ownerRims = {board: false};

/** The owner's rim round the hex top: a bright band of their colour on a dark under-stroke, glowing at night. One
 *  consistent marker on every owned tile, whatever its model, readable from the default camera. */
function Owner({color, R}: {color?: Color; R: number; age?: () => number; at?: number}) {
  const m = owner(color);
  if (!m || ownerRims.board) return null;
  return (
    <>
      <mesh geometry={RIM_UNDER} material={RIM_DARK} scale={[R, 1, R]} position={[0, 0.003, 0]} renderOrder={3} />
      <mesh geometry={RIM} material={m.ring} scale={[R, 1, R]} position={[0, 0.0045, 0]} renderOrder={4} />
    </>
  );
}

/** A Land Claim: a dashed rim in the player's colour and their flag planted at the back of the empty space. */
export function ClaimFlag({color, R}: {color?: Color; R: number}) {
  const m = owner(color);
  const flag = useRef<THREE.Mesh>(null);
  const ph = useMemo(() => Math.random() * 6.28, []);
  useFrame(() => { if (flag.current) flag.current.rotation.y = 0.25 * Math.sin(world.t * 2.3 + ph) + 0.1 * Math.sin(world.t * 5.1 + ph); });
  if (!m) return null;
  const H = R * 0.62;
  return (
    <>
    <mesh geometry={RIM_UNDER} material={RIM_DARK} scale={[R, 1, R]} position={[0, 0.003, 0]} renderOrder={3} />
    <mesh geometry={DASHED_RIM} material={m.dash} scale={[R, 1, R]} position={[0, 0.0045, 0]} renderOrder={4} />
    <group position={[-R * 0.19, 0, -R * 0.62]}>
      <mesh geometry={STICK} material={M.concrete()} scale={[R * 0.018, H, R * 0.018]} castShadow />
      <mesh geometry={BALL} material={M.gold()} position={[0, H, 0]} scale={R * 0.03} />
      <group position={[0, H * 0.97, 0]}>
        <mesh ref={flag} geometry={FLAG} material={m.flag} scale={[R * 0.42, R * 0.24, 1]} castShadow />
      </group>
      <Halo color={PLAYER_HEX[color as keyof typeof PLAYER_HEX] ?? '#ffffff'} size={R * 0.5} at={[R * 0.2, H * 0.85, 0]} day={0} />
    </group>
    </>
  );
}
/** keep-out spot for the owner's cube (local x, z, radius) */
const cubeSpot = (R: number) => ({x: 0, z: R * 0.7, r: R * 0.16});

// ---- cities -------------------------------------------------------------------------------------------------
/** A tower part: a base shaft, or a setback standing on its shaft (y0 > 0). */
type Part = {x: number; z: number; r: number; h: number; y0: number; delay: number; slab: boolean; rot: number};
type Dome = {x: number; z: number; r: number; h: number; delay: number};
function cityPlan(id: string, R: number, capital: boolean) {
  const rnd = seeded(id, capital ? 3 : 2);
  const towers: Part[] = [], domes: Dome[] = [];
  const nT = capital ? 8 : 5 + Math.floor(rnd() * 3), nD = capital ? 2 : 1 + Math.floor(rnd() * 2);
  const taken: Array<{x: number; z: number; r: number}> = [cubeSpot(R)];
  if (capital) taken.push({x: 0, z: 0, r: R * 0.17});
  const place = (r: number, spread: number) => {
    for (let k = 0; k < 80; k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * spread;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r + R * 0.012)) { taken.push({x, z, r}); return {x, z}; }
    }
    return null;
  };
  for (let i = 0; i < nD; i++) {
    const r = R * (0.24 + rnd() * 0.1), p = place(r, 0.5);
    if (p) domes.push({...p, r, h: r * (0.62 + rnd() * 0.3), delay: 0.55 + i * 0.12});
  }
  for (let i = 0; i < nT; i++) {
    const r = R * (0.085 + rnd() * 0.06), p = place(r, 0.7);
    if (!p) continue;
    // one hero tower per city, the rest a varied skyline
    const h = R * (i === 0 && !capital ? 1.25 + rnd() * 0.3 : 0.4 + Math.pow(rnd(), 1.4) * 0.85);
    const slab = rnd() < 0.4, rot = rnd() * Math.PI;
    towers.push({...p, r, h, y0: 0, delay: 0, slab, rot});
    if (h > R * 0.6 && rnd() < 0.7) towers.push({...p, r: r * 0.62, h: h * (0.18 + rnd() * 0.15), y0: h, delay: 0, slab, rot});
  }
  // low blocks fill the ground between the towers
  for (let i = 0; i < (capital ? 3 : 4); i++) {
    const r = R * (0.09 + rnd() * 0.06), p = place(r, 0.78);
    if (p) towers.push({...p, r, h: R * (0.12 + rnd() * 0.16), y0: 0, delay: 0, slab: true, rot: rnd() * Math.PI});
  }
  // the build runs back to front; setbacks follow their shafts
  towers.filter((t) => !t.y0).sort((a, b) => a.z - b.z).forEach((t, i) => { t.delay = i * 0.09; });
  for (const t of towers) if (t.y0) t.delay = (towers.find((b) => !b.y0 && b.x === t.x && b.z === t.z)?.delay ?? 0) + 0.35;
  return {towers: towers.filter((t) => !t.slab), slabs: towers.filter((t) => t.slab), domes};
}

const TOWER_TINTS = ['#ffffff', '#f3e3cc', '#cfe0ef', '#e8d2b4', '#dfe6ea', '#c9d6e8'].map((c) => new THREE.Color(c));

function City({id, tileType, color, fresh, radius: R}: TileModelProps) {
  const capital = tileType === TILE.CAPITAL;
  const plan = useMemo(() => cityPlan(id, R, capital), [id, R, capital]);
  const age = useBirth(fresh, 2.4);
  const towers = useRef<THREE.InstancedMesh>(null);
  const slabs = useRef<THREE.InstancedMesh>(null);
  const domes = useRef<THREE.InstancedMesh>(null);
  const parks = useRef<THREE.InstancedMesh>(null);
  const shuttle = useRef<THREE.Group>(null);
  const spire = useRef<THREE.Group>(null);
  const lights = useRef<THREE.Group>(null);
  const tops = useMemo(() => [...plan.towers, ...plan.slabs].filter((t) => t.y0 === 0).sort((a, b) => b.h - a.h).slice(0, capital ? 2 : 3), [plan, capital]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const orbit = useMemo(() => { const r = seeded(id, 5); return {r: R * (0.62 + r() * 0.12), h: R * (0.7 + r() * 0.25), s: (r() > 0.5 ? 1 : -1) * (0.45 + r() * 0.35), p: r() * 6.28}; }, [id, R]);
  const settled = useRef(false);
  const rise = (p: Part, a: number) => (a === Infinity ? 1 : easeOutBack((a - p.delay) / 0.6));
  const tint = useMemo(() => { const r = seeded(id, 9); return [...plan.towers, ...plan.slabs].map(() => TOWER_TINTS[Math.floor(r() * TOWER_TINTS.length)]); }, [id, plan]);
  useEffect(() => {
    // each building its own cladding: warm stone, white, blue glass, bronze
    [towers.current, slabs.current].forEach((m, j) => {
      if (!m) return;
      const off = j ? plan.towers.length : 0;
      for (let i = 0; i < m.count; i++) m.setColorAt(i, tint[off + i]);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }, [tint, plan]);
  const put = (m: THREE.InstancedMesh | null, parts: Part[], a: number) => {
    if (!m) return;
    parts.forEach((p, i) => {
      // shafts rise from the ground floor up, overshooting a touch; setbacks ride on top
      const k = rise(p, a);
      const base = p.y0 ? p.y0 * Math.min(1, rise({...p, delay: p.delay - 0.35}, a)) : 0;
      tmp.position.set(p.x, base, p.z); tmp.rotation.set(0, p.rot, 0); tmp.scale.set(p.r * (p.slab ? 1.5 : 1), Math.max(0.0001, p.h * k), p.r * (p.slab ? 1.1 : 1));
      tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  };
  const set = (a: number) => {
    put(towers.current, plan.towers, a);
    put(slabs.current, plan.slabs, a);
    const d = domes.current, pk = parks.current;
    if (!d || !pk) return;
    tmp.rotation.set(0, 0, 0);
    plan.domes.forEach((p, i) => {
      const k = a === Infinity ? 1 : easeOutBack((a - p.delay) / 0.5);
      tmp.position.set(p.x, 0, p.z); tmp.scale.set(p.r * k + 0.0001, p.h * k + 0.0001, p.r * k + 0.0001); tmp.updateMatrix(); d.setMatrixAt(i, tmp.matrix);
      tmp.position.y = 0.0015; tmp.scale.set(p.r * 0.97 * k + 0.0001, 1, p.r * 0.97 * k + 0.0001); tmp.updateMatrix(); pk.setMatrixAt(i, tmp.matrix);
    });
    d.instanceMatrix.needsUpdate = true; pk.instanceMatrix.needsUpdate = true;
  };
  useEffect(() => { settled.current = false; }, [plan]);
  useFrame(() => {
    const a = age();
    if (a !== Infinity) { set(a); settled.current = false; } else if (!settled.current) { set(Infinity); settled.current = true; }
    const s = shuttle.current;
    if (s) {
      const t = world.t * orbit.s + orbit.p;
      s.position.set(Math.cos(t) * orbit.r, orbit.h + Math.sin(t * 2) * R * 0.04, Math.sin(t) * orbit.r);
      s.visible = a > 1.6;
    }
    if (spire.current) spire.current.scale.set(1, a === Infinity ? 1 : Math.max(0.0001, easeOutBack((a - 0.25) / 0.9)), 1);
    // the lights flick on together once the city stands
    if (lights.current) lights.current.visible = a > 1.25;
  });
  return (
    <group>
      <Owner color={color} R={R} age={age} at={1.5} />
      <instancedMesh ref={parks} args={[DISC, M.park(), plan.domes.length]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={towers} args={[TOWER, M.facade(), plan.towers.length]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={slabs} args={[BOX, M.facade(), plan.slabs.length]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={domes} args={[DOME, M.glass(), plan.domes.length]} renderOrder={4} frustumCulled={false} />
      {capital && (
        <group ref={spire}>
          <mesh geometry={TOWER} material={M.facade()} scale={[R * 0.14, R * 0.95, R * 0.14]} castShadow />
          <mesh geometry={CONE} material={M.gold()} position={[0, R * 0.95, 0]} scale={[R * 0.11, R * 1.25, R * 0.11]} castShadow />
          <mesh geometry={TORUS} material={M.amber()} rotation={[Math.PI / 2, 0, 0]} position={[0, R * 1.02, 0]} scale={[R * 0.18, R * 0.18, R * 0.5]} />
          <mesh geometry={TORUS} material={M.gold()} rotation={[Math.PI / 2, 0, 0]} position={[0, R * 0.04, 0]} scale={[R * 0.18, R * 0.18, R * 0.7]} />
          <mesh geometry={TORUS} material={M.gold()} rotation={[Math.PI / 2, 0, 0]} position={[0, R * 0.5, 0]} scale={[R * 0.15, R * 0.15, R * 0.5]} />
        </group>
      )}
      <group ref={lights}>
        {tops.map((p, i) => (
          <group key={i} position={[p.x, p.h + R * 0.03, p.z]}>
            <mesh geometry={BALL} material={i ? M.beaconB() : M.beaconA()} scale={R * 0.022} />
            <Halo color={i ? '#ffffff' : '#ff4a3a'} size={R * 0.3} at={[0, 0, 0]} day={0.15} blink={i ? 2.1 : 3.2} />
          </group>
        ))}
        {capital && <Halo color="#fff2c0" size={R * 0.5} at={[0, R * 2.22, 0]} day={0.3} blink={1.4} />}
        {capital && <mesh geometry={BALL} material={M.beaconB()} position={[0, R * 2.22, 0]} scale={R * 0.03} />}
        {/* the city's own light on the night air */}
        <Halo color="#ffae5a" size={R * 2.6} sy={0.75} at={[0, R * 0.45, 0]} day={0} />
      </group>
      <group ref={shuttle}>
        <mesh geometry={BALL} material={M.amber()} scale={[R * 0.03, R * 0.014, R * 0.03]} />
        <Halo color="#ffc070" size={R * 0.22} at={[0, 0, 0]} day={0.25} />
      </group>
      <Flash age={age} at={1.25} size={R * 0.75} y={R * 0.4} />
      <Burst seed={id} color="#ffd9a0" n={36} r={R * 0.8} up={R * 0.7} age={age} at={1.25} length={1.0} size={0.024} />
    </group>
  );
}

// ---- greenery ----------------------------------------------------------------------------------------------
type Tree = {x: number; z: number; s: number; rot: number; delay: number; c: THREE.Color};
function forest(id: string, R: number, n: number, spread: number, opts: {hue?: number; zMax?: number; keep?: Array<{x: number; z: number; r: number}>; gap?: number; tall?: number} = {}): {con: Tree[]; leaf: Tree[]} {
  const {hue = 0, zMax = Infinity, keep = [], gap = 0.1, tall = 1} = opts;
  const rnd = seeded(id, 11 + hue);
  const con: Tree[] = [], leaf: Tree[] = [];
  const pts: Array<{x: number; z: number}> = [];
  // a hex's inner radius is R·cos30°: keep trunks inside the hex, not just inside its circle
  const inHex = (x: number, z: number) => { const ax = Math.abs(x), az = Math.abs(z); return ax <= R * 0.866 * spread && ax * 0.5 + az * 0.866 <= R * 0.866 * spread; };
  for (let k = 0; pts.length < n && k < n * 40; k++) {
    const x = (rnd() * 2 - 1) * R, z = (rnd() * 2 - 1) * R;
    if (!inHex(x, z) || z > zMax) continue;
    if (keep.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) continue;
    if (pts.every((p) => Math.hypot(p.x - x, p.z - z) > R * gap)) pts.push({x, z});
  }
  for (const p of pts) {
    const d = Math.hypot(p.x, p.z) / R;
    // tall in the middle, lower toward the edges, with some young trees and dark understorey between
    const young = rnd() < 0.25;
    const t: Tree = {...p, s: R * tall * (young ? 0.2 + rnd() * 0.12 : 0.36 + rnd() * 0.3) * (1.15 - d * 0.35), rot: rnd() * 6.28, delay: d * 0.7 + rnd() * 0.1,
      c: new THREE.Color().setHSL((0.24 + rnd() * 0.12 + hue * 0.015) % 1, 0.38 + rnd() * 0.3, young ? 0.16 + rnd() * 0.08 : 0.22 + rnd() * 0.17)};
    (rnd() < 0.55 ? con : leaf).push(t);
  }
  return {con, leaf};
}

function Trees({trees, geometry, age}: {trees: Tree[]; geometry: THREE.BufferGeometry; age: () => number}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const settled = useRef(false);
  const apply = (a: number) => {
    const m = ref.current;
    if (!m) return;
    trees.forEach((t, i) => {
      // a wave from the centre: each tree bursts up a beat after the ones inside it
      const k = a === Infinity ? 1 : easeOutBack((a - t.delay) / 0.45);
      tmp.position.set(t.x, 0, t.z); tmp.rotation.set(0, t.rot, 0);
      tmp.scale.set(Math.max(0.0001, t.s * Math.min(1.15, k * 1.05)), Math.max(0.0001, t.s * k), Math.max(0.0001, t.s * Math.min(1.15, k * 1.05)));
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  };
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    trees.forEach((t, i) => m.setColorAt(i, t.c));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    settled.current = false;
  }, [trees]);
  useFrame(() => {
    const a = age();
    if (a !== Infinity) { apply(a); settled.current = false; } else if (!settled.current) { apply(Infinity); settled.current = true; }
  });
  if (!trees.length) return null;
  return <instancedMesh ref={ref} args={[geometry, M.trees(), trees.length]} castShadow receiveShadow frustumCulled={false} />;
}

/** Mossy ground that spreads out from the centre as the tile appears. */
function Ground({R, age, material, scale = 0.985, z = 0}: {R: number; age: () => number; material: THREE.Material; scale?: number; z?: number}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const a = age(), k = a === Infinity ? 1 : easeOutCubic(a / 0.8);
    g.scale.set(R * scale * k + 0.0001, 1, R * scale * k + 0.0001);
  });
  return <mesh ref={ref} geometry={HEX_DISC} material={material} position={[0, 0.0012, z]} receiveShadow />;
}

function Greenery({id, color, fresh, radius: R}: TileModelProps) {
  const f = useMemo(() => forest(id, R, 42, 0.95, {keep: [cubeSpot(R)], gap: 0.1}), [id, R]);
  const age = useBirth(fresh, 2.0);
  return (
    <group>
      <Ground R={R} age={age} material={M.moss()} />
      <Owner color={color} R={R} age={age} at={1.0} />
      <Trees trees={f.con} geometry={CONIFER} age={age} />
      <Trees trees={f.leaf} geometry={BROADLEAF} age={age} />
      <Motes seed={id} kind="pollen" n={14} r={R * 0.75} y0={R * 0.15} y1={R * 0.6} />
      <Motes seed={id} kind="firefly" n={12} r={R * 0.8} y0={R * 0.05} y1={R * 0.35} />
      <Burst seed={id} color="#d4ff9a" n={40} r={R * 0.95} up={R * 0.9} age={age} length={1.2} />
    </group>
  );
}

// ---- oceans -------------------------------------------------------------------------------------------------
function Ocean({id, color, fresh, radius: R}: TileModelProps) {
  const age = useBirth(fresh, 2.2);
  const water = useRef<THREE.Group>(null);
  const foam = useRef<THREE.Mesh>(null);
  const splash = useRef<THREE.Mesh>(null);
  const ph = useMemo(() => seeded(id, 13)() * 6.28, [id]);
  const foamMat = useMemo(() => M.foam().clone(), []);
  const splashMat = useMemo(() => M.foam().clone(), []);
  useEffect(() => () => { foamMat.dispose(); splashMat.dispose(); }, [foamMat, splashMat]);
  useFrame(() => {
    const a = age(), w = water.current;
    if (w) {
      // floods out from the centre, overshoots the rim a hair and settles with a slow swell
      const k = a === Infinity ? 1 : easeOutBack(a / 0.85);
      w.scale.set(R * 0.99 * Math.min(k, 1.03) + 0.0001, 1, R * 0.99 * Math.min(k, 1.03) + 0.0001);
      const rise = a === Infinity ? 0 : Math.exp(-a * 3) * Math.sin(a * 11) * 0.012;
      w.position.y = 0.004 + Math.sin(world.t * 0.9 + ph) * 0.0025 + rise;
    }
    const f = foam.current;
    if (f) { foamMat.opacity = (0.2 + 0.18 * (0.5 + 0.5 * Math.sin(world.t * 1.6 + ph))) * (a === Infinity ? 1 : clamp01((a - 0.5) / 0.6)); }
    const s = splash.current;
    if (s) {
      const k = (a - 0.45) / 0.7;
      s.visible = k > 0 && k < 1;
      if (s.visible) { s.scale.set(R * (0.5 + k * 0.7), R * (0.5 * Math.sin(k * Math.PI)), R * (0.5 + k * 0.7)); splashMat.opacity = 0.5 * (1 - k); }
    }
  });
  return (
    <group>
      <group ref={water}>
        <mesh geometry={HEX_DISC} material={M.water()} receiveShadow renderOrder={2} />
        <mesh geometry={HEX_DISC} material={M.water2()} position={[0, 0.0015, 0]} renderOrder={3} />
      </group>
      <mesh ref={foam} geometry={HEX_RING} material={foamMat} scale={[R, 1, R]} position={[0, 0.008, 0]} renderOrder={4} />
      <mesh ref={splash} geometry={SHAFT} material={splashMat} visible={false} renderOrder={5} />
      <Owner color={color} R={R} age={age} at={1.0} />
      <Motes seed={id} kind="sparkle" n={9} r={R * 0.72} y0={0.012} y1={0.014} />
      <Burst seed={id} color="#cdeeff" n={46} r={R * 0.7} up={R * 1.0} age={age} at={0.35} length={1.1} size={0.032} />
    </group>
  );
}

// ---- special tiles ------------------------------------------------------------------------------------------
/** Specials stamp down from above and settle with a squash; a shockwave in the owner's colour marks the landing. */
const STAMP_FALL = 0.4;
function Stamp({age, children}: {age: () => number; children: React.ReactNode}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const a = age();
    if (a === Infinity) { g.position.y = 0; g.scale.set(1, 1, 1); g.visible = true; return; }
    g.visible = a >= 0;
    if (a < STAMP_FALL) { const k = easeInCubic(a / STAMP_FALL); g.position.y = (1 - k) * 1.0; g.scale.set(0.92, 1.12, 0.92); }
    else { const k = (a - STAMP_FALL) / 0.7; g.position.y = 0; const sq = Math.exp(-k * 5) * Math.cos(k * 15) * 0.22; g.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5); }
  });
  return <group ref={ref}>{children}</group>;
}

/** The back half of the hex, where a special's structure stands so the painted name in front stays legible. */
function Back({R, children}: {R: number; children: React.ReactNode}) {
  return <group position={[0, 0, -R * 0.22]} scale={0.98}>{children}</group>;
}

type SpecialProps = TileModelProps & {age: () => number};

function Mohole({id, radius: R}: SpecialProps) {
  const glow = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => M.column().clone(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  // a heat column rising from the shaft: faint by day, a beacon at night
  useFrame(() => { mat.opacity = 0.32 + 0.1 * Math.sin(world.t * 2.2) + world.night * 0.5; });
  return (
    <>
      <mesh geometry={TORUS} material={M.darkMetal()} rotation={[Math.PI / 2, 0, 0]} position={[0, R * 0.03, 0]} scale={[R * 0.48, R * 0.48, R * 2.2]} castShadow />
      <mesh geometry={DISC} material={M.pit()} position={[0, 0.003, 0]} scale={[R * 0.46, 1, R * 0.46]} />
      <mesh ref={glow} geometry={SHAFT} material={mat} scale={[R * 0.3, R * 1.3, R * 0.3]} renderOrder={5} />
      <Halo color="#ff8a2a" size={R * 1.2} at={[0, R * 0.15, 0]} day={0.3} />
      <Halo color="#ffb060" size={R * 0.7} sy={2.2} at={[0, R * 1.0, 0]} day={0.05} />
      <mesh geometry={DISC} material={M.amber()} position={[0, 0.004, 0]} scale={[R * 0.22, 1, R * 0.22]} />
      {[0, 1, 2].map((i) => {
        const a = i * 2.094 + 0.5;
        return <mesh key={i} geometry={BOX} material={M.darkMetal()} position={[Math.cos(a) * R * 0.4, 0, Math.sin(a) * R * 0.4]}
          rotation={[Math.sin(a) * 0.26, 0, -Math.cos(a) * 0.26]} scale={[R * 0.04, R * 1.0, R * 0.04]} castShadow />;
      })}
      <mesh geometry={BOX} material={M.darkMetal()} position={[0, R * 0.95, 0]} scale={[R * 0.16, R * 0.06, R * 0.16]} castShadow />
      <mesh geometry={STICK} material={M.darkMetal()} position={[0, R * 0.2, 0]} scale={[R * 0.012, R * 0.75, R * 0.012]} />
      <mesh geometry={BALL} material={M.beaconA()} position={[0, R * 1.05, 0]} scale={R * 0.035} />
      <Halo color="#ff4a3a" size={R * 0.3} at={[0, R * 1.05, 0]} day={0.15} blink={3.2} />
      <Motes seed={id} kind="heat" n={26} r={R * 0.25} y0={R * 0.05} y1={R * 0.5} />
    </>
  );
}

function Nuclear({radius: R}: SpecialProps) {
  const core = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => M.core().clone(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const p = 0.5 + 0.5 * Math.sin(world.t * 2.6);
    mat.opacity = 0.55 + 0.45 * p;
    core.current?.scale.setScalar(R * (0.12 + 0.03 * p));
  });
  return (
    <>
      <mesh geometry={SHAFT} material={M.hazard()} scale={[R * 0.72, R * 0.08, R * 0.72]} />
      <mesh geometry={SHAFT} material={M.concrete()} scale={[R * 0.5, R * 0.18, R * 0.5]} castShadow />
      <mesh geometry={DOME} material={M.concrete()} position={[0, R * 0.18, 0]} scale={[R * 0.5, R * 0.46, R * 0.5]} castShadow receiveShadow />
      <mesh geometry={TORUS} material={M.core()} rotation={[Math.PI / 2, 0, 0]} position={[0, R * 0.2, 0]} scale={[R * 0.51, R * 0.51, R * 0.4]} />
      <mesh ref={core} geometry={BALL} material={mat} position={[0, R * 0.66, 0]} scale={R * 0.13} />
      <Halo color="#9dff6a" size={R * 0.9} at={[0, R * 0.66, 0]} day={0.35} />
      <Halo color="#9dff6a" size={R * 1.4} sy={0.4} at={[0, R * 0.22, 0]} day={0.1} />
      <mesh geometry={COOLING} material={M.concrete()} position={[-R * 0.66, 0, -R * 0.08]} scale={[R * 0.22, R * 0.82, R * 0.22]} castShadow />
      <mesh geometry={COOLING} material={M.concrete()} position={[R * 0.66, 0, 0.0]} scale={[R * 0.19, R * 0.68, R * 0.19]} castShadow />
      <Motes seed="nuclear" kind="smoke" n={10} r={R * 0.1} y0={R * 0.82} y1={R * 0.9} at={[-R * 0.66, 0, -R * 0.08]} />
    </>
  );
}

function Mine({id, tileType, radius: R}: SpecialProps) {
  const wheel = useRef<THREE.Group>(null);
  const lights = useRef<THREE.Group>(null);
  const titanium = tileType === TILE.MINING_TITANIUM_BONUS;
  const steel = tileType === TILE.MINING_STEEL_BONUS;
  useFrame(() => {
    if (wheel.current) wheel.current.rotation.z = world.t * 1.6;
    lights.current?.children.forEach((c, i) => { c.visible = Math.sin(world.t * 3 + i * 2.1) > -0.3; });
  });
  const H = R * 1.15;
  const ore = titanium ? M.oreTi() : steel ? M.ore() : M.rock();
  return (
    <>
      {/* the headframe: four legs, a deck, a turning wheel */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} geometry={BOX} material={M.darkMetal()} position={[sx * R * 0.15, 0, sz * R * 0.15]} rotation={[sz * 0.1, 0, -sx * 0.1]} scale={[R * 0.035, H, R * 0.035]} castShadow />
      ))}
      <mesh geometry={BOX} material={M.darkMetal()} position={[0, H * 0.5, 0]} scale={[R * 0.4, R * 0.03, R * 0.4]} />
      <mesh geometry={BOX} material={M.darkMetal()} position={[0, H * 0.82, 0]} scale={[R * 0.3, R * 0.025, R * 0.3]} />
      {/* floodlight cone onto the ore heaps */}
      <mesh geometry={CONE} material={M.scanAmber()} position={[R * 0.22, H * 0.55, R * 0.18]} rotation={[0.6, 0, -1.9]} scale={[R * 0.16, R * 0.5, R * 0.16]} renderOrder={5} />
      <group ref={wheel} position={[0, H, 0]}>
        <mesh geometry={TORUS} material={M.gold()} scale={R * 0.19} />
        {[0, 1, 2].map((i) => <mesh key={i} geometry={STICK} material={M.gold()} rotation={[0, 0, i * 1.047]} position={[Math.sin(i * 1.047) * R * 0.19, -Math.cos(i * 1.047) * R * 0.19, 0]} scale={[R * 0.012, R * 0.38, R * 0.012]} />)}
      </group>
      <mesh geometry={CONE} material={ore} position={[R * 0.5, 0, R * 0.05]} scale={[R * 0.26, R * 0.22, R * 0.26]} castShadow />
      <mesh geometry={CONE} material={ore} position={[R * 0.32, 0, R * 0.32]} scale={[R * 0.16, R * 0.13, R * 0.16]} castShadow />
      <mesh geometry={BOX} material={M.block()} position={[-R * 0.48, 0, 0]} scale={[R * 0.3, R * 0.18, R * 0.24]} castShadow receiveShadow />
      {/* ore cart on a rail */}
      <mesh geometry={BOX} material={M.darkMetal()} position={[0, 0, R * 0.35]} scale={[R * 0.7, R * 0.012, R * 0.04]} />
      <mesh geometry={BOX} material={titanium ? M.oreTi() : M.ore()} position={[-R * 0.12, R * 0.012, R * 0.35]} scale={[R * 0.12, R * 0.07, R * 0.08]} castShadow />
      <group ref={lights}>
        {[[R * 0.2, H * 0.52, R * 0.2], [-R * 0.2, H * 0.52, -R * 0.2], [-R * 0.48, R * 0.19, R * 0.1]].map((p, i) => (
          <group key={i} position={p as [number, number, number]}>
            <mesh geometry={BALL} material={M.amber()} scale={R * 0.028} />
            <Halo color="#ffb23a" size={R * 0.4} at={[0, 0, 0]} day={0.2} />
          </group>
        ))}
      </group>
      <Motes seed={id} kind="smoke" n={7} r={R * 0.1} y0={R * 0.2} y1={R * 0.3} at={[-R * 0.48, 0, 0]} />
      {(titanium || steel) && <Motes seed={id} kind="glint" n={10} r={R * 0.2} y0={R * 0.05} y1={R * 0.2} at={[R * 0.45, 0, R * 0.12]} />}
    </>
  );
}

function Preserve({id, radius: R, age}: SpecialProps) {
  const f = useMemo(() => forest(id, R, 12, 0.85, {hue: 2, zMax: R * 0.05}), [id, R]);
  const posts = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = posts.current;
    if (!m) return;
    const tmp = new THREE.Object3D();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; tmp.position.set(Math.cos(a) * R * 0.85, 0, Math.sin(a) * R * 0.85); tmp.scale.set(R * 0.018, R * 0.11, R * 0.018); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); }
    m.instanceMatrix.needsUpdate = true;
  }, [R]);
  return (
    <>
      <Ground R={R} age={age} material={M.moss()} scale={0.9} />
      <instancedMesh ref={posts} args={[STICK, M.gold(), 16]} frustumCulled={false} />
      <mesh geometry={RAIL} material={M.gold()} rotation={[Math.PI / 2, 0, 0]} position={[0, R * 0.1, 0]} scale={[R * 0.85, R * 0.85, R * 0.6]} />
      <Trees trees={f.con} geometry={CONIFER} age={age} />
      <Trees trees={f.leaf} geometry={BROADLEAF} age={age} />
      <Motes seed={id} kind="glint" n={18} r={R * 0.7} y0={R * 0.1} y1={R * 0.35} />
    </>
  );
}

function EcoZone({id, radius: R, age}: SpecialProps) {
  const f = useMemo(() => forest(id, R, 12, 0.88, {hue: 4, zMax: R * 0.1, keep: [{x: 0, z: -R * 0.1, r: R * 0.36}]}), [id, R]);
  return (
    <>
      <Ground R={R} age={age} material={M.moss()} scale={0.9} />
      <mesh geometry={DISC} material={M.park()} position={[0, 0.003, -R * 0.1]} scale={[R * 0.3, 1, R * 0.3]} />
      <mesh geometry={DOME} material={M.glass()} position={[0, 0, -R * 0.1]} scale={[R * 0.32, R * 0.3, R * 0.32]} renderOrder={4} />
      <mesh geometry={BALL} material={M.core()} position={[0, R * 0.1, -R * 0.1]} scale={R * 0.05} />
      <Trees trees={f.con} geometry={CONIFER} age={age} />
      <Trees trees={f.leaf} geometry={BROADLEAF} age={age} />
      <Motes seed={id} kind="green" n={18} r={R * 0.75} y0={R * 0.05} y1={R * 0.3} />
    </>
  );
}

function Restricted({radius: R}: SpecialProps) {
  const scan = useRef<THREE.Group>(null);
  const posts = useRef<THREE.InstancedMesh>(null);
  const warn = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const m = posts.current;
    if (!m) return;
    const tmp = new THREE.Object3D();
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; tmp.position.set(Math.cos(a) * R * 0.8, 0, Math.sin(a) * R * 0.8); tmp.scale.set(R * 0.014, R * 0.22, R * 0.014); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); }
    m.instanceMatrix.needsUpdate = true;
  }, [R]);
  useFrame(() => {
    if (scan.current) scan.current.rotation.y = world.t * 0.9;
    if (warn.current) warn.current.visible = Math.sin(world.t * 4) > 0;
  });
  return (
    <>
      <instancedMesh ref={posts} args={[STICK, M.darkMetal(), 20]} frustumCulled={false} castShadow />
      {[0.08, 0.2].map((y, i) => <mesh key={i} geometry={RAIL} material={M.darkMetal()} rotation={[Math.PI / 2, 0, 0]} position={[0, R * y, 0]} scale={[R * 0.8, R * 0.8, R * 0.5]} />)}
      <mesh geometry={BOX} material={M.block()} scale={[R * 0.6, R * 0.3, R * 0.42]} castShadow receiveShadow />
      <mesh geometry={DOME} material={M.concrete()} position={[-R * 0.15, R * 0.3, 0]} scale={[R * 0.14, R * 0.12, R * 0.14]} castShadow />
      <mesh geometry={BOX} material={M.darkMetal()} position={[R * 0.15, R * 0.3, 0]} scale={[R * 0.1, R * 0.52, R * 0.1]} castShadow />
      <group ref={scan} position={[R * 0.15, R * 0.86, 0]}>
        <mesh geometry={CONE} material={M.scan()} rotation={[0, 0, Math.PI / 2 + 0.62]} position={[R * 0.42, -R * 0.3, 0]} scale={[R * 0.2, R * 0.95, R * 0.2]} renderOrder={5} />
      </group>
      <mesh geometry={BALL} material={M.beaconA()} position={[R * 0.15, R * 0.88, 0]} scale={R * 0.045} />
      <Halo color="#ff4a3a" size={R * 0.5} at={[R * 0.15, R * 0.88, 0]} day={0.3} />
      <mesh ref={warn} geometry={BALL} material={M.beaconA()} position={[-R * 0.3, R * 0.32, 0]} scale={R * 0.03} />
    </>
  );
}

function Commerce({radius: R}: SpecialProps) {
  const holo = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const h = holo.current;
    if (h) { h.rotation.z = world.t * 0.8; h.position.y = R * (0.66 + Math.sin(world.t * 1.4) * 0.03); }
  });
  const blocks: Array<[number, number, number, number, number]> = [[-0.48, -0.1, 0.26, 0.72, 0.24], [0.46, -0.15, 0.24, 1.05, 0.24], [-0.15, -0.45, 0.3, 0.55, 0.22], [0.2, -0.48, 0.22, 0.8, 0.2]];
  return (
    <>
      <mesh geometry={DISC} material={M.concrete()} position={[0, 0.002, 0]} scale={[R * 0.32, 1, R * 0.32]} receiveShadow />
      {blocks.map(([x, z, w, h, d], i) => (
        <group key={i} position={[x * R, 0, z * R]}>
          <mesh geometry={BOX} material={M.block()} scale={[w * R, h * R, d * R]} castShadow receiveShadow />
          <mesh geometry={BOX} material={i % 2 ? M.neonA() : M.neonB()} position={[0, h * R * 0.78, d * R * 0.51]} scale={[w * R * 0.85, R * 0.03, R * 0.004]} />
          <mesh geometry={BOX} material={i % 2 ? M.neonB() : M.neonA()} position={[w * R * 0.5, 0, d * R * 0.5]} scale={[R * 0.008, h * R, R * 0.008]} />
        </group>
      ))}
      <mesh geometry={STICK} material={M.darkMetal()} scale={[R * 0.025, R * 0.5, R * 0.025]} />
      <mesh ref={holo} geometry={TORUS} material={M.holo()} rotation={[Math.PI / 2, 0, 0]} scale={[R * 0.22, R * 0.22, R * 0.8]} />
      <mesh geometry={BALL} material={M.holo()} position={[0, R * 0.66, 0]} scale={R * 0.09} />
      <Halo color="#7fe9ff" size={R * 0.7} at={[0, R * 0.66, 0]} day={0.3} />
      <Halo color="#ff3fb4" size={R * 1.8} sy={0.6} at={[0, R * 0.4, -R * 0.2]} day={0} />
      <mesh geometry={RING} material={M.neonB()} position={[0, 0.004, 0]} scale={[R * 0.3, 1, R * 0.3]} />
    </>
  );
}

function Industry({id, radius: R}: SpecialProps) {
  return (
    <>
      <mesh geometry={BOX} material={M.block()} position={[R * 0.05, 0, R * 0.05]} scale={[R * 0.75, R * 0.32, R * 0.4]} castShadow receiveShadow />
      {/* saw-tooth factory roof */}
      {[-0.22, 0, 0.22].map((x, i) => (
        <mesh key={i} geometry={BOX} material={M.darkMetal()} position={[R * (x + 0.05), R * 0.32, R * 0.05]} rotation={[0, 0, 0.5]} scale={[R * 0.03, R * 0.1, R * 0.4]} />
      ))}
      <mesh geometry={SHAFT} material={M.concrete()} position={[R * 0.5, 0, -R * 0.3]} scale={[R * 0.16, R * 0.3, R * 0.16]} castShadow />
      <mesh geometry={DISC} material={M.darkMetal()} position={[R * 0.5, R * 0.3, -R * 0.3]} scale={[R * 0.16, 1, R * 0.16]} />
      {[[-0.4, -0.35, 1.15], [-0.15, -0.42, 1.45]].map(([x, z, h], i) => (
        <group key={i} position={[x * R, 0, z * R]}>
          <mesh geometry={STICK} material={M.darkMetal()} scale={[R * 0.06, R * h, R * 0.06]} castShadow />
          <mesh geometry={TORUS} material={M.amber()} rotation={[Math.PI / 2, 0, 0]} position={[0, R * h * 0.85, 0]} scale={[R * 0.065, R * 0.065, R * 0.5]} />
          <mesh geometry={DISC} material={M.amber()} position={[0, R * h + 0.001, 0]} scale={[R * 0.05, 1, R * 0.05]} />
          <Halo color="#ff9a3a" size={R * 0.45} at={[0, R * h, 0]} day={0.25} />
          <Motes seed={id + i} kind="smoke" n={10} r={R * 0.05} y0={R * h} y1={R * h + R * 0.05} />
        </group>
      ))}
    </>
  );
}

function Lava({id, radius: R, age}: SpecialProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const a = age(), k = a === Infinity ? 1 : easeOutCubic(a / 1.1);
    m.scale.set(R * 0.85 * k + 0.0001, 1, R * 0.45 * k + 0.0001);
  });
  return (
    <>
      <mesh ref={ref} geometry={DISC} material={M.lava()} position={[0, 0.0025, -R * 0.05]} />
      <mesh geometry={VOLCANO} material={M.rock()} position={[R * 0.05, 0, -R * 0.15]} scale={[R * 0.5, R * 0.7, R * 0.5]} castShadow />
      <mesh geometry={DISC} material={M.lava()} position={[R * 0.05, R * 0.66, -R * 0.15]} scale={[R * 0.12, 1, R * 0.12]} />
      <Halo color="#ff6a1a" size={R * 0.9} at={[R * 0.05, R * 0.72, -R * 0.15]} day={0.4} />
      <Halo color="#ff5010" size={R * 1.9} sy={0.45} at={[0, R * 0.08, R * 0.05]} day={0.25} />
      <Motes seed={id} kind="heat" n={22} r={R * 0.1} y0={R * 0.66} y1={R * 0.75} at={[R * 0.05, 0, -R * 0.15]} />
      <Motes seed={id + 'l'} kind="heat" n={14} r={R * 0.7} y0={0.01} y1={R * 0.1} />
    </>
  );
}

const SPECIAL_PARTS: Record<number, (p: SpecialProps) => React.ReactElement> = {
  [TILE.COMMERCIAL_DISTRICT]: Commerce, [TILE.ECOLOGICAL_ZONE]: EcoZone, [TILE.INDUSTRIAL_CENTER]: Industry, [TILE.LAVA_FLOWS]: Lava,
  [TILE.MINING_AREA]: Mine, [TILE.MINING_RIGHTS]: Mine, [TILE.MINING_STEEL_BONUS]: Mine, [TILE.MINING_TITANIUM_BONUS]: Mine,
  [TILE.MOHOLE_AREA]: Mohole, [TILE.NATURAL_PRESERVE]: Preserve, [TILE.NUCLEAR_ZONE]: Nuclear, [TILE.RESTRICTED_AREA]: Restricted,
};
/** Every special tile type with a model of its own (the capital is a city). */
export const SPECIAL_MODELS: number[] = Object.keys(SPECIAL_PARTS).map(Number);

/** One model per special tile type; an unknown one gets the industrial block so it never stands bare. */
function Special(p: TileModelProps) {
  const age = useBirth(p.fresh, 1.8);
  const Part = SPECIAL_PARTS[p.tileType] ?? Industry;
  const R = p.radius;
  return (
    <group>
      <Stamp age={age}><Back R={R}><Part {...p} age={age} /></Back></Stamp>
      <Owner color={p.color} R={R} age={age} at={0.9} />
      <Shock age={age} at={STAMP_FALL} color={p.color} R={R} />
      <Flash age={age} at={STAMP_FALL - 0.02} length={0.35} size={R * 0.9} y={0.01} />
      <Burst seed={p.id} color="#ffd2a8" n={34} r={R * 1.0} up={R * 0.45} age={age} at={STAMP_FALL} length={0.9} size={0.026} />
    </group>
  );
}

// ---- the model registries ------------------------------------------------------------------------------------
// Models live one per file: the Classic set in ./models, other sets in ./models/<set>/ (contract in
// models/contract.ts). Each set has its own registry by tile type. A tile draws the chosen set's model for its type,
// else Classic's, else the built-in one here (tilesets.ts resolveModel), which also stands in while models load, if a
// file is missing, or if a model fails to render. Classic loads when the board mounts; another set only once it is
// chosen. Every model is warmed up (ModelWarmup) before any tile switches to it.
type ModelModule = {default: (p: ModelProps) => React.ReactElement | null; meta: ModelMeta};
const SET_FILES: Record<string, Record<string, () => Promise<ModelModule>>> = {
  classic: import.meta.glob<ModelModule>('./models/*.tsx'),
  detailed: import.meta.glob<ModelModule>('./models/detailed/*.tsx'),
};
const registries = new Map<string, Map<number, ModelModule>>();
/** Every loaded model, in load order (the warm-up walks this). */
const loaded: ModelModule[] = [];
const setOfModule = new Map<ModelModule, string>();
let registryVersion = 0;
const registryListeners = new Set<() => void>();
const setLoads = new Map<string, Promise<void>>();
const noModels = () => typeof window !== 'undefined' && !!(window as unknown as {__board3dNoModels?: boolean}).__board3dNoModels;

/** The set the board draws (TV options → Tile style); Board3D sets it from the TV's settings. */
let activeSet: string = DEFAULT_SET;
const setListeners = new Set<() => void>();
export function setTileSet(set: string) {
  if (set === activeSet) return;
  activeSet = set;
  for (const l of setListeners) l();
}
export function tileSet(): string { return activeSet; }
function useTileSet(): string {
  return useSyncExternalStore((l) => { setListeners.add(l); return () => { setListeners.delete(l); }; }, () => activeSet);
}

/** Load a set's model files once (Classic always comes with it, as the fallback); a broken file only loses its own
 *  types. */
export function loadModels(set: string = 'classic'): Promise<void> {
  // (test hook: window.__board3dNoModels keeps the built-in models, for comparisons)
  if (noModels()) return Promise.resolve();
  // the chosen set first: Classic's models are then warmed only for the types the chosen set lacks (warmNeeded)
  const one = (name: string) => {
    let p = setLoads.get(name);
    if (!p) {
      const files = SET_FILES[name] ?? {};
      p = Promise.all(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, load]) => load().then((m) => {
        if (typeof m?.default !== 'function' || !Array.isArray(m?.meta?.tileTypes)) { console.warn(`[board3d] ${path}: no model or meta`); return; }
        const s = setOf(path, m.meta.set);
        if (s !== name) console.warn(`[board3d] ${path}: meta.set '${m.meta.set}' outside its folder's set '${name}'; registered as '${name}'`);
        const reg = registries.get(name) ?? registries.set(name, new Map()).get(name)!;
        for (const t of m.meta.tileTypes) reg.set(t, m);
        if (!setOfModule.has(m)) { setOfModule.set(m, name); loaded.push(m); }
        registryVersion++;
        for (const l of registryListeners) l();
      }).catch((e) => console.warn(`[board3d] ${path} failed to load`, e)))).then(() => {
        // test hook: which tile types have a model, per set
        if (typeof window !== 'undefined') (window as unknown as {__board3dModels?: unknown}).__board3dModels =
          Object.fromEntries([...registries].map(([k, reg]) => [k, Object.fromEntries([...reg].map(([t, m]) => [t, m.meta.name]))]));
      });
      setLoads.set(name, p);
    }
    return p;
  };
  return set === 'classic' ? one('classic') : one(set).then(() => one('classic'));
}
/** Bumps whenever a model file has loaded or a batch of models became ready (the depth-of-field pass precompiles
 *  the scene's shader variants then). */
export function modelsVersion(): number { return registryVersion + readyVersion; }
function useRegistry(): number {
  return useSyncExternalStore((l) => { registryListeners.add(l); return () => { registryListeners.delete(l); }; }, () => registryVersion);
}
/** Models the board may draw: those whose shaders are compiled and first-used (ModelWarmup). Until then a tile keeps
 *  what it draws (the previous set's model, or the built-in one), so a switch never links a dozen programs inside
 *  one frame. */
const ready = new Set<ModelModule>();
let readyVersion = 0;
const readyListeners = new Set<() => void>();
function markReady(ms: ModelModule[]) {
  for (const m of ms) ready.add(m);
  readyVersion++;
  for (const l of readyListeners) l();
}
/** Whether the board could draw this model now: one of the chosen set's, or a Classic one for a type the chosen set
 *  has no model for. Only these are warmed (a complete Detailed set leaves Classic's alone until it is chosen). */
function warmNeeded(m: ModelModule): boolean {
  const s = setOfModule.get(m);
  if (s === activeSet) return true;
  if (s !== 'classic') return false;
  const act = registries.get(activeSet);
  return m.meta.tileTypes.some((t) => !act?.has(t));
}
/** Loaded models that are needed and not warm yet, in load order. */
function toWarm(): ModelModule[] { return loaded.filter((m) => !ready.has(m) && warmNeeded(m)); }
function useReady(): number {
  return useSyncExternalStore((l) => { readyListeners.add(l); return () => { readyListeners.delete(l); }; }, () => readyVersion);
}
/** The model a tile of this type draws now (chosen set, then Classic, only models that are warm), or null for the
 *  built-in one. */
function drawnModel(tileType: number, set = activeSet): ModelModule | null {
  return resolveModel(registries, set, tileType, (m) => ready.has(m));
}

// ---- level of detail ---------------------------------------------------------------------------------------------
// Each tile's level ('full' close up, 'lite' at the resting view), set by Board3D's rig every frame (tilesets.ts
// lodStep). Models of the Classic set ignore it, so their tiles never re-render for it.
const details = new Map<string, Detail>();
const detailListeners = new Map<string, Set<() => void>>();
export function tileDetail(id: string): Detail { return details.get(id) ?? 'lite'; }
export function setTileDetail(id: string, d: Detail) {
  if (details.get(id) === d) return;
  details.set(id, d);
  const ls = detailListeners.get(id);
  if (ls) for (const l of ls) l();
}
function useDetail(id: string, matters: boolean): Detail {
  return useSyncExternalStore((l) => {
    const ls = detailListeners.get(id) ?? detailListeners.set(id, new Set()).get(id)!;
    ls.add(l);
    return () => { ls.delete(l); };
  }, () => (matters ? tileDetail(id) : 'full'));
}

const BUILT_IN: Record<TileKind3, (p: TileModelProps) => React.ReactElement | null> = {ocean: Ocean, greenery: Greenery, city: City, special: Special};
const BUILT_IN_SECONDS: Record<TileKind3, number> = {ocean: 2.2, greenery: 2.0, city: 2.4, special: 1.8};
function secondsOf(m: ModelModule | null, tileType: number): number {
  if (m && Number.isFinite(m.meta.buildSeconds)) return Math.max(0.5, Math.min(6, m.meta.buildSeconds));
  return BUILT_IN_SECONDS[tileKind(tileType) ?? 'special'];
}
/** How long a tile's build-in lasts (the model it draws now): the board holds the camera on a placement this long. */
export function buildSeconds(tileType: number): number { return secondsOf(drawnModel(tileType), tileType); }

/** A model that throws while rendering drops to the built-in one for that tile, instead of taking the board down. */
class ModelGuard extends Component<{fallback: ReactNode; name: string; children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(e: unknown) { console.warn(`[board3d] model ${this.props.name} failed; using the built-in`, e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** A model standing on its tile. `birth` belongs to the tile (TileModel), so a switch of set or of detail level
 *  never restarts a build-in: the new model reads the same age. */
function External({m, p, birth, detail}: {m: ModelModule; p: TileModelProps; birth: () => number; detail: Detail}) {
  // the contract's age: seconds since placement, a large number once the tile has stood (never Infinity)
  const age = useMemo(() => () => { const a = birth(); return a === Infinity ? 1e6 : Math.max(0, a); }, [birth]);
  const Model = m.default;
  // hidden while the build-in waits for the camera (a model's age-0 state can be a part hanging in the air)
  const g = useRef<THREE.Group>(null);
  useFrame(() => { if (g.current) g.current.visible = birth() >= 0; });
  return (
    <>
      {/* models stand on y = p.top themselves (the contract), while Board3D lifts every model onto the top */}
      <group ref={g} position={[0, -p.top - 0.0006, 0]} userData={{model: m.meta.name, set: setOfModule.get(m), detail}}><Model {...p} age={age} detail={detail} /></group>
      <Owner color={p.color} R={p.radius} />
      {/* a special lands with a shockwave in its owner's colour, whoever drew it */}
      {tileKind(p.tileType) === 'special' && <Shock age={birth} at={0.35} color={p.color} R={p.radius} />}
    </>
  );
}

// ---- switching a tile's model: prepared hidden, then swapped ------------------------------------------------------
// A tile changes what it draws when its set's models become ready (at load, or after the TV options switch sets) and
// when its level of detail changes. Mounting a model builds its geometry, and its first draw can meet a shader
// variant the warm-up's instance did not cover; done for a whole board in one frame that stalled the TV for 300 ms. So
// a tile mounts the new model hidden next to the old one (a few tiles per frame), compiles it in the background, and
// shows it (hiding the old one) once no compile is in flight; the same mounted element stays, so the swap remounts
// nothing. The build-in clock belongs to the tile, so a swap never restarts it.
type PrepJob = {admit: () => void; cancelled: boolean};
const prepQueue: PrepJob[] = [];
type Prep = {compile: (o: THREE.Object3D) => Promise<unknown>; swaps: number};
let prep: Prep | null = null;
/** Tiles admitted to mount their next model per frame, and swaps per frame. */
export const PREP = {admitPerFrame: 3, swapPerFrame: 3, maxWaitFrames: 30} as const;

/** Runs the prep queue (Board3D mounts it in the scene): admits a few hidden mounts per frame and compiles them for
 *  the screen and for the depth-of-field target, like the warm-up. */
export function ModelPrep() {
  const {gl, camera, scene} = useThree();
  const rt = useMemo(() => new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType}), []);
  useEffect(() => {
    prep = {swaps: 0, compile: (o) => {
      const prev = gl.getRenderTarget();
      const a = tracked(gl.compileAsync(o, camera, scene));
      gl.setRenderTarget(rt);
      const b = tracked(gl.compileAsync(o, camera, scene));
      gl.setRenderTarget(prev);
      return Promise.all([a, b]);
    }};
    return () => { prep = null; rt.dispose(); prepQueue.length = 0; };
  }, [gl, camera, scene, rt]);
  useFrame(() => {
    if (prep) prep.swaps = 0;
    for (let n = 0; n < PREP.admitPerFrame && prepQueue.length;) {
      const j = prepQueue.shift()!;
      if (j.cancelled) continue;
      j.admit(); n++;
    }
    // (test hook: the prep queue's state)
    (window as unknown as {__board3dPrep?: unknown}).__board3dPrep = {queued: prepQueue.length, inFlight: compilesInFlight()};
  }, -1);
  return null;
}

type Shown = {m: ModelModule | null; detail: Detail};
const shownKey = (x: Shown) => (x.m ? `${x.m.meta.name}|${setOfModule.get(x.m)}|${x.detail}` : 'built-in');

/** One way a tile can look (a model at a detail level, or the built-in one), kept mounted by its key. */
function Look({s, p, birth, visible, onRef}: {s: Shown; p: TileModelProps; birth: () => number; visible: boolean; onRef?: (g: THREE.Group | null) => void}) {
  const Builtin = BUILT_IN[tileKind(p.tileType) ?? 'special'];
  return (
    <group visible={visible} ref={onRef}>
      {s.m
        ? <ModelGuard name={s.m.meta.name} fallback={<Builtin {...p} />}><External m={s.m} p={p} birth={birth} detail={s.detail} /></ModelGuard>
        : <Builtin {...p} />}
    </group>
  );
}

/** Every placed tile: the chosen set's model when one is registered and warm, Classic's next, the built-in one
 *  otherwise; at its level of detail (detailed sets only). A change is prepared hidden first (see above). */
function TileModel(p: TileModelProps) {
  useRegistry();
  useReady();
  const set = useTileSet();
  const m = drawnModel(p.tileType, set);
  const detail = useDetail(p.id, !!m && setOfModule.get(m) !== 'classic');
  const want: Shown = {m, detail: m && setOfModule.get(m) !== 'classic' ? detail : 'full'};
  const wantKey = shownKey(want);
  // what the tile shows; a fresh tile shows its model at once (the warm-up has compiled it)
  const [shown, setShown] = useState<Shown>(want);
  const [admitted, setAdmitted] = useState<string | null>(null);
  const [compiled, setCompiled] = useState<string | null>(null);
  const waited = useRef(0);
  const curKey = shownKey(shown);
  // the build-in clock lives here, across model switches (its length: the build-in of what is wanted now)
  const birth = useBirth(p.fresh, secondsOf(m, p.tileType) + 0.5);
  // ask for a turn to mount the wanted look hidden
  useEffect(() => {
    if (wantKey === curKey) return;
    if (!prep) { setShown(want); return; }
    const job: PrepJob = {admit: () => setAdmitted(wantKey), cancelled: false};
    prepQueue.push(job);
    return () => { job.cancelled = true; };
  }, [wantKey, curKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const preparing = admitted === wantKey && wantKey !== curKey;
  const prepGroup = useRef<THREE.Group | null>(null);
  // once mounted hidden: compile it in the background
  useEffect(() => {
    if (!preparing) return;
    let live = true;
    const g = prepGroup.current;
    (g && prep ? prep.compile(g) : Promise.resolve()).then(() => { if (live) { waited.current = 0; setCompiled(wantKey); } });
    return () => { live = false; };
  }, [preparing, wantKey]);
  // compiled: swap when nothing else is compiling (a draw's first use would wait behind it), a few tiles per frame
  useFrame(() => {
    if (compiled !== wantKey || !preparing) return;
    if (compilesInFlight() > 0 && waited.current++ < PREP.maxWaitFrames) return;
    if (prep && prep.swaps >= PREP.swapPerFrame) return;
    if (prep) prep.swaps++;
    setShown(want); setAdmitted(null); setCompiled(null);
  });
  const looks: Array<{s: Shown; key: string; visible: boolean}> = [{s: shown, key: curKey, visible: true}];
  if (preparing) looks.push({s: want, key: wantKey, visible: false});
  return <>{looks.map((l) => <Look key={l.key} s={l.s} p={p} birth={birth} visible={l.visible}
    onRef={l.visible ? undefined : (g) => { prepGroup.current = g; }} />)}</>;
}

const NEVER_BORN = () => Infinity;
/** One model warmed hidden, at one detail level. */
function WarmModel({m, detail, radius}: {m: ModelModule; detail: Detail; radius: number}) {
  const p: TileModelProps = {id: `warm-${m.meta.name}-${detail}`, tileType: m.meta.tileTypes[0], color: 'red', fresh: false, radius, top: 0, night: 0};
  return <ModelGuard name={m.meta.name} fallback={null}><External m={m} p={p} birth={NEVER_BORN} detail={detail} /></ModelGuard>;
}

/** Warms every loaded model, hidden, when its files load (Classic at start, another set once it is chosen): their
 *  shaders compile (for the screen and for the depth-of-field target) in the background, so a type's first placement
 *  does not stall its dive. Models of a detailed set are warmed at both levels ('full' and 'lite'), so a level switch
 *  links nothing. One mesh's material every other frame: the GPU process links programs one after another, so handing
 *  it every model's programs at once (~100) held the TV's main thread for ~0.6 s at the first sync query after load.
 *  Tiles switch to a batch of models once all of them are compiled and their first uses paid (one per frame at rest,
 *  atmosphere.tsx primePrograms), or after ~6 s whatever happens. */
export function ModelWarmup({radius}: {radius: number}) {
  const v = useRegistry();
  useReady();
  useTileSet();
  const {gl, camera, scene} = useThree();
  const group = useRef<THREE.Group>(null);
  // the batch being warmed (a snapshot, so models that load meanwhile wait for the next batch); the hidden models
  // mount one at a time too (building a model's geometry and textures costs a few ms each)
  const [batch, setBatch] = useState<ModelModule[]>([]);
  const [mounted, setMounted] = useState(0);
  const work = useRef<{seen: Set<THREE.Material>; queue: THREE.Object3D[]; rt: THREE.WebGLRenderTarget | null; frame: number}>({seen: new Set(), queue: [], rt: null, frame: 0});
  useEffect(() => () => { work.current.rt?.dispose(); }, []);
  const pending = toWarm();
  useFrame(() => {
    const w = work.current;
    if (!batch.length) {
      if (pending.length) { setBatch(pending); setMounted(0); w.frame = 0; }
      return;
    }
    const g = group.current;
    if (!g) return;
    if (w.frame++ % 2) return;
    // what the newest model added: one mesh per material not seen yet
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      if (mats.every((x) => w.seen.has(x))) return;
      mats.forEach((x) => w.seen.add(x));
      w.queue.push(o);
    });
    const o = w.queue.shift();
    if (!o) {
      if (mounted < batch.length) { setMounted(mounted + 1); return; }
      // every program compiled: the board's tiles switch to these models once their first uses are paid
      if ((unprimed(gl) > 0 || compilesInFlight() > 0) && w.frame < 720) return;
      w.rt?.dispose(); w.rt = null;
      markReady(batch); setBatch([]); setMounted(0);
      return;
    }
    w.rt ??= new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType});
    const prev = gl.getRenderTarget();
    // compile only this object, with the board's lights (compile ignores the hidden flag)
    void tracked(gl.compileAsync(o, camera, scene));
    gl.setRenderTarget(w.rt);
    void tracked(gl.compileAsync(o, camera, scene));
    gl.setRenderTarget(prev);
  });
  // (test hook: the warm-up's progress: models loaded, warm, still to warm, and the current batch)
  if (typeof window !== 'undefined') (window as unknown as {__board3dWarm?: unknown}).__board3dWarm =
    {loaded: loaded.length, ready: ready.size, pending: pending.length, batch: batch.length, mounted, set: activeSet, version: v};
  if (!batch.length) return null;
  return (
    <group ref={group} visible={false} position={[0, -40, 0]}>
      {batch.slice(0, mounted).map((m) => (setOfModule.get(m) === 'classic'
        ? <WarmModel key={m.meta.name + '|classic'} m={m} detail="full" radius={radius} />
        : <group key={m.meta.name + '|' + setOfModule.get(m)}>
          <WarmModel m={m} detail="full" radius={radius} />
          <WarmModel m={m} detail="lite" radius={radius} />
        </group>))}
    </group>
  );
}

export const TILE_RENDERERS: Record<TileKind3, TileRenderer> = {
  ocean: {height: TILE_HEIGHT.ocean, Model: TileModel},
  greenery: {height: TILE_HEIGHT.greenery, Model: TileModel},
  city: {height: TILE_HEIGHT.city, Model: TileModel},
  special: {height: TILE_HEIGHT.special, Model: TileModel},
};

/** The camera holds on a fresh placement while its model builds (Board3D's rig reads this). */
export const cameraHold = {ids: [] as string[], until: 0};
export function holdCamera(id: string, tileType: number) {
  // plus a short linger on the finished tile
  const until = performance.now() + (buildSeconds(tileType) + world.lead + 0.6) * 1000 / timeScale();
  if (cameraHold.until > performance.now()) { if (!cameraHold.ids.includes(id)) cameraHold.ids.push(id); }
  else cameraHold.ids = [id];
  cameraHold.until = Math.max(cameraHold.until, until);
}
/** How hard each kind of placement nudges the camera (world units). */
export const KICK: Record<TileKind3, number> = {ocean: 0.12, greenery: 0.1, city: 0.16, special: 0.2};

// ---- the ticker ----------------------------------------------------------------------------------------------
const DAY_WATER = new THREE.Color('#2f78a8'), NIGHT_WATER = new THREE.Color('#14304e');
/** Advances the clock and drives every shared animated material once per frame. */
export function WorldTicker({night, reduced, lead}: {night: number; reduced: boolean; lead: number}) {
  const {size, viewport, camera} = useThree();
  world.lead = lead;
  useFrame((_, dt) => {
    world.reduced = reduced;
    world.lead = lead;
    if (!reduced) world.t += Math.min(dt, 0.1);
    world.night += (night - world.night) * (1 - Math.exp(-dt * 0.8));
    const n = world.night, t = world.t;
    sway.uTime.value = t; sway.uAmp.value = reduced ? 0 : 0.07;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 40;
    const scale = size.height * viewport.dpr / (2 * Math.tan((fov * Math.PI) / 360));
    for (const u of moteUniforms) { u.uTime.value = t; u.uScale.value = scale; }
    // windows: a faint glow by day, warm and lively at night, with a gentle flicker
    const flicker = 1 + 0.07 * Math.sin(t * 11.3) * Math.sin(t * 3.7);
    M.facade().emissiveIntensity = (0.18 + n * 1.7) * flicker;
    M.block().emissiveIntensity = (0.12 + n * 1.4) * flicker;
    M.glass().emissiveIntensity = 0.03 + n * 0.5;
    M.park().emissiveIntensity = n * 0.22;
    M.gold().emissiveIntensity = 0.12 + n * 0.45;
    M.beaconA().opacity = Math.sin(t * 3.2 + 3.2) > 0.2 ? 1 : 0.15;
    M.beaconB().opacity = Math.sin(t * 2.1 + 2.1) > 0.2 ? 1 : 0.2;
    for (const g of glowMats.values()) {
      g.m.opacity = (g.day + (1 - g.day) * n) * (g.blink && Math.sin(t * g.blink + g.blink) <= 0.2 ? 0.2 : 1);
    }
    MOTES.firefly().uniforms.uOpacity.value = n * 1.1;
    M.amber().opacity = 0.8 + 0.2 * Math.sin(t * 5);
    M.neonA().color.setRGB(1, 0.25 + 0.05 * Math.sin(t * 9), 0.7).multiplyScalar(0.75 + n * 0.5);
    M.neonB().color.setRGB(0.25, 0.88, 1).multiplyScalar(0.75 + n * 0.5 + 0.06 * Math.sin(t * 13));
    M.holo().opacity = 0.35 + 0.2 * Math.sin(t * 2.4) + n * 0.15;
    M.lava().emissiveIntensity = 1.1 + 0.35 * Math.sin(t * 1.3) + n * 0.6;
    M.lava().emissiveMap?.offset.set(t * 0.008, t * 0.005);
    M.shaft().opacity = 0.5 + 0.2 * Math.sin(t * 2.2) + n * 0.2;
    for (const m of ownerMats.values()) { m.cube.emissiveIntensity = 0.2 + n * 0.5; m.flag.emissiveIntensity = 0.3 + n * 0.6; m.ring.opacity = 0.85 + n * 0.15; }
    // water: two ripple layers sliding against each other, deeper and glossier at night
    M.water().normalMap?.offset.set(t * 0.016, t * 0.01);
    M.water2().normalMap?.offset.set(-t * 0.022, t * 0.015);
    M.water().color.copy(DAY_WATER).lerp(NIGHT_WATER, n * 0.8);
    M.water().emissiveIntensity = 0.2 + n * 0.3;
  });
  return null;
}
