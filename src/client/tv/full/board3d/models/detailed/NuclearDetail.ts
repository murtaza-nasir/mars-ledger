// Builders for the Detailed Nuclear Zone: ground (colour, emissive and bump canvases), the merged structures (cooling
// towers, turbine halls, transformer yards, pylons and cables, patrol vehicles, owner beacons), the containment dome
// with its lattice and ports, the core, electric arcs, the build-in flash and the glow/vapour points.
// Everything in unit space (hex circumradius 1). `lite` keeps the same layout with the small parts dropped.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ArcSet, arcMaterial, box, cable, canvasTexture, cone, cyl, detailMaterial, type DPart, GlowSet, hexGrid, hexR, mergeD,
  noiseDots, rnd, sph, strut, TAU, torus,
} from './NuclearKit';

/** craters (x, z, r) */
export const CRATERS: Array<[number, number, number]> = [[0.05, 0.8, 0.1], [0.77, -0.2, 0.075], [-0.78, -0.24, 0.07], [0.4, -0.7, 0.065]];
export const DOME_R = 0.31;
export const DOME_Y = 0.05;
const SQ = 0.9; // the dome's vertical squash
const RING_R = 0.5;
const TOWERS: Array<{x: number; z: number; h: number; r0: number; d: number}> = [
  {x: 0.69, z: -0.4, h: 0.8, r0: 0.145, d: 0.5}, {x: -0.69, z: -0.4, h: 0.66, r0: 0.125, d: 0.65},
];
const HALL_A = {x: 0, z: -0.75, len: 0.46, dep: 0.17, h: 0.065};
const HALL_B = {x: 0.67, z: 0.1, len: 0.3, dep: 0.15, h: 0.06};
const YARD = {x: -0.66, z: 0.1};
const PYLON_A = {x: -0.4, z: 0.54}, PYLON_B = {x: 0.4, z: 0.54};
const STACK = {x: -0.34, z: -0.7, h: 0.3};
const BEACONS = [0, 1, 2, 3, 4, 5].map((k) => { const a = k * Math.PI / 3; return {x: Math.cos(a) * 0.8, z: Math.sin(a) * 0.8, k}; });

const C = {
  conc: '#bdb8ab', concD: '#8f8b82', concDD: '#605d57', steel: '#757d86', steelD: '#3b4148', black: '#1b1d20', white: '#e8e6dd',
  yellow: '#e2ab1a', red: '#d63a2e', glass: '#ffd48c', teal: '#53f3d0', ceramic: '#b88c5c', ceramic2: '#a9b3b8', water: '#2d4650',
  olive: '#566349', rust: '#8a4f2f', drum: '#d9ae24', paint: '#c9c4b6',
};

let cache: ReturnType<typeof makeShared> | null = null;
export function nuclearAssets() { return (cache ??= makeShared()); }

/** pointy-top hex apothem-aware height: craters, scorched swell, a proud field sloping down at the edge */
function height(x: number, z: number): number {
  let h = 0;
  for (const [cx, cz, r] of CRATERS) {
    const d = Math.hypot(x - cx, z - cz) / r;
    h -= 0.04 * Math.max(0, 1 - d * d) * (r / 0.12);
    h += 0.014 * Math.exp(-Math.pow((d - 1.08) / 0.2, 2));
  }
  h += 0.003 * Math.sin(x * 11) * Math.cos(z * 9);
  const dm = Math.hypot(x, z);
  const f = dm / hexR(Math.atan2(z, x)), e = Math.min(1, Math.max(0, (0.99 - f) / 0.14));
  return (h + 0.012) * (e * e * (3 - 2 * e));
}

// ---- helpers for placing parts in a rotated local frame ----------------------------------------------------------
type V3 = [number, number, number];
const frame = (x: number, z: number, yaw: number) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return (l: V3): V3 => [x + l[0] * c + l[2] * s, l[1], z - l[0] * s + l[2] * c];
};

