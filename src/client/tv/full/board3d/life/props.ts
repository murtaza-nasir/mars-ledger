// Everything board life draws besides the characters: props for the vignettes, things that fall from the sky, the
// ambient rover and drone. All of it is ONE skinned mesh (one draw call): each prop is a bone or a small bone tree
// whose geometry is baked in; hiding a prop scales its root bone to zero, moving it moves the bone. Sizes are in units of a
// character's height (H); the rig is built at world scale.
import * as THREE from 'three';
import {PRISM_R} from '../geometry3d';
import {ball, box, cone, cyl, flip, ico, lifeMaterial, Parts, patch, place, skinnedMesh, torus} from './kit';

/** A character's height on the board: about 0.45 of a hex radius, so it reads from the default camera. */
export const CHAR_H = 0.45 * PRISM_R;
/** Life runs in a space this many times smaller than the board and is drawn this many times larger: a figure stands about 0.8 of a hex radius tall. */
export const LIFE_SCALE = 1.85;

type Def = {name: string; parent?: string; /** pivot, relative to the parent's pivot, in H */ at?: [number, number, number]; build: (add: Add) => void};
type Add = (geo: THREE.BufferGeometry, color: string, glow?: number) => void;

const WOOD = '#9b7448', WOOD2 = '#7d5a34', METAL = '#aeb7bf', DARK = '#33363c', WHITE = '#f3efe6', ORANGE = '#f08a3c', TEAL = '#2bb39a', RED = '#d2493a', YELLOW = '#f2c94c',
  WATER = '#74c0f5', GREEN = '#58a34a', GOLD = '#f2c230', GOLD2 = '#c99a14', ROCK = '#7b6a5e', ICE = '#c7efff';

/** The wheel pair of a rover: an axle along z with a wheel at each end. */
const wheels = (add: Add) => {
  add(place(cyl(0.025, 0.025, 0.32, 0, 0, 0, 5), 0, 0, 0, Math.PI / 2), METAL);
  for (const z of [-0.14, 0.14]) {
    add(place(cyl(0.085, 0.085, 0.06, 0, 0, 0, 10), 0, 0, z, Math.PI / 2), DARK);
    add(place(cyl(0.045, 0.045, 0.066, 0, 0, 0, 6), 0, 0, z, Math.PI / 2), '#c9ced3');
  }
};

function rover(p: string): Def[] {
  return [
    {name: `${p}Rover`, build: (a) => {
      a(box(0.36, 0.09, 0.24, 0, 0.15, 0), WHITE);
      a(box(0.36, 0.025, 0.245, 0, 0.12, 0), ORANGE);
      a(box(0.16, 0.08, 0.17, -0.06, 0.235, 0), '#dfe5e9');
      a(box(0.02, 0.045, 0.12, 0.025, 0.24, 0), '#3b6fa8');
      a(box(0.14, 0.012, 0.2, 0.0, 0.2, 0), '#26466b');
      a(ball(0.016, 0.17, 0.17, 0.08, 1, 1, 1, 5), '#fff3b0', 1.5);
      a(ball(0.016, 0.17, 0.17, -0.08, 1, 1, 1, 5), '#fff3b0', 1.5);
    }},
    {name: `${p}AxF`, parent: `${p}Rover`, at: [0.12, 0.085, 0], build: (a) => wheels(a)},
    {name: `${p}AxR`, parent: `${p}Rover`, at: [-0.12, 0.085, 0], build: (a) => wheels(a)},
    {name: `${p}Dish`, parent: `${p}Rover`, at: [-0.1, 0.275, 0], build: (a) => {
      a(cyl(0.012, 0.012, 0.08, 0, 0.04, 0, 5), METAL);
      a(place(patch(0.1, 0, 0, 0, 0, Math.PI * 2, 0, 1.0, 14, 3), 0, 0.04, 0.0, -0.9), '#e6ebef');
      a(place(flip(patch(0.096, 0, 0, 0, 0, Math.PI * 2, 0, 1.0, 14, 3)), 0, 0.04, 0.0, -0.9), '#9fb0c0');
      a(cyl(0.006, 0.006, 0.09, 0.0, 0.14, 0.05, 4), METAL);
      a(ball(0.014, 0, 0.19, 0.07, 1, 1, 1, 5), RED, 1.2);
    }},
  ];
}

