// A miniature terraformer, procedural: a chibi body (big round head, helmet with the visor pushed up, backpack,
// tools) merged into one skinned mesh (about 2.5k triangles, one draw call) on a small bone rig. The rig is 1 unit
// tall at rest; the director scales it to the board. Skins only change colours, hair, helmet, proportions and the
// face drawn into the head's atlas patch, so every character shares one geometry recipe and one shader program.
import * as THREE from 'three';
import {ball, box, capsule, cone, cyl, lifeMaterial, Parts, patch, place, skinnedMesh, torus} from './kit';
import type {CharacterSkin, FaceKey} from './skins';

export const BONES = ['root', 'hips', 'torso', 'head', 'visor', 'armL', 'armR', 'handL', 'handR', 'legL', 'legR',
  'tShovel', 'tMop', 'tFlag', 'tPhone', 'tRod', 'tBrick', 'tShades', 'tLamp'] as const;
export type BoneName = typeof BONES[number];
export const NB = BONES.length;
export const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;
/** Tools start hidden (scale 0): a pose shows the one it uses. */
export const TOOLS: BoneName[] = ['tShovel', 'tMop', 'tFlag', 'tPhone', 'tRod', 'tBrick', 'tShades'];

// Rest positions (absolute, rest pose) and parents.
const ABS: Record<BoneName, [number, number, number]> = {
  root: [0, 0, 0], hips: [0, 0.27, 0], torso: [0, 0.27, 0], head: [0, 0.545, 0], visor: [0, 0.715, 0],
  armL: [0.155, 0.47, 0], armR: [-0.155, 0.47, 0], handL: [0.155, 0.275, 0], handR: [-0.155, 0.275, 0],
  legL: [0.065, 0.27, 0], legR: [-0.065, 0.27, 0],
  tShovel: [-0.155, 0.275, 0], tMop: [-0.155, 0.275, 0], tFlag: [-0.155, 0.275, 0], tPhone: [-0.155, 0.275, 0], tRod: [-0.155, 0.275, 0],
  tBrick: [0, 0.4, 0.17], tShades: [0, 0.715, 0], tLamp: [0, 0.715, 0],
};
const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', torso: 'hips', head: 'torso', visor: 'head', armL: 'torso', armR: 'torso', handL: 'armL', handR: 'armR',
  legL: 'hips', legR: 'hips', tShovel: 'handR', tMop: 'handR', tFlag: 'handR', tPhone: 'handR', tRod: 'handR', tBrick: 'torso', tShades: 'head', tLamp: 'head',
};
export const REST_LOCAL: Float32Array = (() => {
  const a = new Float32Array(NB * 3);
  BONES.forEach((n, i) => { const p = PARENT[n]; const o = p ? ABS[p] : [0, 0, 0]; a[i * 3] = ABS[n][0] - o[0]; a[i * 3 + 1] = ABS[n][1] - o[1]; a[i * 3 + 2] = ABS[n][2] - o[2]; });
  return a;
})();

/** The head's face patch: azimuth ± FACE.phi from the front, polar angle th0 to th1. */
export const FACE = {phi: 0.55, th0: 1.08, th1: 2.03};
const HEAD = {cy: 0.715, r: 0.19};
const helmetRim = (front: number, back: number) => (phi: number) => front + ((1 - Math.cos(phi)) / 2) * (back - front);

// ---- the face atlas --------------------------------------------------------------------------------------------
export const ATLAS = 256, CELL = 112;
export const EXPRESSIONS: FaceKey[] = ['neutral', 'happy', 'surprised', 'sleepy'];
const CELL_AT: Record<FaceKey, [number, number]> = {neutral: [0, 0], happy: [CELL, 0], surprised: [0, CELL], sleepy: [CELL, CELL]};