function makeShared() {
  // ============================ ground ============================
  const S = 2048, px = (v: number) => ((v + 1) / 2) * S, pr = (v: number) => (v / 2) * S;
  const cracks: Array<Array<[number, number]>> = [];
  { const r = rnd(7);
    for (let i = 0; i < 22; i++) {
      let a = (i / 22) * TAU + r() * 0.3, x = Math.cos(a) * (RING_R + 0.05 + r() * 0.35), z = Math.sin(a) * (RING_R + 0.05 + r() * 0.35);
      const pts: Array<[number, number]> = [[x, z]];
      const n = 5 + Math.floor(r() * 7);
      for (let k = 0; k < n; k++) { a += (r() - 0.5) * 0.9; const l = 0.03 + r() * 0.06; x += Math.cos(a) * l; z += Math.sin(a) * l; pts.push([x, z]); }
      cracks.push(pts);
    } }
  const pad = (g: CanvasRenderingContext2D, x: number, z: number, w: number, d: number, yaw: number, col: string) => {
    g.save(); g.translate(px(x), px(z)); g.rotate(-yaw); g.fillStyle = col; g.fillRect(-pr(w), -pr(d), pr(w) * 2, pr(d) * 2);
    g.strokeStyle = 'rgba(15,14,12,0.55)'; g.lineWidth = 3; g.strokeRect(-pr(w), -pr(d), pr(w) * 2, pr(d) * 2); g.restore();
  };
  const colorMap = canvasTexture(S, (g) => {
    g.fillStyle = '#6c5b4d'; g.fillRect(0, 0, S, S);
    const r = rnd(3);
    noiseDots(g, S, r, 26000, [100, 82, 68], 0.14, 0.45, 3);
    noiseDots(g, S, r, 9000, [60, 52, 46], 0.2, 0.5, 2);
    // ash drifts
    for (let i = 0; i < 30; i++) { const x = r() * S, y = r() * S, rr = 30 + r() * 90; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(70,64,58,0.35)'); gr.addColorStop(1, 'rgba(70,64,58,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); }
    // scorched halo and crater floors
    for (const [cx, cz, cr] of CRATERS) {
      const gr = g.createRadialGradient(px(cx), px(cz), 0, px(cx), px(cz), pr(cr) * 2.1);
      gr.addColorStop(0, 'rgba(10,8,6,0.96)'); gr.addColorStop(0.5, 'rgba(24,17,13,0.8)'); gr.addColorStop(1, 'rgba(30,22,18,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(px(cx), px(cz), pr(cr) * 2.1, 0, TAU); g.fill();
    }
    // concrete pads under the plant
    pad(g, 0, -0.75, 0.3, 0.14, 0, '#8c8a85');
    pad(g, HALL_B.x, HALL_B.z, 0.12, 0.24, 0, '#8c8a85');
    pad(g, YARD.x, YARD.z, 0.15, 0.24, 0, '#7e7d79');
    for (const t of TOWERS) { g.fillStyle = '#6f6c66'; g.beginPath(); g.arc(px(t.x), px(t.z), pr(t.r0 * 1.5), 0, TAU); g.fill(); }
    g.fillStyle = '#85827b'; g.beginPath(); g.arc(px(0), px(0), pr(0.44), 0, TAU); g.fill();
    // glassy fused patches
    for (let i = 0; i < 18; i++) {
      const a = r() * TAU, d = 0.55 + r() * 0.35, x = px(Math.cos(a) * d), y = px(Math.sin(a) * d), rr = 12 + r() * 38;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(30,86,80,0.8)'); gr.addColorStop(0.8, 'rgba(18,56,54,0.65)'); gr.addColorStop(1, 'rgba(120,200,190,0.3)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr, rr * (0.55 + r() * 0.4), r() * 3, 0, TAU); g.fill();
    }
    // the patrol road: asphalt ring with edge lines and a dashed centre line
    const rc = px(0);
    g.strokeStyle = '#2b2c2f'; g.lineWidth = pr(0.1); g.beginPath(); g.arc(rc, rc, pr(RING_R), 0, TAU); g.stroke();
    noiseDots(g, S, r, 6000, [60, 60, 62], 0.1, 0.3, 2);
    g.strokeStyle = '#d8d3c4'; g.lineWidth = 3; for (const k of [-0.045, 0.045]) { g.beginPath(); g.arc(rc, rc, pr(RING_R + k), 0, TAU); g.stroke(); }
    g.setLineDash([pr(0.035), pr(0.03)]); g.strokeStyle = '#e8c23a'; g.lineWidth = 3; g.beginPath(); g.arc(rc, rc, pr(RING_R), 0, TAU); g.stroke(); g.setLineDash([]);
    // hazard chevrons around the dome
    const r0 = pr(0.36), r1 = pr(0.43);
    g.save(); g.beginPath(); g.arc(rc, rc, r1, 0, TAU); g.arc(rc, rc, r0, 0, TAU, true); g.clip();
    for (let k = 0; k < 56; k++) { g.fillStyle = k % 2 ? '#f0b81c' : '#16110d'; g.beginPath(); g.moveTo(rc, rc); g.arc(rc, rc, r1 + 4, (k / 56) * TAU, ((k + 1) / 56) * TAU); g.fill(); }
    g.restore();
    // trefoil on a yellow disc and a bold ground stencil
    const tx = px(0), tz = px(0.64), tr = pr(0.065);
    g.fillStyle = '#e9ae17'; g.beginPath(); g.arc(tx, tz, tr, 0, TAU); g.fill();
    g.strokeStyle = '#18120d'; g.lineWidth = 5; g.stroke(); g.fillStyle = '#18120d';
    for (let k = 0; k < 3; k++) { const a0 = (k / 3) * TAU - Math.PI / 2 - 0.52; g.beginPath(); g.moveTo(tx, tz); g.arc(tx, tz, tr * 0.8, a0, a0 + 1.04); g.closePath(); g.fill(); }
    g.fillStyle = '#e9ae17'; g.beginPath(); g.arc(tx, tz, tr * 0.28, 0, TAU); g.fill();
    g.fillStyle = '#18120d'; g.beginPath(); g.arc(tx, tz, tr * 0.17, 0, TAU); g.fill();
    // painted bay lines and numbers at the halls
    g.strokeStyle = '#d8c25a'; g.lineWidth = 3; g.strokeRect(px(-0.28), px(-0.64), pr(0.56), pr(0.08));
    g.fillStyle = '#f0e6c0'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('T-1', px(-0.15), px(-0.6)); g.fillText('T-2', px(0.15), px(-0.6));
    g.save(); g.translate(px(0.57), px(0.1)); g.rotate(-Math.PI / 2); g.fillText('UNIT 2', 0, 0); g.restore();
    // tyre tracks
    g.strokeStyle = 'rgba(20,20,22,0.35)'; g.lineWidth = 5;
    for (const k of [-0.014, 0.014]) { g.beginPath(); g.arc(rc, rc, pr(RING_R + 0.02 + k), 0.3, 5.9); g.stroke(); }
    // hex edge: yellow-black kerb
    g.lineWidth = 8; g.strokeStyle = '#2a2420'; g.beginPath();
    for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; const x = px(Math.cos(a) * 0.955), y = px(Math.sin(a) * 0.955); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.setLineDash([22, 22]); g.strokeStyle = '#e2ab1a'; g.stroke(); g.setLineDash([]);
    // cracks, dark under the glow
    g.lineCap = 'round';
    for (const pts of cracks) { g.strokeStyle = 'rgba(5,4,3,0.9)'; g.lineWidth = 7; g.beginPath(); pts.forEach(([x, z], i) => i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z))); g.stroke(); }
  });
  const emissiveMap = canvasTexture(S, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const c = px(0), gr = g.createRadialGradient(c, c, 0, c, c, S * 0.46);
    gr.addColorStop(0, 'rgba(40,255,170,0.28)'); gr.addColorStop(0.5, 'rgba(20,160,120,0.1)'); gr.addColorStop(1, 'rgba(0,60,50,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pts of cracks) {
      for (const [w, col, blur] of [[10, 'rgba(30,230,150,0.5)', 16], [3.4, '#aaffd8', 7]] as const) {
        g.strokeStyle = col; g.lineWidth = w; g.shadowColor = '#22ffaa'; g.shadowBlur = blur;
        g.beginPath(); pts.forEach(([x, z], i) => i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z))); g.stroke();
      }
    }
    g.shadowBlur = 0;
    for (const [cx, cz, cr] of CRATERS) {
      const q = g.createRadialGradient(px(cx), px(cz), 0, px(cx), px(cz), pr(cr) * 1.2);
      q.addColorStop(0, 'rgba(60,255,170,0.75)'); q.addColorStop(0.6, 'rgba(20,150,110,0.4)'); q.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = q; g.beginPath(); g.arc(px(cx), px(cz), pr(cr) * 1.2, 0, TAU); g.fill();
    }
    // painted lines glow a little (reflective paint)
    g.strokeStyle = 'rgba(255,200,70,0.18)'; g.lineWidth = 6; g.beginPath(); g.arc(c, c, pr(RING_R), 0, TAU); g.stroke();
  });
  const bumpMap = canvasTexture(1024, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    const r = rnd(5);
    for (let i = 0; i < 30000; i++) { const v = 90 + r() * 90; g.fillStyle = `rgba(${v},${v},${v},${0.3 + r() * 0.4})`; g.fillRect(r() * s, r() * s, 1 + r() * 2.5, 1 + r() * 2.5); }
    g.fillStyle = 'rgba(128,128,128,0.9)'; g.beginPath(); g.arc(s / 2, s / 2, (RING_R + 0.06) * s / 2, 0, TAU); g.arc(s / 2, s / 2, (RING_R - 0.06) * s / 2, 0, TAU, true); g.fill('evenodd');
    g.lineCap = 'round'; g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = 3;
    for (const pts of cracks) { g.beginPath(); pts.forEach(([x, z], i) => { const X = (x + 1) / 2 * s, Y = (z + 1) / 2 * s; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); }
  });
  bumpMap.colorSpace = THREE.NoColorSpace;
  const groundFull = hexGrid(20, 72, height), groundLite = hexGrid(10, 36, height);
  const groundMat = new THREE.MeshStandardMaterial({map: colorMap, emissiveMap, emissive: '#ffffff', emissiveIntensity: 0.5, bumpMap, bumpScale: 1.6, roughness: 0.62, metalness: 0.2});

  // ============================ structures ============================
  const perOwner = new Map<string, THREE.BufferGeometry>();
  const structures = (owner: string, lite: boolean) => {
    const key = owner + (lite ? 'L' : 'F');
    let g = perOwner.get(key);
    if (!g) { g = mergeD(buildParts(owner, lite), lite); perOwner.set(key, g); }
    return g;
  };
  const domeGeo = new Map<string, THREE.BufferGeometry>();
  const dome = (lite: boolean) => {
    let g = domeGeo.get(String(lite));
    if (!g) { g = mergeD(domeParts(lite), lite); domeGeo.set(String(lite), g); }
    return g;
  };
  const core = new THREE.IcosahedronGeometry(0.085, 4); const coreLite = new THREE.IcosahedronGeometry(0.085, 2);
  const coreMat = makeCoreMaterial();
  const fxG = makeFx();
  const arcMat = arcMaterial('#8fc0ff');
  return {groundFull, groundLite, groundMat, structures, dome, makeDome: makeDomeMaterial, core, coreLite, coreMat, fx: fxG.geo, fxMat: fxG.mat, arcMat};
}