function duck(p: string): Def {
  return {name: p, build: (a) => {
    a(ball(0.1, 0, 0.1, 0, 1, 0.9, 1.25, 9), YELLOW);
    a(ball(0.065, 0, 0.21, 0.09, 1, 1, 1, 8), YELLOW);
    a(box(0.06, 0.02, 0.05, 0, 0.2, 0.17), '#f28a2e');
    a(ball(0.012, 0.035, 0.225, 0.14, 1, 1, 1, 4), '#1a1a1a'); a(ball(0.012, -0.035, 0.225, 0.14, 1, 1, 1, 4), '#1a1a1a');
    a(ball(0.045, 0.085, 0.12, -0.02, 0.4, 1, 1, 6), '#f0b92e'); a(ball(0.045, -0.085, 0.12, -0.02, 0.4, 1, 1, 6), '#f0b92e');
    a(place(cone(0.04, 0.07, 0, 0, 0, 5), 0, 0.14, -0.14, -1.9), YELLOW);
  }};
}

const DEFS: Def[] = [
  // ---- vignette props ----
  {name: 'mound', build: (a) => { a(ball(0.09, 0, 0.005, 0, 1.3, 0.4, 1.3, 8), '#6a3e2a'); }},
  {name: 'sprout', build: (a) => {
    a(cyl(0.012, 0.016, 0.2, 0, 0.12, 0, 5), '#4d9a3c');
    a(ball(0.07, 0.055, 0.22, 0, 1, 0.32, 0.6, 6), '#7ed05f'); a(ball(0.07, -0.055, 0.22, 0, 1, 0.32, 0.6, 6), '#69c352');
  }},
  {name: 'gust', build: (a) => {
    for (let i = 0; i < 3; i++) a(place(torus(0.14 + i * 0.05, 0.012, 0, 0, 0, 12), 0, 0.1 + i * 0.12, 0, Math.PI / 2), '#f4ece4');
  }},
  {name: 'rigBase', build: (a) => {
    for (let i = 0; i < 3; i++) { const an = (i / 3) * Math.PI * 2 + 0.4; a(place(cyl(0.012, 0.014, 0.4, 0, 0.19, 0, 5), Math.sin(an) * 0.1, 0, Math.cos(an) * 0.1, Math.cos(an) * 0.28, 0, -Math.sin(an) * 0.28), METAL); }
    a(cyl(0.07, 0.07, 0.04, 0, 0.4, 0, 8), ORANGE);
    a(box(0.13, 0.1, 0.13, 0, 0.47, 0), ORANGE);
    a(box(0.14, 0.02, 0.14, 0, 0.53, 0), DARK);
    a(ball(0.014, 0.07, 0.5, 0.07, 1, 1, 1, 4), '#8cf7a0', 1.5);
  }},
  {name: 'rigBit', parent: 'rigBase', at: [0, 0.4, 0], build: (a) => {
    a(cyl(0.02, 0.02, 0.5, 0, -0.05, 0, 5), '#c4ccd2');
    a(place(cone(0.04, 0.12, 0, 0, 0, 6), 0, -0.34, 0, Math.PI), '#e0e5e8');
    for (let i = 0; i < 3; i++) a(place(torus(0.032, 0.008, 0, 0, 0, 6), 0, -0.1 - i * 0.07, 0, Math.PI / 2), '#8f99a1');
  }},
  {name: 'rigCrank', parent: 'rigBase', at: [0.07, 0.47, 0], build: (a) => {
    a(place(cyl(0.01, 0.01, 0.16, 0, 0, 0, 5), 0.08, 0, 0, 0, 0, Math.PI / 2), DARK);
    a(ball(0.028, 0.16, 0, 0, 1, 1, 1, 6), RED);
  }},
  {name: 'geyser', build: (a) => {
    a(cyl(0.035, 0.07, 1, 0, 0.5, 0, 8), WATER, 0.25);
    a(ball(0.11, 0, 1.0, 0, 1, 0.7, 1, 8), '#cdeeff', 0.5);
    for (let i = 0; i < 5; i++) { const an = i * 1.26; a(ball(0.045, Math.sin(an) * 0.1, 0.92 + (i % 2) * 0.06, Math.cos(an) * 0.1, 1, 0.8, 1, 5), '#e6f6ff', 0.5); }
  }},
  {name: 'hole', build: (a) => {
    a(cyl(0.12, 0.12, 0.006, 0, 0.004, 0, 12), '#241008');
    a(place(torus(0.125, 0.018, 0, 0, 0, 12), 0, 0.012, 0, Math.PI / 2), '#6a3a28');
  }},
  ...rover('rv'),
  {name: 'rock', build: (a) => {
    a(ico(0.15, 0, 0.09, 0, 1).scale(1.2, 0.8, 1), ROCK);
    a(ico(0.05, 0.19, 0.03, 0.05, 0), '#8a7869'); a(ico(0.04, -0.17, 0.025, 0.1, 0), '#6c5c50');
  }},
  {name: 'puddle', build: (a) => { a(cyl(0.3, 0.3, 0.008, 0, 0.005, 0, 14), '#3d94de', 0.3); a(cyl(0.2, 0.2, 0.012, 0.03, 0.007, 0.02, 12), '#62b4f0', 0.35); a(cyl(0.07, 0.07, 0.014, -0.08, 0.008, 0.03, 8), '#d8f1ff', 0.4); }},
  {name: 'bucket', build: (a) => {
    a(cyl(0.08, 0.06, 0.11, 0, 0.055, 0, 8), '#d8dde0');
    a(cyl(0.065, 0.065, 0.01, 0, 0.1, 0, 8), WATER, 0.2);
    a(torus(0.08, 0.008, 0, 0.12, 0, 8), METAL);
  }},
  duck('duckM'),
  {name: 'volcano', build: (a) => {
    a(cyl(0.06, 0.2, 0.3, 0, 0.15, 0, 10), '#4d3d3b');
    a(cyl(0.08, 0.15, 0.1, 0, 0.2, 0, 10), '#5e4a47');
    a(cyl(0.065, 0.075, 0.02, 0, 0.31, 0, 10), '#2e2422');
    a(cyl(0.05, 0.05, 0.012, 0, 0.318, 0, 10), '#ff6a2a', 2);
    a(ball(0.045, 0, 0.33, 0, 1, 0.6, 1, 7), '#ffb04a', 2);
    for (const an of [0.3, 2.2, 4.1]) a(place(box(0.022, 0.19, 0.012, 0, 0, 0), Math.sin(an) * 0.1, 0.19, Math.cos(an) * 0.1, -0.42, an, 0), '#ff7a30', 1.6);
  }},
  {name: 'chair', build: (a) => {
    for (const [x, z] of [[0.14, 0.12], [-0.14, 0.12], [0.14, -0.14], [-0.14, -0.14]]) a(cyl(0.012, 0.012, 0.17, x, 0.085, z, 4), WOOD2);
    a(box(0.34, 0.012, 0.3, 0, 0.17, 0), WOOD2);
    a(place(box(0.28, 0.01, 0.12, 0, 0, 0), 0, 0.185, 0.07, -0.12), ORANGE);
    a(place(box(0.28, 0.01, 0.12, 0, 0, 0), 0, 0.186, -0.05, -0.12), WHITE);
    a(place(box(0.28, 0.01, 0.12, 0, 0, 0), 0, 0.185, -0.17, -0.12), ORANGE);
    a(place(box(0.3, 0.01, 0.12, 0, 0, 0), 0, 0.3, -0.24, 0.95), WHITE);
    a(place(box(0.3, 0.01, 0.12, 0, 0, 0), 0, 0.38, -0.31, 0.95), ORANGE);
    for (const x of [0.16, -0.16]) a(place(cyl(0.012, 0.012, 0.3, 0, 0, 0, 4), x, 0.32, -0.26, 0.95), WOOD2);
  }},
  {name: 'umbrella', build: (a) => {
    a(cyl(0.01, 0.01, 0.62, 0, 0.31, 0, 5), METAL);
    a(cone(0.34, 0.12, 0, 0.64, 0, 8), TEAL);
    a(place(torus(0.3, 0.012, 0, 0, 0, 14), 0, 0.58, 0, Math.PI / 2), WHITE);
    a(ball(0.02, 0, 0.71, 0, 1, 1, 1, 4), WHITE);
  }},
  ...['zzA', 'zzB', 'zzC'].map((n): Def => ({name: n, build: (a) => {
    a(box(0.08, 0.016, 0.012, 0, 0.04, 0), '#bfe3ff', 0.9);
    a(place(box(0.1, 0.016, 0.012, 0, 0, 0), 0, 0, 0, 0, 0, -0.9), '#bfe3ff', 0.9);
    a(box(0.08, 0.016, 0.012, 0, -0.04, 0), '#bfe3ff', 0.9);
  }})),
  // ---- from the sky ----
  {name: 'chute', build: (a) => {
    for (let i = 0; i < 8; i++) a(patch(0.34, 0, 0.5, 0, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2, 0.0, 1.45, 3, 4, 0.8), i % 2 ? WHITE : RED);
    for (let i = 0; i < 6; i++) {
      const an = (i / 6) * Math.PI * 2, rx = Math.sin(an) * 0.335 * Math.sin(1.45), rz = Math.cos(an) * 0.335 * Math.sin(1.45), ry = 0.5 + 0.335 * 0.8 * Math.cos(1.45);
      const len = Math.hypot(rx, ry, rz);
      const g = cyl(0.003, 0.003, len, 0, 0, 0, 3); g.translate(0, len / 2, 0);
      g.rotateZ(-Math.atan2(rx, ry)); g.rotateX(Math.atan2(rz, Math.hypot(rx, ry)));
      a(g, '#e8e2d6');
    }
  }},
  {name: 'crate', build: (a) => {
    a(box(0.24, 0.2, 0.24, 0, 0.1, 0), WOOD);
    for (const y of [0.04, 0.16]) a(box(0.25, 0.025, 0.25, 0, y, 0), WOOD2);
    a(box(0.08, 0.06, 0.005, 0, 0.11, 0.123), ORANGE);
  }},
  {name: 'crateLid', parent: 'crate', at: [0, 0.2, -0.12], build: (a) => { a(box(0.25, 0.02, 0.25, 0, 0.01, 0.12), WOOD2); a(box(0.1, 0.02, 0.06, 0, 0.025, 0.12), ORANGE); }},
  {name: 'cow', build: (a) => {
    a(ball(0.17, 0, 0.3, 0, 0.9, 0.78, 1.45, 10), WHITE);
    a(ball(0.075, 0.1, 0.35, 0.06, 1, 1, 1.3, 6), '#2e2a27'); a(ball(0.06, -0.09, 0.28, -0.1, 1, 1, 1.2, 6), '#2e2a27'); a(ball(0.05, 0.05, 0.4, -0.12, 1, 1, 1, 5), '#2e2a27');
    for (const [x, z] of [[0.09, 0.15], [-0.09, 0.15], [0.09, -0.15], [-0.09, -0.15]]) { a(cyl(0.028, 0.026, 0.17, x, 0.1, z, 5), WHITE); a(cyl(0.03, 0.03, 0.03, x, 0.015, z, 5), '#2e2a27'); }
    a(ball(0.05, 0, 0.17, -0.1, 1, 0.8, 1, 6), '#f2a8a8');
    a(place(cyl(0.008, 0.008, 0.16, 0, 0, 0, 4), 0, 0.3, -0.27, 0.5), WHITE); a(ball(0.025, 0, 0.21, -0.32, 1, 1.3, 1, 5), '#2e2a27');
  }},
  {name: 'cowHead', parent: 'cow', at: [0, 0.38, 0.22], build: (a) => {
    a(ball(0.095, 0, 0.0, 0.07, 1, 1, 1.05, 9), WHITE);
    a(ball(0.06, 0, -0.03, 0.15, 1.1, 0.85, 1, 7), '#f2a8a8');
    a(ball(0.014, 0.04, 0.02, 0.15, 1, 1, 1, 4), '#1a1a1a'); a(ball(0.014, -0.04, 0.02, 0.15, 1, 1, 1, 4), '#1a1a1a');
    a(place(cone(0.02, 0.07, 0, 0, 0, 5), 0.07, 0.08, 0.04, 0, 0, -0.7), '#e8dcc0'); a(place(cone(0.02, 0.07, 0, 0, 0, 5), -0.07, 0.08, 0.04, 0, 0, 0.7), '#e8dcc0');
    a(ball(0.035, 0.1, 0.02, 0.0, 0.6, 1, 1, 5), '#e8b4b4'); a(ball(0.035, -0.1, 0.02, 0.0, 0.6, 1, 1, 5), '#e8b4b4');
    a(ball(0.024, 0, -0.1, 0.06, 1, 1, 1, 5), GOLD, 0.7);
  }},
  duck('duck'),
  {name: 'splash', build: (a) => { a(place(torus(0.22, 0.03, 0, 0, 0, 14), 0, 0.02, 0, Math.PI / 2), '#cdeeff', 0.3); }},
  {name: 'fireball', build: (a) => {
    a(ball(0.17, 0, 0, 0, 1, 1, 1, 9), '#ff8a2a', 1.6);
    a(ball(0.11, 0, 0, 0.02, 1, 1, 1, 7), '#ffe27a', 2.2);
    a(place(cone(0.15, 1.1, 0, 0, 0, 8), 0, 0, 0.55, Math.PI / 2), '#ff6a1a', 1.2);
    a(place(cone(0.09, 0.8, 0, 0, 0, 6), 0, 0, 0.4, Math.PI / 2), '#fff0a0', 1.8);
  }},
  {name: 'rockCore', build: (a) => { a(ico(0.12, 0, 0, 0, 1).scale(1.1, 0.9, 1), '#5e5048'); a(ico(0.05, 0.1, 0.04, 0.05, 0), '#74645a'); }},
  {name: 'pizza', build: (a) => {
    a(cyl(0.2, 0.2, 0.035, 0, 0.018, 0, 14), '#e0b36a');
    a(cyl(0.18, 0.18, 0.012, 0, 0.038, 0, 14), '#c8402c');
    a(cyl(0.17, 0.17, 0.008, 0, 0.046, 0, 14), YELLOW);
    for (let i = 0; i < 7; i++) { const an = i * 0.9; a(cyl(0.03, 0.03, 0.01, Math.sin(an) * (0.04 + (i % 3) * 0.045), 0.055, Math.cos(an) * (0.04 + (i % 3) * 0.045), 7), '#b22b2b'); }
    for (let i = 0; i < 4; i++) a(ball(0.016, Math.sin(i * 1.9 + 0.3) * 0.11, 0.058, Math.cos(i * 1.9 + 0.3) * 0.11, 1, 0.3, 1, 4), GREEN);
  }},
  {name: 'slice', build: (a) => {
    a(place(new THREE.CylinderGeometry(0.2, 0.2, 0.035, 8, 1, false, 0, Math.PI / 4), 0, 0.02, 0), '#e0b36a');
    a(place(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 8, 1, false, 0, Math.PI / 4), 0, 0.04, 0), YELLOW);
    a(cyl(0.025, 0.025, 0.012, 0.07, 0.05, 0.1, 7), '#b22b2b');
  }},
  {name: 'junk', build: (a) => {
    a(box(0.13, 0.11, 0.13, 0, 0, 0), '#d4a933'); a(box(0.14, 0.02, 0.14, 0, 0.06, 0), '#9a7a24');
    for (const s of [1, -1]) { a(box(0.3, 0.008, 0.13, s * 0.24, 0.0, 0), '#2b4a8a'); a(box(0.3, 0.006, 0.01, s * 0.24, 0.006, 0), '#9fb4e0'); a(place(cyl(0.006, 0.006, 0.1, 0, 0, 0, 4), s * 0.09, 0, 0, 0, 0, Math.PI / 2), METAL); }
    a(place(patch(0.07, 0, 0, 0, 0, Math.PI * 2, 0, 1.0, 10, 3), 0, 0.09, 0.0), '#dcdfe2'); a(cyl(0.005, 0.005, 0.1, 0, 0.12, 0, 4), METAL);
    a(ball(0.012, 0, 0.17, 0, 1, 1, 1, 4), RED, 1.2);
  }},
  // ---- reactions ----
  {name: 'coin', build: (a) => {
    // centred on the bone (it rolls about its own axis, x)
    a(place(cyl(0.22, 0.22, 0.05, 0, 0, 0, 16), 0, 0, 0, 0, 0, Math.PI / 2), GOLD2);
    a(place(cyl(0.19, 0.19, 0.056, 0, 0, 0, 16), 0, 0, 0, 0, 0, Math.PI / 2), GOLD);
    for (const s of [1, -1]) {
      a(place(torus(0.075, 0.017, 0, 0, 0, 10), s * 0.03, 0, 0, 0, Math.PI / 2, 0), '#fff0a0', 0.4);
      for (const dy of [0.03, -0.03]) a(place(box(0.012, 0.012, 0.11, 0, 0, 0), s * 0.03, dy, -0.03), '#fff0a0', 0.4);
    }
  }},
  {name: 'ice', build: (a) => { a(ico(0.1, 0, 0.1, 0, 1).scale(1, 1.1, 0.9), ICE, 0.3); a(ico(0.045, 0.07, 0.15, 0.04, 0), '#e9fbff', 0.5); }},
  {name: 'board', build: (a) => {
    a(ball(0.19, 0, 0.015, 0, 0.42, 0.07, 1.25, 10), '#ff7a59');
    a(ball(0.19, 0, 0.022, 0, 0.14, 0.07, 1.25, 8), WHITE);
    a(cone(0.02, 0.06, 0, 0.012, -0.22, 4).rotateX(Math.PI / 2), DARK);
  }},
  {name: 'wave', build: (a) => {
    // an arch rolling along z: a half pipe with its inside as well, foam on the crest and the lip
    const arch = (r: number, c: string, g: number) => {
      const w = new THREE.CylinderGeometry(r, r, 0.9, 14, 1, true, -Math.PI * 0.55, Math.PI * 1.1); w.rotateX(Math.PI / 2);
      a(w, c, g); a(flip(w.clone()), c, g);
    };
    arch(0.2, '#3f9be6', 0.25); arch(0.17, '#7cc4f4', 0.3);
    for (let i = 0; i < 6; i++) a(ball(0.05, -0.02 + (i % 2) * 0.03, 0.2 - (i % 2) * 0.01, -0.36 + i * 0.145, 1, 0.8, 1.3, 6), WHITE, 0.4);
  }},
  {name: 'pool', build: (a) => {
    a(cyl(0.6, 0.6, 0.01, 0, 0.006, 0, 20), '#3f8fd0', 0.2);
    a(place(torus(0.6, 0.028, 0, 0, 0, 20), 0, 0.012, 0, Math.PI / 2), '#cdeeff', 0.35);
    a(place(torus(0.38, 0.012, 0, 0, 0, 16), 0, 0.012, 0, Math.PI / 2), '#8fd0ff', 0.3);
  }},
  {name: 'bobber', build: (a) => { a(ball(0.035, 0, 0.03, 0, 1, 1, 1, 6), RED); a(ball(0.03, 0, 0.012, 0, 1, 0.6, 1, 5), WHITE); }},
  {name: 'fishLine', build: (a) => { a(cyl(0.0035, 0.0035, 1, 0, 0.5, 0, 3), '#f3f0e8'); }},
  {name: 'fish', build: (a) => {
    a(ball(0.09, 0, 0, 0, 0.5, 0.7, 1.3, 8), '#f0903a'); a(place(cone(0.06, 0.1, 0, 0, 0, 4), 0, 0, -0.14, -1.57), '#e07828');
    a(ball(0.013, 0.04, 0.02, 0.07, 1, 1, 1, 4), DARK); a(ball(0.013, -0.04, 0.02, 0.07, 1, 1, 1, 4), DARK);
  }},
  {name: 'boot', build: (a) => { a(box(0.07, 0.15, 0.08, 0, 0.075, 0), '#6a4a34'); a(ball(0.05, 0, 0.03, 0.07, 1, 0.8, 1.4, 6), '#7a5640'); a(box(0.075, 0.025, 0.085, 0, 0.16, 0), '#3a2a20'); }},
  {name: 'brickPile', build: (a) => {
    const rows = [[3, 0], [2, 1], [1, 2]];
    for (const [n, r] of rows) for (let i = 0; i < n; i++) a(box(0.1, 0.05, 0.065, (i - (n - 1) / 2) * 0.105, 0.025 + r * 0.052, 0), i % 2 ? '#d8663a' : '#c0502b');
  }},
  {name: 'wall', build: (a) => { for (let i = 0; i < 4; i++) a(box(0.1, 0.05, 0.065, (i - 1.5) * 0.105, 0.025, 0), i % 2 ? '#d8663a' : '#c0502b'); for (let i = 0; i < 3; i++) a(box(0.1, 0.05, 0.065, (i - 1) * 0.105, 0.077, 0), i % 2 ? '#c0502b' : '#d8663a'); }},
  {name: 'conveyor', build: (a) => {
    a(box(1.1, 0.03, 0.22, 0, 0.12, 0), '#3b3f46');
    a(box(1.12, 0.04, 0.02, 0, 0.14, 0.12), '#f2c94c'); a(box(1.12, 0.04, 0.02, 0, 0.14, -0.12), '#f2c94c');
    for (const x of [-0.55, 0.55]) a(place(cyl(0.05, 0.05, 0.22, 0, 0, 0, 8), x, 0.12, 0, Math.PI / 2), '#8a929a');
    for (const x of [-0.45, 0, 0.45]) { a(box(0.04, 0.12, 0.2, x, 0.06, 0), '#5c626b'); }
    a(box(0.12, 0.2, 0.12, 0.62, 0.1, -0.2), ORANGE); a(ball(0.016, 0.62, 0.22, -0.2, 1, 1, 1, 4), '#8cf7a0', 1.5);
  }},
  ...['cvA', 'cvB', 'cvC', 'cvD'].map((n, i): Def => ({name: n, build: (a) => { a(box(0.11, 0.1, 0.11, 0, 0.05, 0), i % 2 ? WOOD : '#b88a54'); a(box(0.115, 0.02, 0.115, 0, 0.06, 0), WOOD2); }})),
  // ---- ambient ----
  ...rover('amb'),
  {name: 'drone', build: (a) => {
    a(ball(0.07, 0, 0, 0, 1.1, 0.6, 1.1, 8), WHITE); a(ball(0.014, 0, -0.01, 0.075, 1, 1, 1, 5), '#8cf7ff', 1.8);
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) a(place(cyl(0.008, 0.008, 0.12, 0, 0, 0, 4), x * 0.06, 0.025, z * 0.06, 0, Math.atan2(x, z) + Math.PI / 2, Math.PI / 2), METAL);
  }},
  ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z], i): Def => ({name: `drRot${i}`, parent: 'drone', at: [x * 0.12, 0.045, z * 0.12], build: (a) => {
    a(cyl(0.01, 0.01, 0.025, 0, 0, 0, 4), DARK); a(box(0.15, 0.004, 0.02, 0, 0.014, 0), '#d8dde0'); a(box(0.02, 0.004, 0.15, 0, 0.014, 0), '#d8dde0');
  }})),
  {name: 'drPkg', parent: 'drone', at: [0, -0.07, 0], build: (a) => { a(cyl(0.004, 0.004, 0.05, 0, -0.025, 0, 3), '#e8e2d6'); a(box(0.09, 0.08, 0.09, 0, -0.09, 0), '#c9a06b'); a(box(0.092, 0.012, 0.03, 0, -0.09, 0), ORANGE); }},
];