function drawFace(ctx: CanvasRenderingContext2D, x0: number, y0: number, key: FaceKey, skin: CharacterSkin) {
  const S = CELL;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, S, S); ctx.clip();
  ctx.fillStyle = skin.colors.skin; ctx.fillRect(x0, y0, S, S);
  const eye = skin.face.eyes;
  const X = (u: number) => x0 + u * S, Y = (v: number) => y0 + v * S;
  // cheeks
  ctx.fillStyle = skin.face.cheek; ctx.globalAlpha = key === 'happy' ? 0.55 : 0.38;
  for (const u of [0.2, 0.8]) { ctx.beginPath(); ctx.ellipse(X(u), Y(0.66), S * 0.09, S * 0.055, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = eye; ctx.strokeStyle = eye; ctx.lineCap = 'round';
  const eyes = (rx: number, ry: number) => {
    for (const u of [0.3, 0.7]) {
      ctx.fillStyle = eye; ctx.beginPath(); ctx.ellipse(X(u), Y(0.46), S * rx, S * ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(X(u) + S * rx * 0.3, Y(0.46) - S * ry * 0.35, S * rx * 0.34, S * ry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
  };
  if (key === 'sleepy') {
    ctx.lineWidth = S * 0.045;
    for (const u of [0.3, 0.7]) { ctx.beginPath(); ctx.arc(X(u), Y(0.45), S * 0.09, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(X(0.5), Y(0.76), S * 0.04, S * 0.03, 0, 0, Math.PI * 2); ctx.fillStyle = eye; ctx.fill();
  } else if (key === 'surprised') {
    eyes(0.095, 0.125);
    ctx.fillStyle = eye; ctx.beginPath(); ctx.ellipse(X(0.5), Y(0.77), S * 0.07, S * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c4574a'; ctx.beginPath(); ctx.ellipse(X(0.5), Y(0.79), S * 0.045, S * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  } else if (key === 'happy') {
    eyes(0.078, 0.1);
    ctx.fillStyle = '#5a1f1a'; ctx.beginPath(); ctx.moveTo(X(0.3), Y(0.68)); ctx.quadraticCurveTo(X(0.5), Y(0.98), X(0.7), Y(0.68)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e98b86'; ctx.beginPath(); ctx.ellipse(X(0.5), Y(0.8), S * 0.1, S * 0.045, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    eyes(0.072, 0.095);
    ctx.lineWidth = S * 0.04;
    ctx.beginPath(); ctx.arc(X(0.5), Y(0.66), S * 0.1, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke();
  }
  ctx.restore();
}

/** The atlas: every expression in its cell, and a white texel in the bottom-right corner that every other part samples. */
export function makeAtlas(skin: CharacterSkin): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ATLAS, ATLAS);
  for (const k of EXPRESSIONS) drawFace(ctx, CELL_AT[k][0], CELL_AT[k][1], k, skin);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  return t;
}

// ---- geometry ----------------------------------------------------------------------------------------------------
type Built = {geo: THREE.BufferGeometry; faceStart: number; faceCount: number; faceLocal: Float32Array};

export function buildGeometry(skin: CharacterSkin): Built {
  const c = skin.colors, P = new Parts();
  const w = skin.build.width, hk = skin.build.head;
  const X = <T extends THREE.BufferGeometry>(g: T): T => { g.scale(w, 1, 1); return g; };
  // the head grows about the neck, so a larger head sits higher
  const hs = <T extends THREE.BufferGeometry>(g: T): T => { g.translate(0, -ABS.head[1], 0); g.scale(hk, hk, hk); g.translate(0, ABS.head[1], 0); return g; };
  const hc = HEAD.cy;

  // legs and boots
  for (const [sx, bone] of [[1, B.legL], [-1, B.legR]] as const) {
    P.add(X(capsule(0.05, 0.1, sx * 0.065, 0.17, 0)), bone, c.suit);
    P.add(X(ball(0.058, sx * 0.065, 0.045, 0.03, 1, 0.78, 1.55, 9)), bone, c.boots);
  }
  // torso, belt, collar, panel, backpack
  P.add(X(capsule(0.1, 0.09, 0, 0.395, 0, 9).scale(1.08, 1, 0.92)), B.torso, c.suit);
  P.add(X(cyl(0.108, 0.108, 0.035, 0, 0.29, 0, 10)), B.torso, c.trim);
  P.add(X(cyl(0.075, 0.085, 0.03, 0, 0.545, 0, 10)), B.torso, c.trim);
  P.add(X(box(0.1, 0.07, 0.03, 0, 0.43, 0.092)), B.torso, c.pack);
  P.add(ball(0.013, 0.03, 0.44, 0.11, 1, 1, 1, 6), B.torso, '#6ff3ff', 1.2);
  P.add(ball(0.013, -0.03, 0.44, 0.11, 1, 1, 1, 6), B.torso, c.trim, 0.8);
  P.add(X(box(0.2, 0.22, 0.09, 0, 0.4, -0.125)), B.torso, c.pack);
  for (const sx of [1, -1]) P.add(X(cyl(0.032, 0.032, 0.2, sx * 0.058, 0.41, -0.195, 8)), B.torso, c.suit);
  // arms, shoulders, gloves
  for (const [sx, arm, hand] of [[1, B.armL, B.handL], [-1, B.armR, B.handR]] as const) {
    P.add(X(capsule(0.04, 0.1, sx * 0.155, 0.385, 0)), arm, c.suit);
    P.add(X(ball(0.055, sx * 0.155, 0.47, 0, 1, 0.9, 1, 8)), arm, c.trim);
    P.add(X(ball(0.05, sx * 0.155, 0.275, 0, 1, 1, 1, 8)), hand, c.boots);
  }
  // head
  P.add(hs(ball(HEAD.r, 0, hc, 0, 1, 1, 1, 12)), B.head, c.skin);
  const faceStart = P.count;
  P.add(hs(patch(HEAD.r + 0.0015, 0, hc, 0, -FACE.phi, FACE.phi, FACE.th0, FACE.th1, 8, 8)), B.head, '#ffffff', 0, null);
  const faceCount = P.count - faceStart;
  // helmet
  const hel = skin.helmet;
  const hr = hel === 'round' ? 0.222 : 0.212;
  const rim = hel === 'round' ? helmetRim(0.95, 1.9) : helmetRim(0.82, 1.67);
  if (hel !== 'none') {
    P.add(hs(patch(hr, 0, hc, 0, 0, Math.PI * 2, 0, rim, 20, 6)), B.head, c.helmet);
    for (const sx of [1, -1]) P.add(hs(place(cyl(0.04, 0.04, 0.035, 0, 0, 0, 10), sx * (hr - 0.004), hc - 0.01, 0, 0, 0, Math.PI / 2)), B.head, c.trim);
    P.add(hs(cyl(0.007, 0.007, 0.07, 0.09, hc + hr + 0.01, -0.05, 5)), B.head, c.pack);
    P.add(hs(ball(0.017, 0.09, hc + hr + 0.05, -0.05, 1, 1, 1, 6)), B.head, c.trim, 1.4);
    if (hel === 'crest') P.add(hs(box(0.022, 0.07, 0.2, 0, hc + hr - 0.008, -0.02)), B.head, c.trim);
    if (hel === 'round') P.add(hs(place(torus(hr * 0.78, 0.012, 0, 0, 0, 14), 0, hc + hr * 0.62, 0, Math.PI / 2)), B.head, c.trim);
  }
  // visor, pushed up (the pose rotates it down over the face)
  P.add(hs(patch(hr + 0.02, 0, hc, 0, -0.85, 0.85, 0.82, 1.62, 12, 5)), B.visor, c.visor);
  P.add(hs(patch(hr + 0.02, 0, hc, 0, -0.85, 0.85, 0.76, 0.82, 12, 1)), B.visor, c.trim);
  // headlamp
  P.add(hs(box(0.05, 0.03, 0.035, 0, hc + hr * 0.62 * 1.0, hr * 0.74)), B.tLamp, c.pack);
  P.add(hs(ball(0.014, 0, hc + hr * 0.62, hr * 0.74 + 0.024, 1, 1, 1, 6)), B.tLamp, '#d8caa0', 0.3);
  // glasses: frames in front of the eyes (geometry, so they read from the TV camera)
  if (skin.glasses !== 'none') {
    const gc = '#1b1618';
    for (const sx of [1, -1]) {
      const ring = skin.glasses === 'round' ? torus(0.05, 0.009, 0, 0, 0, 12) : torus(0.05, 0.009, 0, 0, 0, 4).rotateZ(Math.PI / 4).scale(1.15, 0.8, 1);
      P.add(hs(place(ring, sx * 0.07, hc + 0.012, 0.185, 0.12)), B.head, gc);
    }
    P.add(hs(box(0.04, 0.01, 0.01, 0, hc + 0.02, 0.19)), B.head, gc);
  }
  // hair
  addHair(P, skin, hs, hr, rim, hel);
  // tools (each extends from the right hand along its down axis)
  const hx = -0.155, hy = 0.275;
  P.add(cyl(0.011, 0.011, 0.36, hx, hy - 0.12, 0, 6), B.tShovel, '#9a6a3c');
  P.add(box(0.07, 0.085, 0.012, hx, hy - 0.33, 0.0), B.tShovel, '#a9b4bd');
  P.add(box(0.05, 0.014, 0.014, hx, hy + 0.055, 0), B.tShovel, '#9a6a3c');
  P.add(cyl(0.01, 0.01, 0.38, hx, hy - 0.13, 0, 6), B.tMop, '#b8a07a');
  P.add(ball(0.048, hx, hy - 0.33, 0, 1.5, 0.55, 1, 8), B.tMop, '#efe7b8');
  P.add(cyl(0.01, 0.01, 0.78, hx, hy - 0.26, 0, 6), B.tFlag, '#d8dde0');
  P.add(box(0.23, 0.15, 0.008, hx + 0.12, hy - 0.58, 0), B.tFlag, c.trim);
  P.add(box(0.23, 0.045, 0.01, hx + 0.12, hy - 0.58, 0), B.tFlag, c.suit);
  P.add(ball(0.02, hx, hy - 0.66, 0, 1, 1, 1, 5), B.tFlag, '#f2c94c');
  P.add(cyl(0.007, 0.007, 0.24, hx, hy - 0.07, 0, 5), B.tPhone, '#3a3f46');
  P.add(box(0.065, 0.11, 0.012, hx, hy - 0.22, 0.006), B.tPhone, '#22262b');
  P.add(box(0.05, 0.085, 0.004, hx, hy - 0.22, 0.014), B.tPhone, '#9fd8ff', 0.7);
  P.add(cyl(0.005, 0.01, 0.52, hx, hy - 0.19, 0, 5), B.tRod, '#7b5a3a');
  P.add(ball(0.02, hx, hy - 0.04, 0.02, 1, 1, 1, 6), B.tRod, '#6c7279');
  for (let i = 0; i < 3; i++) P.add(box(0.085, 0.042, 0.05, 0, 0.39 + i * 0.044, 0.19).rotateY(i === 1 ? 0.2 : -0.05), B.tBrick, i === 1 ? '#d8663a' : '#c0502b');
  P.add(hs(ball(0.037, 0.068, hc + 0.015, 0.18, 1.2, 0.8, 0.5, 8)), B.tShades, '#14111a');
  P.add(hs(ball(0.037, -0.068, hc + 0.015, 0.18, 1.2, 0.8, 0.5, 8)), B.tShades, '#14111a');
  P.add(hs(box(0.05, 0.01, 0.01, 0, hc + 0.025, 0.188)), B.tShades, '#14111a');
  P.add(hs(ball(0.011, 0.085, hc + 0.025, 0.2, 1, 1, 1, 5)), B.tShades, '#ffffff', 0.6);
  const geo = P.build();
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const faceLocal = new Float32Array(faceCount * 2);
  for (let i = 0; i < faceCount; i++) { faceLocal[i * 2] = uv.getX(faceStart + i); faceLocal[i * 2 + 1] = uv.getY(faceStart + i); }
  return {geo, faceStart, faceCount, faceLocal};
}

function addHair(P: Parts, skin: CharacterSkin, hs: <T extends THREE.BufferGeometry>(g: T) => T, hr: number, rim: (p: number) => number, hel: string) {
  const col = skin.colors.hair, hc = HEAD.cy, R = HEAD.r + 0.012;
  const style = skin.hair;
  if (style === 'none') return;
  const hair = (g: THREE.BufferGeometry) => P.add(hs(g), B.head, col);
  const front = (hel === 'none' ? 0.9 : rim(0));
  if (hel === 'none') hair(patch(R + 0.004, 0, hc, 0, 0, Math.PI * 2, 0, (p: number) => helmetRim(0.95, 1.7)(p), 20, 6));
  hair(patch(R, 0, hc, 0, -1.25, 1.25, front - 0.04, 1.12, 10, 2));
  const side = (to: number) => hair(patch(R, 0, hc, 0, 0.95, Math.PI * 2 - 0.95, (p: number) => Math.max(rim(p) - 0.05, 0.4), to, 18, 5));
  switch (style) {
  case 'short': side(1.5); break;
  case 'bob': side(2.05); break;
  case 'long': side(2.2); P.add(hs(capsule(0.075, 0.11, 0, hc - 0.15, -0.13, 8)), B.head, col); break;
  case 'bun': side(1.55); hair(ball(0.07, 0, hc + hr * 0.95, -0.09, 1, 1, 1, 8)); hair(ball(0.026, 0, hc + hr * 0.95 + 0.065, -0.09, 1, 1, 1, 5)); break;
  case 'ponytail': side(1.6); P.add(hs(place(capsule(0.04, 0.12, 0, 0, 0), 0, hc - 0.02, -0.2, -0.6)), B.head, col); break;
  case 'curly': {
    // a full, soft cap of curls: a rounded shell round the back and sides whose surface swells in lumps, no loose balls
    const g = patch(hr + 0.016, 0, hc, 0, 0.55, Math.PI * 2 - 0.55, (p: number) => Math.max(rim(p) - 0.12, 0.3), 2.0, 30, 12);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let n = 0; n < pos.count; n++) {
      const dx = pos.getX(n), dy = pos.getY(n) - hc, dz = pos.getZ(n), len = Math.hypot(dx, dy, dz);
      const phi = Math.atan2(dx, dz), th = Math.acos(dy / len);
      const bump = 1 + 0.07 * Math.sin(phi * 7 + th * 2) * Math.sin(th * 5 + 0.6) + 0.03 * Math.sin(phi * 13);
      pos.setXYZ(n, dx * bump, hc + dy * bump, dz * bump);
    }
    g.computeVertexNormals();
    hair(g);
    break;
  }
  case 'spiky':
    side(1.45);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, th = 0.45;
      hair(place(cone(0.04, 0.1, 0, 0, 0, 5), Math.sin(a) * Math.sin(th) * hr, hc + Math.cos(th) * hr + 0.03, Math.cos(a) * Math.sin(th) * hr, Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45));
    }
    break;
  default: break;
  }
}

// ---- a character instance ----------------------------------------------------------------------------------------
export type Character = {
  skin: CharacterSkin;
  group: THREE.Group;
  bones: THREE.Bone[];
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshStandardMaterial;
  atlas: THREE.CanvasTexture;
  /** the expression showing (index into EXPRESSIONS) */
  face: number;
  faceStart: number; faceCount: number; faceLocal: Float32Array;
};

/** Which face cell a vertex samples, by expression, with a half-texel inset. */
export function setFace(ch: Character, key: FaceKey) {
  const i = EXPRESSIONS.indexOf(key);
  if (i < 0 || i === ch.face) return;
  ch.face = i;
  const [x0, y0] = CELL_AT[key];
  const uv = ch.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
  const inset = 1.5;
  for (let k = 0; k < ch.faceCount; k++) {
    const u = ch.faceLocal[k * 2], v = ch.faceLocal[k * 2 + 1];
    uv.setXY(ch.faceStart + k, (x0 + inset + u * (CELL - 2 * inset)) / ATLAS, 1 - (y0 + inset + (1 - v) * (CELL - 2 * inset)) / ATLAS);
  }
  uv.needsUpdate = true;
}

export function createCharacter(skin: CharacterSkin): Character {
  const built = buildGeometry(skin);
  const atlas = makeAtlas(skin);
  const material = lifeMaterial(atlas);
  const group = new THREE.Group();
  const bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
  BONES.forEach((n, i) => {
    bones[i].position.set(REST_LOCAL[i * 3] * (n.startsWith('arm') || n.startsWith('leg') || n.startsWith('hand') ? skin.build.width : 1), REST_LOCAL[i * 3 + 1], REST_LOCAL[i * 3 + 2]);
    const p = PARENT[n];
    (p ? bones[B[p]] : group).add(bones[i]);
  });
  const mesh = skinnedMesh(built.geo, material, bones, group);
  const ch: Character = {skin, group, bones, mesh, material, atlas, face: -1, faceStart: built.faceStart, faceCount: built.faceCount, faceLocal: built.faceLocal};
  setFace(ch, 'neutral');
  return ch;
}

export function disposeCharacter(ch: Character) {
  ch.mesh.geometry.dispose(); ch.material.dispose(); ch.atlas.dispose(); ch.mesh.skeleton.dispose();
}