// ---- dome ---------------------------------------------------------------------------------------------------------
function domeParts(lite: boolean): DPart[] {
  const parts: DPart[] = [];
  const shell = new THREE.SphereGeometry(DOME_R, lite ? 24 : 48, lite ? 7 : 16, 0, TAU, 0, Math.PI / 2);
  parts.push({g: shell, c: C.conc, s: [1, SQ, 1], gl: -1});
  const R = DOME_R + 0.003;
  const nrib = 8, ribSeg = lite ? 8 : 18;
  for (let k = 0; k < nrib; k++) {
    const az = (k + 0.5) * TAU / nrib;
    const rib = new THREE.TorusGeometry(R, 0.0045, lite ? 3 : 4, ribSeg, Math.PI);
    parts.push({g: rib, c: C.steelD, r: [0, -az, 0], s: [1, SQ, 1]});
  }
  const rings = lite ? [0.62] : [0.62, 1.2];
  for (const el of rings) {
    const rr = Math.cos(el) * R + 0.001;
    parts.push({g: torus(rr, 0.0048, lite ? 16 : 36, 3), c: C.steelD, p: [0, Math.sin(el) * R * SQ, 0]});
  }
  // ports: hole frames (the shader cuts the holes)
  if (!lite) {
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < 8; k++) {
      const az = k * TAU / 8, el = 0.95, n = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el) / SQ * 1, Math.cos(el) * Math.sin(az)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, n);
      const pos: V3 = [Math.cos(el) * Math.cos(az) * (R + 0.002), Math.sin(el) * R * SQ + 0.002, Math.cos(el) * Math.sin(az) * (R + 0.002)];
      parts.push({g: torus(0.052, 0.0055, 16, 4), c: C.teal, q, p: pos, gl: 0.9});
    }
    for (let k = 0; k < 8; k++) { // small lower ports: a lit bezel
      const az = (k + 0.5) * TAU / 8, el = 0.4, n = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, n);
      parts.push({g: torus(0.03, 0.004, 10, 3), c: C.glass, q, gl: 0.8, p: [Math.cos(el) * Math.cos(az) * (R + 0.002), Math.sin(el) * R * SQ + 0.002, Math.cos(el) * Math.sin(az) * (R + 0.002)]});
    }
  }
  // crown: lantern cap, vent and the aviation mast
  const top = DOME_R * SQ;
  parts.push({g: cyl(0.045, 0.06, 0.018, lite ? 10 : 20), c: C.concD, p: [0, top - 0.012, 0]});
  parts.push({g: sph(0.04, lite ? 8 : 16, lite ? 4 : 8), c: C.conc, p: [0, top + 0.004, 0], s: [1, 0.55, 1]});
  parts.push({g: cyl(0.004, 0.005, 0.06, 5), c: C.steel, p: [0, top + 0.02, 0]});
  parts.push({g: sph(0.007, 6, 4), c: C.red, p: [0, top + 0.082, 0], gl: 1});
  return parts;
}

function makeDomeMaterial() {
  const dm = detailMaterial({roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide});
  const orig = dm.mat.onBeforeCompile;
  dm.mat.onBeforeCompile = (sh, rr) => {
    orig.call(dm.mat, sh, rr);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (vGl < -0.5) {
        float R0 = ${DOME_R.toFixed(4)};
        float el = asin(clamp(vPL.y / (R0 * ${SQ.toFixed(3)}), 0.0, 1.0)); float az = atan(vPL.z, vPL.x);
        float aa = mod(az + 0.3927, 0.785398) - 0.3927; float bb = mod(az, 0.785398) - 0.3927;
        float d1 = length(vec2(aa * cos(el), el - 0.95)); float d2 = length(vec2(bb * cos(el), el - 0.4));
        if (d1 < 0.17 || d2 < 0.095) discard;
        float rim = (d1 < 0.2 || d2 < 0.12) ? 1.0 : 0.0;
        float u = az * 3.8197, v = el * 3.8197; // 24 around, 6 up
        float f1 = fract(u + v), f2 = fract(u - v);
        float wd = (fwidth(u + v) + fwidth(u - v)) * 0.6;
        float ln = 1.0 - smoothstep(0.015, 0.05 + wd, min(min(f1, 1.0 - f1), min(f2, 1.0 - f2)));
        float cell = hsh(vec3(floor(u + v), floor(u - v), 1.0));
        diffuseColor.rgb *= 0.86 + 0.26 * cell;
        diffuseColor.rgb *= 1.0 - 0.38 * ln;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.22, 0.24), rim);
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.07, 0.09, 0.09);
        vDomeLn = ln * (1.0 - rim); vDomeBack = gl_FrontFacing ? 0.0 : 1.0;
      } else { vDomeLn = 0.0; vDomeBack = 0.0; }`)
      .replace('#include <common>', '#include <common>\nfloat vDomeLn; float vDomeBack;')
      .replace('totalEmissiveRadiance += vColor.rgb * max(vGl, 0.0) * uGl;', `totalEmissiveRadiance += vColor.rgb * max(vGl, 0.0) * uGl;
        { float pu = 0.5 + 0.5 * sin(uSpin * 1.15);
          totalEmissiveRadiance += vec3(0.1, 0.95, 0.65) * vDomeLn * (0.1 + 0.9 * uGl) * (0.5 + 0.5 * pu) * 0.8;
          totalEmissiveRadiance += vec3(0.1, 0.95, 0.6) * vDomeBack * (0.5 + 0.5 * pu) * 0.4; }`);
  };
  dm.mat.customProgramCacheKey = () => 'dome-v1';
  return dm;
}

function makeCoreMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uNight: {value: 0}},
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vL; uniform float uTime;
      void main(){ vL = position; float p = 0.5 + 0.5 * sin(uTime * 1.15);
        vec3 q = position * (1.0 + 0.04 * p + 0.015 * sin(position.y * 44.0 + uTime * 3.0));
        vec4 mv = modelViewMatrix * vec4(q, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uNight; varying vec3 vN; varying vec3 vV; varying vec3 vL;
      float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        vec3 n = normalize(vN), v = normalize(vV); float fr = pow(1.0 - abs(dot(n, v)), 1.6);
        float p = 0.5 + 0.5 * sin(uTime * 1.15);
        vec3 q = vL * 38.0; float w = vn(q + vec3(uTime * 0.9, 0.0, -uTime * 0.6)) * 0.6 + vn(q * 2.1 - uTime * 1.3) * 0.4;
        vec3 hot = mix(vec3(0.04, 0.85, 0.42), vec3(0.55, 1.0, 0.8), smoothstep(0.35, 0.85, w) * (0.5 + 0.5 * p));
        vec3 col = hot * (0.8 + 0.8 * p) * (1.0 + fr * 0.7) + vec3(0.0, 0.3, 0.25) * fr;
        gl_FragColor = vec4(col * mix(0.95, 1.3, uNight), 1.0);
      }`,
  });
}