export type PartName = typeof DEFS[number]['name'] | string;

export type PropsRig = {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshStandardMaterial;
  /** a part's bone (its root bone for a prop made of several) */
  bone: (name: string) => THREE.Bone;
  /** scale a part away */
  hide: (name: string) => void;
  hideAll: () => void;
  /** move a part: world position, yaw, uniform scale (1 = as built) */
  put: (name: string, x: number, y: number, z: number, yaw?: number, s?: number) => THREE.Bone;
  /** a size factor on every part placed with put (1 at rest, smaller in a dive) */
  k: number;
  dispose: () => void;
};

export function createProps(): PropsRig {
  const P = new Parts();
  const names = DEFS.map((d) => d.name);
  const index = new Map(names.map((n, i) => [n, i]));
  const abs = new Map<string, [number, number, number]>();
  for (const d of DEFS) {
    const base = d.parent ? abs.get(d.parent)! : [0, 0, 0];
    abs.set(d.name, [base[0] + (d.at?.[0] ?? 0), base[1] + (d.at?.[1] ?? 0), base[2] + (d.at?.[2] ?? 0)]);
  }
  DEFS.forEach((d, i) => {
    const o = abs.get(d.name)!;
    d.build((geo, color, glow = 0) => {
      geo.translate(o[0], o[1], o[2]);
      geo.scale(CHAR_H, CHAR_H, CHAR_H);
      P.add(geo, i, color, glow);
    });
  });
  const geo = P.build();
  const group = new THREE.Group();
  const bones = DEFS.map((d) => { const b = new THREE.Bone(); b.name = d.name; return b; });
  DEFS.forEach((d, i) => {
    bones[i].position.set((d.at?.[0] ?? 0) * CHAR_H, (d.at?.[1] ?? 0) * CHAR_H, (d.at?.[2] ?? 0) * CHAR_H);
    (d.parent ? bones[index.get(d.parent)!] : group).add(bones[i]);
  });
  const material = lifeMaterial();
  const mesh = skinnedMesh(geo, material, bones, group);
  // pre-made temporaries: nothing is allocated when a part moves
  const bone = (n: string) => bones[index.get(n)!];
  const hide = (n: string) => { bones[index.get(n)!].scale.setScalar(0); };
  const hideAll = () => { for (const d of DEFS) if (!d.parent) bones[index.get(d.name)!].scale.setScalar(0); };
  const put = (n: string, x: number, y: number, z: number, yaw = 0, s = 1) => {
    const b = bones[index.get(n)!];
    b.position.set(x, y, z); b.rotation.set(0, yaw, 0); b.scale.setScalar(s * rig.k);
    return b;
  };
  hideAll();
  const rig = {group, mesh, material, bone, hide, hideAll, put, k: 1, dispose: () => { geo.dispose(); material.dispose(); mesh.skeleton.dispose(); }};
  return rig;
}

/** Triangles in the props mesh, for the budget test. */
export const PROPS_PARTS = DEFS.map((d) => d.name);