function makeFx() {
  const disc = new THREE.CircleGeometry(0.98, 48); disc.rotateX(-Math.PI / 2); disc.translate(0, 0.012, 0);
  const pillar = new THREE.CylinderGeometry(0.16, 0.22, 1.5, 24, 1, true); pillar.translate(0, 0.75, 0);
  const sphere = new THREE.SphereGeometry(0.4, 24, 12, 0, TAU, 0, Math.PI / 2);
  const kind = (g: THREE.BufferGeometry, k: number) => { g.deleteAttribute('uv'); g.setAttribute('aK', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1)); };
  kind(disc, 0); kind(pillar, 1); kind(sphere, 2);
  const geo = mergeGeometries([disc, pillar, sphere], false)!;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {uAge: {value: 0}},
    vertexShader: `attribute float aK; varying float vK; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ vK = aK; vP = position; vN = normalize(normalMatrix * (aK > 1.5 ? normal : vec3(position.x, 0.0, position.z))); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uAge; varying float vK; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        float f1 = 1.0 - smoothstep(0.0, 0.6, uAge), f2 = exp(-pow((uAge - 1.7) / 0.25, 2.0));
        vec3 col; float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
        if (vK < 0.5) {
          float d = length(vP.xz);
          float rr = 0.98 * (1.0 - pow(1.0 - clamp((uAge - 1.6) / 0.9, 0.0, 1.0), 2.0)); float ringOn = step(1.6, uAge) * (1.0 - smoothstep(2.2, 2.6, uAge));
          float ring = exp(-pow((d - rr) / 0.05, 2.0)) * ringOn;
          float rr2 = 0.95 * clamp((uAge - 0.05) / 0.55, 0.0, 1.0); float blast = exp(-pow((d - rr2) / 0.09, 2.0)) * (1.0 - smoothstep(0.3, 0.7, uAge));
          float flash = exp(-d * 3.2) * f1 * 1.4;
          col = vec3(0.4, 1.0, 0.8) * (ring * 1.6 + blast * 1.4) + vec3(0.9, 1.0, 0.95) * flash;
        } else if (vK < 1.5) {
          float up = 1.0 - vP.y / 1.5; col = mix(vec3(0.5, 1.0, 0.8), vec3(1.0), f1) * e * up * (f1 * 2.4 + f2 * 1.2);
        } else {
          float k = exp(-pow((uAge - 0.12) / 0.2, 2.0)) * 1.8 + exp(-pow((uAge - 1.7) / 0.25, 2.0)) * 0.6;
          col = mix(vec3(1.0), vec3(0.45, 1.0, 0.8), 0.4) * e * k * 0.8;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return {geo, mat};
}

// ---- structures --------------------------------------------------------------------------------------------------
function buildParts(owner: string, lite: boolean): DPart[] {
  const P: DPart[] = [];
  const add = (g: THREE.BufferGeometry, c: string | number, p: V3, o: Partial<DPart> = {}) => { P.push({g, c, p, ...o}); };
  const seg = (n: number) => lite ? Math.max(6, Math.round(n * 0.5)) : n;
  const vault = (len: number, w: number, h: number, n = 14) => {
    const g = new THREE.CylinderGeometry(0.5, 0.5, len, lite ? 8 : n, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.scale(1, 2 * h, w); return g;
  };

  // ---- the dome's drum, apron, interior hardware ----
  add(cyl(DOME_R + 0.03, DOME_R + 0.05, DOME_Y, seg(48)), C.concD, [0, 0, 0], {f: 0.3, d: 0.1});
  add(torus(DOME_R + 0.0, 0.01, lite ? 20 : 48, lite ? 3 : 4), C.steelD, [0, DOME_Y, 0], {f: 0.3, d: 0.1});
  if (!lite) for (let k = 0; k < 24; k++) { const a = (k + 0.5) * TAU / 24; add(box(0.018, DOME_Y + 0.012, 0.03), C.concDD, [Math.cos(a) * (DOME_R + 0.045), 0, Math.sin(a) * (DOME_R + 0.045)], {r: [0, -a, 0], f: 0.3, d: 0.1}); }
  // reactor pedestal, cradle rings and cooling lines inside
  add(cyl(0.07, 0.09, 0.05, seg(20)), C.steelD, [0, DOME_Y, 0], {d: 0.9, f: 0.2});
  for (let k = 0; k < 3; k++) add(torus(0.115 - k * 0.012, 0.0055, lite ? 12 : 20, 3), C.teal, [0, DOME_Y + 0.085, 0], {r: [0.9 + k * 0.45, 0, 0.2], gl: 0.9, sp: {w: 0.9 + k * 0.5, ph: k * 2, x: 0, z: 0}, d: 1.0, f: 0.2});
  if (!lite) for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + 0.3; P.push(strut([Math.cos(a) * 0.1, DOME_Y + 0.02, Math.sin(a) * 0.1], [Math.cos(a) * 0.28, DOME_Y + 0.02, Math.sin(a) * 0.28], 0.007, C.steel, {d: 0.9, f: 0.2}, 6)); }

  // ---- cooling towers ----
  const towerProfile = (T: typeof TOWERS[0]) => (y: number) => { const t = y / T.h; return T.r0 * (1 - 0.46 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.82) + 0.12 * t * t); };
  TOWERS.forEach((T, i) => {
    const rad = towerProfile(T);
    const pts: THREE.Vector2[] = []; const np = lite ? 6 : 12;
    for (let k = 0; k <= np; k++) { const y = (k / np) * T.h; pts.push(new THREE.Vector2(rad(y), y)); }
    const lathe = new THREE.LatheGeometry(pts, lite ? 14 : 28);
    add(lathe, C.conc, [T.x, 0.03, T.z], {f: 0.7, d: T.d});
    // base basin and lattice supports
    add(cyl(T.r0 * 1.32, T.r0 * 1.36, 0.02, lite ? 12 : 24), C.concDD, [T.x, 0, T.z], {f: 0.4, d: T.d});
    if (!lite) add(cyl(T.r0 * 1.24, T.r0 * 1.24, 0.004, 24), C.water, [T.x, 0.02, T.z], {f: 0.4, d: T.d});
    if (!lite) for (let k = 0; k < 16; k++) {
      const a = k * TAU / 16, a2 = a + 0.14;
      P.push(strut([T.x + Math.cos(a) * T.r0 * 1.12, 0.02, T.z + Math.sin(a) * T.r0 * 1.12], [T.x + Math.cos(a2) * T.r0 * 1.0, 0.08, T.z + Math.sin(a2) * T.r0 * 1.0], 0.0045, C.concD, {f: 0.7, d: T.d}, 4));
      P.push(strut([T.x + Math.cos(a2) * T.r0 * 1.12, 0.02, T.z + Math.sin(a2) * T.r0 * 1.12], [T.x + Math.cos(a) * T.r0 * 1.0, 0.08, T.z + Math.sin(a) * T.r0 * 1.0], 0.0045, C.concD, {f: 0.7, d: T.d}, 4));
    }
    // rim, dark throat, hazard and aviation bands, ladder
    add(torus(rad(T.h) + 0.002, 0.007, lite ? 14 : 32, 3), C.concD, [T.x, 0.03 + T.h, T.z], {f: 0.7, d: T.d});
    add(cyl(rad(T.h) - 0.004, rad(T.h) - 0.004, 0.004, lite ? 12 : 24), '#16191b', [T.x, 0.03 + T.h - 0.014, T.z], {f: 0.7, d: T.d});
    const band = (y0: number, y1: number, col: string) => add(cyl(rad(y1) + 0.0035, rad(y0) + 0.0035, y1 - y0, lite ? 12 : 28), col, [T.x, 0.03 + y0, T.z], {f: 0.7, d: T.d});
    band(T.h * 0.9, T.h * 0.94, C.red); if (!lite) band(T.h * 0.94, T.h * 0.98, C.white); band(T.h * 0.5, T.h * 0.54, C.yellow);
    if (!lite) {
      P.push(strut([T.x + rad(0.02) + 0.004, 0.04, T.z + 0.0], [T.x + rad(T.h) + 0.004, T.h + 0.03, T.z + 0.0], 0.003, C.steelD, {f: 0.7, d: T.d}, 4));
      for (let k = 1; k < 5; k++) { const y = T.h * k / 5; add(torus(rad(y) + 0.0075, 0.0022, 12, 3, Math.PI), C.steel, [T.x, 0.03 + y, T.z], {r: [0, 0, 0], f: 0.7, d: T.d}); }
      // walkway at the throat with a rail
      const yW = T.h * 0.66; add(torus(rad(yW) + 0.012, 0.003, 28, 3), C.steelD, [T.x, 0.03 + yW, T.z], {f: 0.7, d: T.d}); 
      // water spill streaks at the base (dark) and a few louvre vents
      for (let k = 0; k < 8; k++) { const a = k * TAU / 8 + 0.2; add(box(0.02, 0.018, 0.004), C.black, [T.x + Math.cos(a) * (rad(0.04) + 0.002), 0.045, T.z + Math.sin(a) * (rad(0.04) + 0.002)], {r: [0, -a + Math.PI / 2, 0], f: 0.7, d: T.d}); }
    }
    add(sph(0.006, 6, 4), C.red, [T.x + rad(T.h), T.h + 0.05, T.z], {gl: 1, f: 0.7, d: T.d});
    // pipe run to the turbine hall (and a bend at the tower)
    const toHall: V3 = i === 0 ? [HALL_A.x + HALL_A.len / 2, 0.038, HALL_A.z + 0.02] : [HALL_A.x - HALL_A.len / 2, 0.038, HALL_A.z + 0.02];
    const start: V3 = [T.x + (i === 0 ? -1 : 1) * T.r0 * 1.2, 0.038, T.z - 0.05];
    P.push(strut(start, [toHall[0] + (i === 0 ? 0.0 : 0.0), 0.038, start[2]], 0.013, C.steel, {f: 0.3, d: 0.8 + i * 0.05}, seg(8)));
    P.push(strut([toHall[0], 0.038, start[2]], toHall, 0.013, C.steel, {f: 0.3, d: 0.8 + i * 0.05}, seg(8)));
    add(sph(0.016, seg(8), 5), C.steelD, [toHall[0], 0.038, start[2]], {f: 0.3, d: 0.8});
    add(sph(0.016, seg(8), 5), C.steelD, [start[0], 0.038, start[2]], {f: 0.3, d: 0.8});
    if (!lite) { for (let k = 1; k < 5; k++) { const x = start[0] + (toHall[0] - start[0]) * k / 5; add(box(0.012, 0.03, 0.016), C.concDD, [x, 0, start[2]], {f: 0.3, d: 0.8}); add(torus(0.015, 0.004, 10, 3), C.red, [x, 0.038, start[2]], {r: [0, 0, Math.PI / 2], f: 0.3, d: 0.8}); } }
  });

  // ---- turbine hall A (back) and B (east) ----
  const hall = (H: {x: number; z: number; len: number; dep: number; h: number}, along: 'x' | 'z', d: number, tag: number) => {
    const yaw = along === 'x' ? 0 : Math.PI / 2;
    const F = frame(H.x, H.z, yaw);
    const L = H.len, W = H.dep;
    P.push({g: box(L, H.h, W), c: C.paint, p: F([0, 0, 0]), r: [0, yaw, 0], f: 0.2, d});
    P.push({g: box(L + 0.012, 0.008, W + 0.012), c: C.concDD, p: F([0, 0, 0]), r: [0, yaw, 0], f: 0.2, d});
    P.push({g: vault(L + 0.01, W + 0.01, 0.05), c: '#a9b2b5', p: F([0, H.h, 0]), r: [0, yaw, 0], f: 0.2, d: d + 0.05});
    P.push({g: box(L + 0.014, 0.01, 0.03), c: C.yellow, p: F([0, H.h + 0.047, 0]), r: [0, yaw, 0], f: 0.2, d: d + 0.05});
    // window band, doors and roof lights
    const nw = lite ? 5 : 8;
    for (let k = 0; k < nw; k++) {
      const x = -L / 2 + (L * (k + 0.5)) / nw;
      P.push({g: box(L / nw * 0.62, 0.022, 0.004), c: C.glass, p: F([x, 0.032, W / 2 + 0.0015]), r: [0, yaw, 0], gl: 1, f: 0.2, d});
      if (!lite) P.push({g: box(L / nw * 0.62, 0.022, 0.004), c: C.glass, p: F([x, 0.032, -W / 2 - 0.0015]), r: [0, yaw, 0], gl: 1, f: 0.2, d});
    }
    P.push({g: box(0.05, 0.045, 0.004), c: '#2b3036', p: F([L / 2 * 0.0 + 0.0, 0, W / 2 + 0.0012]), r: [0, yaw, 0], f: 0.2, d});
    if (!lite) {
      for (let k = 0; k < 6; k++) P.push({g: box(0.03, 0.01, 0.014), c: C.glass, p: F([-L / 2 + 0.06 + (k * (L - 0.12)) / 5, H.h + 0.043, 0.0]), r: [0, yaw, 0], gl: 0.7, f: 0.2, d: d + 0.1});
      for (let k = 0; k < 3; k++) { const x = -L * 0.3 + k * L * 0.3; P.push({g: cyl(0.01, 0.01, 0.025, 8), c: C.steelD, p: F([x, H.h + 0.05, W * 0.28]), f: 0.2, d: d + 0.1}); P.push({g: cyl(0.014, 0.014, 0.004, 8), c: C.steel, p: F([x, H.h + 0.075, W * 0.28]), f: 0.2, d: d + 0.1}); }
      // overhead crane rail along the front and a big exhaust duct
      P.push(strut(F([-L / 2, H.h * 0.9, W / 2 + 0.014]), F([L / 2, H.h * 0.9, W / 2 + 0.014]), 0.004, C.steel, {f: 0.2, d}, 4));
      for (let k = 0; k < 5; k++) P.push({g: box(0.005, H.h * 0.9, 0.005), c: C.steel, p: F([-L / 2 + 0.02 + k * (L - 0.04) / 4, 0, W / 2 + 0.014]), f: 0.2, d});
      P.push({g: cyl(0.014, 0.014, W * 0.7, 10), c: C.steelD, p: F([L / 2 + 0.014, 0.04, 0]), r: [Math.PI / 2, yaw, 0], f: 0.2, d});
    }
  };
  hall(HALL_A, 'x', 0.7, 0); hall(HALL_B, 'z', 0.85, 1);
  // stack with red/white bands
  add(cyl(0.015, 0.026, STACK.h, seg(14)), C.concD, [STACK.x, 0, STACK.z], {f: 0.4, d: 0.8});
  for (let k = 0; k < 3; k++) add(cyl(0.0185 - k * 0.0015, 0.0205 - k * 0.0015, 0.03, seg(14)), k % 2 ? C.white : C.red, [STACK.x, STACK.h - 0.09 + k * 0.03, STACK.z], {f: 0.4, d: 0.8});
  add(sph(0.006, 6, 4), C.red, [STACK.x, STACK.h + 0.018, STACK.z], {gl: 1, f: 0.4, d: 0.8});

  // ---- transformer yard ----
  {
    const F = frame(YARD.x, YARD.z, 0);
    add(box(0.2, 0.008, 0.3), C.concDD, F([0, 0, 0]), {f: 0.2, d: 0.9});
    const trafo = (zc: number, ph: number) => {
      const tz = zc;
      add(box(0.1, 0.05, 0.065), C.olive, F([0, 0.008, tz]), {f: 0.2, d: 0.95});
      add(cyl(0.018, 0.018, 0.08, seg(10)), C.olive, F([-0.03, 0.058, tz]), {r: [0, 0, Math.PI / 2], f: 0.2, d: 0.95});
      add(box(0.1, 0.006, 0.07), C.steelD, F([0, 0.058, tz]), {f: 0.2, d: 0.95});
      // cooling radiators on both ends
      if (!lite) for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) add(box(0.004, 0.04, 0.05), C.olive, F([sx * (0.054 + k * 0.007), 0.012, tz]), {f: 0.2, d: 0.95});
      // three bushings: porcelain stacks
      for (let k = -1; k <= 1; k++) {
        if (lite && k !== 0) continue;
        const bx = k * 0.03, by = 0.064, rows = lite ? 2 : 5;
        add(cyl(0.006, 0.006, 0.01, 6), C.steelD, F([bx, by, tz]), {f: 0.2, d: 0.95});
        for (let m = 0; m < rows; m++) add(cyl(m % 2 ? 0.0095 : 0.007, m % 2 ? 0.007 : 0.0095, 0.0105, seg(8)), C.ceramic, F([bx, by + 0.01 + m * 0.0105 * (lite ? 2.5 : 1), tz]), {f: 0.2, d: 0.95});
        add(sph(0.006, 6, 4), C.steel, F([bx, by + 0.014 + rows * 0.0105 * (lite ? 2.5 : 1), tz]), {f: 0.2, d: 0.95});
      }
      void ph;
    };
    trafo(-0.09, 0); trafo(0.0, 1); trafo(0.09, 2);
    if (!lite) {
      // firewalls between the transformers, a fence round the yard and a gantry with insulator strings
      for (const z of [-0.045, 0.045]) add(box(0.14, 0.07, 0.005), C.concD, F([0, 0.008, z]), {f: 0.2, d: 0.95});
      for (let k = 0; k <= 6; k++) { const z = -0.15 + k * 0.05; for (const x of [-0.1, 0.1]) add(cyl(0.0025, 0.0025, 0.03, 4), C.steel, F([x, 0.008, z]), {f: 0.2, d: 1.0}); }
      P.push(strut(F([-0.1, 0.034, -0.15]), F([-0.1, 0.034, 0.15]), 0.0015, C.steel, {f: 0.2, d: 1.0}, 3)); P.push(strut(F([0.1, 0.034, -0.15]), F([0.1, 0.034, 0.15]), 0.0015, C.steel, {f: 0.2, d: 1.0}, 3));
      P.push(strut(F([-0.1, 0.034, -0.15]), F([0.1, 0.034, -0.15]), 0.0015, C.steel, {f: 0.2, d: 1.0}, 3)); P.push(strut(F([-0.1, 0.034, 0.15]), F([0.1, 0.034, 0.15]), 0.0015, C.steel, {f: 0.2, d: 1.0}, 3));
    }
    const gz = 0.0; const gh = 0.17;
    for (const sx of [-0.082, 0.082]) { P.push(strut(F([sx, 0.008, gz - 0.13]), F([sx, gh, gz - 0.13]), 0.004, C.steel, {f: 0.4, d: 1.0}, 4)); P.push(strut(F([sx, 0.008, gz + 0.13]), F([sx, gh, gz + 0.13]), 0.004, C.steel, {f: 0.4, d: 1.0}, 4)); }
    P.push(strut(F([-0.082, gh, gz - 0.13]), F([-0.082, gh, gz + 0.13]), 0.0035, C.steel, {f: 0.4, d: 1.0}, 4)); P.push(strut(F([0.082, gh, gz - 0.13]), F([0.082, gh, gz + 0.13]), 0.0035, C.steel, {f: 0.4, d: 1.0}, 4));
    // conductors from the bushings up to the gantry
    for (const tz of [-0.09, 0, 0.09]) for (const k of [-1, 1]) if (!lite || k === 1) {
      const top = DOME_Y; void top;
      P.push(...cable(F([k * 0.03, 0.12, tz]), F([k * 0.082, gh, gz + (tz < 0 ? -0.13 : tz > 0 ? 0.13 : 0)]), 0.004, lite ? 2 : 4, C.black, {f: -0.2, d: 1.1}, 0.0018));
    }
  }

  // ---- pylons and the cables that leave the tile ----
  const pylon = (px: number, pz: number, yaw: number, h: number, d: number): V3[][] => {
    const F = frame(px, pz, yaw);
    const bw = 0.04, tw = 0.009, hm = h * 0.72;
    const cornerAt = (sx: number, sz: number, y: number): V3 => { const t = Math.min(1, y / hm), w = bw + (tw - bw) * t; return F([sx * w, y, sz * w]); };
    const legs: Array<[number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [sx, sz] of legs) P.push(strut(cornerAt(sx, sz, 0), cornerAt(sx, sz, hm), 0.0035, C.steel, {f: 0.5, d}, 4));
    const levels = lite ? [0, hm * 0.5, hm] : [0, hm * 0.2, hm * 0.4, hm * 0.6, hm * 0.8, hm];
    for (let k = 0; k < levels.length - 1; k++) {
      const y0 = levels[k], y1 = levels[k + 1];
      for (let m = 0; m < 4; m++) {
        const [ax, az] = legs[[0, 1, 3, 2][m]], [bx, bz] = legs[[1, 3, 2, 0][m]];
        P.push(strut(cornerAt(ax, az, y0), cornerAt(bx, bz, y1), 0.0018, C.steelD, {f: 0.5, d}, 3));
        if (!lite) P.push(strut(cornerAt(bx, bz, y0), cornerAt(ax, az, y1), 0.0018, C.steelD, {f: 0.5, d}, 3));
        if (!lite && k > 0) P.push(strut(cornerAt(ax, az, y0), cornerAt(bx, bz, y0), 0.0018, C.steelD, {f: 0.5, d}, 3));
      }
    }
    // mast above the waist, three cross arms with insulator strings
    P.push(strut(F([0, hm, 0]), F([0, h, 0]), 0.0035, C.steel, {f: 0.5, d}, 4));
    const ends: V3[][] = [];
    const arms = lite ? [[hm * 0.78, 0.075]] : [[hm * 0.55, 0.095], [hm * 0.78, 0.075], [hm * 0.98, 0.05]];
    for (const [ay, aw] of arms) {
      P.push(strut(F([-aw, ay, 0]), F([aw, ay, 0]), 0.0035, C.steel, {f: 0.5, d}, 4));
      if (!lite) { P.push(strut(F([0, hm * 0.98 + 0.012, 0]), F([-aw, ay + 0.005, 0]), 0.0018, C.steelD, {f: 0.5, d}, 3)); P.push(strut(F([0, hm * 0.98 + 0.012, 0]), F([aw, ay + 0.005, 0]), 0.0018, C.steelD, {f: 0.5, d}, 3)); }
      const row: V3[] = [];
      for (const sx of [-1, 1]) {
        const top = F([sx * aw, ay, 0]), bot = F([sx * aw, ay - 0.032, 0]);
        P.push(strut(top, bot, 0.003, C.ceramic2, {f: -0.2, d: d + 0.1}, 5));
        if (!lite) for (let m = 0; m < 4; m++) P.push({g: cyl(0.007, 0.007, 0.0035, 6), c: C.ceramic2, p: F([sx * aw, ay - 0.007 - m * 0.0075, 0]), f: -0.2, d: d + 0.1});
        row.push(bot);
      }
      ends.push(row);
    }
    P.push({g: sph(0.006, 6, 4), c: C.red, p: F([0, h + 0.01, 0]), gl: 1, f: 0.5, d});
    P.push({g: cyl(0.05, 0.055, 0.008, 4), c: C.concDD, p: F([0, 0, 0]), r: [0, yaw + Math.PI / 4, 0], f: 0.5, d});
    return ends;
  };
  // pylon A: arms across the line direction (line runs yard -> pylon A -> out through the front-left face)
  const endsA = pylon(PYLON_A.x, PYLON_A.z, yawFor(0.53, 0.85), 0.5, 1.0);
  const endsB = pylon(PYLON_B.x, PYLON_B.z, yawFor(-0.53, 0.85), 0.5, 1.15);
  // cables: yard gantry -> pylon A -> edge ; hall B roof -> pylon B -> edge
  const yardTop = frame(YARD.x, YARD.z, 0);
  const lowArm = (ends: V3[][]) => ends[0];
  {
    const a = lowArm(endsA), nC = lite ? 1 : 2;
    const outA = (p: V3): V3 => [p[0] + 0.53 * 0.46 + 0.0, Math.max(0.16, p[1] - 0.14), p[2] + 0.85 * 0.46];
    for (let k = 0; k < 2; k++) {
      const arm = endsA[k]; const hide = lite && k === 1;
      if (hide) continue;
      for (const [si, pt] of arm.entries()) {
        const from = yardTop([si === 0 ? -0.082 : 0.082, 0.17, si === 0 ? -0.13 : 0.13]);
        const sx = si === 0 ? -1 : 1;
        P.push(...cable(from, pt, 0.035, lite ? 4 : 8, C.black, {f: -0.4, d: 1.3}, 0.0024));
        P.push(...cable(pt, outA(pt), 0.025, lite ? 3 : 6, C.black, {f: -0.4, d: 1.35}, 0.0024));
        void sx;
      }
    }
    void a; void nC;
  }
  {
    const hb = frame(HALL_B.x, HALL_B.z, Math.PI / 2);
    const outB = (p: V3): V3 => [p[0] - 0.53 * 0.46, Math.max(0.16, p[1] - 0.14), p[2] + 0.85 * 0.46];
    for (let k = 0; k < 2; k++) {
      if (lite && k === 1) continue;
      for (const [si, pt] of endsB[k].entries()) {
        const from = hb([si === 0 ? -0.1 : 0.1, 0.1, 0]);
        P.push(...cable(from, pt, 0.03, lite ? 4 : 8, C.black, {f: -0.4, d: 1.3}, 0.0024));
        P.push(...cable(pt, outB(pt), 0.025, lite ? 3 : 6, C.black, {f: -0.4, d: 1.35}, 0.0024));
      }
    }
    // service poles at hall B's roofline and a roof-top transformer
    P.push({g: box(0.06, 0.03, 0.05), c: C.olive, p: hb([0.0, 0.1, 0]), r: [0, Math.PI / 2, 0], f: 0.2, d: 1.1});
    for (const sx of [-0.1, 0.1]) P.push(strut(hb([sx, 0.095, 0]), hb([sx, 0.108, 0]), 0.003, C.ceramic, {f: 0.2, d: 1.1}, 5));
  }

  // ---- patrol vehicles on the ring road (they spin about the dome) ----
  const vehicle = (kind: number, phase: number) => {
    const sp = {w: 0.24, ph: phase, x: 0, z: 0};
    const bx = RING_R, add2 = (g: THREE.BufferGeometry, c: string | number, p: V3, o: Partial<DPart> = {}) => P.push({g, c, p: [bx + p[0], p[1], p[2]], sp, d: 1.5, f: -0.3, ...o});
    // front points to -z (the direction of travel at phase 0)
    const body = kind === 0 ? C.white : kind === 1 ? '#c0a24a' : '#8d99a2';
    const cabH = kind === 1 ? 0.03 : 0.024;
    add2(box(0.034, 0.014, 0.075), body, [0, 0.008, 0]);
    add2(box(0.032, cabH, 0.03), body, [0, 0.022, -0.016]);
    add2(box(0.0325, 0.011, 0.0015), '#22343c', [0, 0.034, -0.0317], {gl: 0.0});
    add2(box(0.034, 0.02, 0.03), kind === 2 ? C.drum : '#7a8086', [0, 0.022, 0.026]);
    if (kind === 2) add2(cyl(0.01, 0.01, 0.025, 8), C.yellow, [0, 0.042, 0.026]);
    if (kind === 0) add2(box(0.026, 0.004, 0.006), C.red, [0, 0.047, -0.016], {gl: 1});
    if (kind === 1) add2(box(0.026, 0.004, 0.006), '#ff9a2e', [0, 0.053, -0.016], {gl: 1});
    add2(box(0.006, 0.004, 0.002), '#fff2c0', [-0.011, 0.014, -0.0385], {gl: 1}); add2(box(0.006, 0.004, 0.002), '#fff2c0', [0.011, 0.014, -0.0385], {gl: 1});
    add2(box(0.034, 0.004, 0.076), C.yellow, [0, 0.016, 0]);
    if (!lite) for (const sx of [-1, 1]) for (const sz of [-0.025, 0.025]) add2(cyl(0.008, 0.008, 0.007, 8), '#16181a', [sx * 0.018, 0.008, sz], {r: [0, 0, Math.PI / 2]});
  };
  vehicle(0, 0); vehicle(1, 2.1); vehicle(2, 4.2);

  // ---- owner beacons, hazard bollards, drums, casks, signs, dead trees ----
  for (const b of BEACONS) {
    const d = 0.4 + b.k * 0.08;
    add(box(0.05, 0.012, 0.05), owner, [b.x, 0, b.z], {r: [0, Math.PI / 4, 0], f: 0.3, d});
    add(cyl(0.008, 0.012, 0.16, 6), C.steelD, [b.x, 0.012, b.z], {f: 0.3, d});
    add(cyl(0.022, 0.018, 0.026, seg(10)), owner, [b.x, 0.17, b.z], {gl: 1.1, f: 0.3, d});
    add(sph(0.012, 6, 4), '#ffffff', [b.x, 0.2, b.z], {gl: 1, f: 0.3, d});
    if (!lite) add(torus(0.026, 0.0035, 14, 3), C.yellow, [b.x, 0.145, b.z], {f: 0.3, d});
  }
  if (!lite) {
    for (let k = 0; k < 20; k++) { // bollards along the dome's hazard ring
      const a = k * TAU / 20; if (a > 1.2 && a < 1.5) continue;
      add(cyl(0.005, 0.0055, 0.022, 5), k % 2 ? C.yellow : C.black, [Math.cos(a) * 0.435, 0, Math.sin(a) * 0.435], {f: 0.2, d: 0.8});
    }
    // waste drums and casks by hall A and the stack
    const drum = (x: number, z: number, d: number) => { add(cyl(0.012, 0.012, 0.028, 10), C.drum, [x, 0, z], {f: 0.2, d}); add(cyl(0.0125, 0.0125, 0.004, 10), C.black, [x, 0.012, z], {f: 0.2, d}); };
    for (let k = 0; k < 6; k++) drum(-0.2 + (k % 3) * 0.028, -0.58 + Math.floor(k / 3) * 0.028, 1.0 + k * 0.03);
    drum(-0.17, -0.58 + 0.0, 1.3);
    for (let k = 0; k < 6; k++) { const x = 0.36 + (k % 3) * 0.045, z = -0.56 - Math.floor(k / 3) * 0.05; add(cyl(0.017, 0.018, 0.055, 12), C.conc, [x, 0, z], {f: 0.2, d: 1.0}); add(cyl(0.0145, 0.0145, 0.006, 12), C.steelD, [x, 0.055, z], {f: 0.2, d: 1.0}); add(box(0.014, 0.006, 0.0015), C.yellow, [x, 0.03, z + 0.0182], {f: 0.2, d: 1.0}); }
    // trefoil signs on posts
    const sign = (x: number, z: number, yaw: number, d: number) => {
      add(cyl(0.0025, 0.0025, 0.05, 4), C.steel, [x, 0, z], {f: 0.2, d});
      const g = new THREE.CylinderGeometry(0.016, 0.016, 0.003, 12); g.rotateX(Math.PI / 2);
      add(g, C.yellow, [x, 0.05, z], {r: [0, yaw, 0], f: 0.2, d, gl: 0.25});
      const t = new THREE.CylinderGeometry(0.0075, 0.0075, 0.0035, 3); t.rotateX(Math.PI / 2);
      add(t, C.black, [x, 0.05, z], {r: [0, yaw, 0], f: 0.2, d});
    };
    sign(0.12, 0.64, 0.0, 1.0); sign(-0.12, 0.64, 0.0, 1.05); sign(0.58, -0.04, Math.PI / 2, 1.1); sign(-0.55, -0.3, 0.6, 1.1);
    // dead trees at the edge of the blast
    const rr = rnd(21);
    for (const [x, z] of [[0.3, 0.78], [-0.28, 0.76], [0.84, 0.2], [-0.82, 0.3], [0.54, 0.7], [-0.6, 0.64]] as Array<[number, number]>) {
      const hgt = 0.06 + rr() * 0.05; P.push(strut([x, 0, z], [x + 0.005, hgt, z], 0.003, '#241d18', {f: 0.2, d: 1.1}, 4));
      for (let k = 0; k < 3; k++) { const a = rr() * TAU; P.push(strut([x + 0.004, hgt * (0.5 + 0.2 * k), z], [x + Math.cos(a) * 0.025, hgt * (0.7 + 0.22 * k) + 0.01, z + Math.sin(a) * 0.025], 0.0016, '#241d18', {f: 0.2, d: 1.1}, 3)); }
    }
    // rubble ringing the craters
    for (const [cx, cz, cr] of CRATERS) for (let k = 0; k < 5; k++) {
      const a = rr() * TAU, dd = cr * (1.0 + rr() * 0.3), s = 0.006 + rr() * 0.01;
      add(box(s, s * 0.7, s * 1.2), rr() > 0.5 ? '#4a4540' : '#6a615a', [cx + Math.cos(a) * dd, 0.004, cz + Math.sin(a) * dd], {r: [rr(), rr() * 3, rr()], f: 0.1, d: 0.6});
    }
    // pipework valve wheels and small shed at the east flank
    add(box(0.04, 0.035, 0.03), C.rust, [0.5, 0, -0.62], {f: 0.2, d: 1.1}); add(box(0.034, 0.012, 0.004), C.glass, [0.5, 0.018, -0.604], {f: 0.2, d: 1.1, gl: 1});
    // electrical cabinets by the transformers, with status lights
    for (let k = 0; k < 3; k++) { add(box(0.018, 0.03, 0.012), C.steel, [-0.52, 0, 0.3 + k * 0.025], {f: 0.2, d: 1.1}); add(box(0.004, 0.004, 0.002), k === 1 ? C.red : '#58ff9c', [-0.52, 0.022, 0.3 + k * 0.025 - 0.0065], {f: 0.2, d: 1.1, gl: 1}); }
  }
  return P;
}

function yawFor(dx: number, dz: number): number {
  // arms lie along the local x axis; rotate so they are perpendicular to the line direction (dx, dz)
  const frameX = (yaw: number): [number, number] => [Math.cos(yaw), -Math.sin(yaw)];
  let best = 0, bd = 9;
  for (let k = 0; k < 720; k++) { const y = (k / 720) * TAU, [x, z] = frameX(y), dot = Math.abs(x * dx + z * dz); if (dot < bd) { bd = dot; best = y; } }
  return best;
}

// ---- arcs, glow points -------------------------------------------------------------------------------------------
export function nuclearArcs(): THREE.BufferGeometry {
  const s = new ArcSet();
  const F = frame(YARD.x, YARD.z, 0);
  const tops = (tz: number, k: number): V3 => F([k * 0.03, 0.064 + 0.014 + 5 * 0.0105 + 0.0, tz]);
  s.add(tops(-0.09, 1), tops(0, -1), 7, 0.0022, 1.3, 0.1);
  s.add(tops(0, 1), tops(0.09, -1), 7, 0.0022, 1.1, 0.5);
  s.add(tops(-0.09, 0), F([0.0, 0.14, -0.13]), 6, 0.002, 0.9, 0.9);
  s.add(tops(0.09, 0), F([0.0, 0.14, 0.13]), 6, 0.002, 0.9, 1.3);
  s.add(tops(0, 0), tops(0.09, 1), 5, 0.002, 0.8, 1.7);
  return s.build();
}

export function nuclearGlow(owner: string, rand: () => number, lite: boolean): THREE.BufferGeometry {
  const g = new GlowSet();
  const kq = lite ? 0.4 : 1;
  TOWERS.forEach((T, i) => {
    const top = 0.03 + T.h;
    const n = Math.round(44 * kq);
    for (let k = 0; k < n; k++) g.add(T.x + (rand() - 0.5) * T.r0 * 1.0, top - 0.01, T.z + (rand() - 0.5) * T.r0 * 1.0, k % 3 ? '#e4eae8' : k % 3 === 0 ? '#c9d6d2' : '#bfe8d8',
      0.1 + rand() * 0.06, 2, {phase: rand(), speed: 0.7 + rand() * 0.5, delay: 1.2 + i * 0.15, rise: 0.4 + rand() * 0.3, drift: -0.12 + rand() * 0.22});
    for (let k = 0; k < Math.round(16 * kq); k++) g.add(T.x + (rand() - 0.5) * T.r0 * 2, 0.06, T.z + (rand() - 0.5) * T.r0 * 2, '#cfdad8', 0.07 + rand() * 0.03, 2, {phase: rand(), speed: 0.9, delay: 1.1, rise: 0.12 + rand() * 0.06, drift: 0.02});
    g.add(T.x + T.r0 * 0.4, top + 0.05, T.z, '#ff3b30', 0.1, 1, {phase: i * 0.4, speed: 1.9, delay: 1.0 + i * 0.1});
  });
  for (let k = 0; k < Math.round(10 * kq); k++) g.add(STACK.x, STACK.h + 0.02, STACK.z, '#8e8a84', 0.06, 2, {phase: rand(), speed: 1.0, delay: 1.2, rise: 0.3, drift: 0.07});
  g.add(STACK.x, STACK.h + 0.02, STACK.z, '#ff3b30', 0.08, 1, {phase: 0.3, speed: 1.9, delay: 1.0});
  if (!lite) {
    for (let k = 0; k < 4; k++) for (let m = 0; m < 3; m++) g.add(HALL_A.x - 0.14 + k * 0.14, 0.15, HALL_A.z + 0.026, '#d8dedc', 0.05, 2, {phase: rand(), speed: 1.1, delay: 1.3, rise: 0.12, drift: 0.02});
    // drifting radioactive motes over the craters and cracks
    for (const [cx, cz, cr] of CRATERS) for (let k = 0; k < 8; k++) { const a = rand() * TAU, d = rand() * cr * 0.8; g.add(cx + Math.cos(a) * d, 0.0, cz + Math.sin(a) * d, '#7dffc4', 0.02 + rand() * 0.012, 3, {phase: rand(), speed: 0.8 + rand() * 0.6, delay: 1.5, rise: 0.12 + rand() * 0.14, drift: 0.02 + rand() * 0.03}); }
    // sparks at the transformer yard
    const F = frame(YARD.x, YARD.z, 0);
    for (const tz of [-0.09, 0, 0.09]) for (const k of [-1, 0, 1]) {
      const p = F([k * 0.03, 0.064 + 0.014 + 5 * 0.0105, tz]);
      g.add(p[0], p[1], p[2], '#bfe0ff', 0.05, 1, {phase: rand(), speed: 9 + rand() * 6, delay: 1.2});
    }
    for (let k = 0; k < 14; k++) { const p = F([(rand() - 0.5) * 0.08, 0.12, (rand() - 0.5) * 0.24]); g.add(p[0], p[1], p[2], '#9fd0ff', 0.016, 3, {phase: rand(), speed: 3 + rand() * 3, delay: 1.2, rise: 0.05, drift: 0.02}); }
  } else {
    const F = frame(YARD.x, YARD.z, 0);
    for (const tz of [-0.09, 0.09]) { const p = F([0, 0.064 + 0.014 + 2 * 0.0105 * 2.5, tz]); g.add(p[0], p[1], p[2], '#bfe0ff', 0.05, 1, {phase: rand(), speed: 9, delay: 1.2}); }
  }
  // core halo (seen through the ports) and shimmer
  g.add(0, DOME_Y + 0.1, 0, '#14e08a', 0.4, 0, {delay: 1.5});
  for (let k = 0; k < Math.round(24 * kq); k++) { const a = rand() * TAU, d = 0.03 + rand() * 0.2; g.add(Math.cos(a) * d, DOME_Y + 0.02, Math.sin(a) * d, k % 2 ? '#7dffc4' : '#9afff0', 0.02 + rand() * 0.012, 3, {phase: rand(), speed: 0.7 + rand() * 0.8, delay: 1.7, rise: 0.15 + rand() * 0.1, drift: 0.02 + rand() * 0.03}); }
  g.add(0, DOME_R * SQ + DOME_Y + 0.085, 0, '#ff3b30', 0.1, 1, {phase: 0.1, speed: 1.9, delay: 1.4});
  // owner beacons
  BEACONS.forEach((b) => g.add(b.x, 0.2, b.z, b.k % 2 ? owner : '#ffe3a8', b.k % 2 ? 0.2 : 0.14, b.k % 2 ? 0 : 1, {phase: b.k * 0.17, speed: 2.1, delay: 0.7 + b.k * 0.08}));
  BEACONS.forEach((b) => { if (b.k % 2) return; g.add(b.x, 0.2, b.z, owner, 0.22, 0, {delay: 0.7 + b.k * 0.08}); });
  // status lamps: pylon tops, hall windows, vehicle roofs are emissive geometry; add pylon red blink
  for (const P of [PYLON_A, PYLON_B]) g.add(P.x, 0.5 + 0.012, P.z, '#ff3b30', 0.09, 1, {phase: P.x > 0 ? 0.5 : 0.0, speed: 1.9, delay: 1.2});
  return g.build();
}
