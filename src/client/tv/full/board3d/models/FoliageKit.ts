// Shared toolkit for the three living tiles (Greenery, Ecological Zone, Natural Preserve): tree geometries, a wind /
// growth / dew / bioluminescence material for instanced trees, a mossy terrain material, and one general Points
// shader that draws pollen, fireflies, spore bursts, halos, walking animals and birds.
// Nothing here reads the shared clock: the models pass time, age and night in through tickFx().
import * as THREE from 'three';
import {mergeGeometries, mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---- per-hex uniforms (one object shared by every material of one tile) ---------------------------------------
export type Fx = {
  uT: {value: number}; uAge: {value: number}; uNight: {value: number}; uR: {value: number};
  uSway: {value: number}; uPx: {value: number}; uShow: {value: number};
};
export function makeFx(R: number): Fx {
  return {uT: {value: 0}, uAge: {value: 99}, uNight: {value: 0}, uR: {value: R}, uSway: {value: 1}, uPx: {value: 1000}, uShow: {value: 1}};
}
/** Once per frame, no allocation. `age` may be Infinity (finished / reduced motion). */
export function tickFx(fx: Fx, age: number, t: number, night: number, reduced: boolean, px: number, showAt = 1.1) {
  fx.uT.value = t; fx.uNight.value = night; fx.uSway.value = reduced ? 0 : 1; fx.uPx.value = px;
  const a = reduced || age > 99 ? 99 : age;
  fx.uAge.value = a;
  fx.uShow.value = a >= 99 ? 1 : Math.max(0, Math.min(1, (a - showAt) / 0.5));
}

export const NOISE = /* glsl */`
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x), mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),f.x), f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+vec2(7.1,3.7); a*=.5; } return s; }
float hexD(vec2 p){ p=abs(p); return max(p.x, dot(p, vec2(.5,.866025))); }
float easeBack(float x){ float c1=2.4, c3=c1+1.; float m=x-1.; return 1.+c3*m*m*m+c1*m*m; }
`;

function fxUniforms(sh: {uniforms: Record<string, THREE.IUniform>}, fx: Fx) {
  sh.uniforms.uT = fx.uT; sh.uniforms.uAge = fx.uAge; sh.uniforms.uNight = fx.uNight; sh.uniforms.uR = fx.uR; sh.uniforms.uSway = fx.uSway;
}

// ---- small deterministic hash for vertex jitter ----------------------------------------------------------------
function hv(x: number, y: number, z: number): number {
  let h = Math.imul(Math.round(x * 997) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(Math.round(y * 991) + 17, 0xc2b2ae35) ^ Math.imul(Math.round(z * 983) + 71, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

/** Strip, weld and smooth-shade one part so parts can merge with matching attributes. */
function part(g: THREE.BufferGeometry, jitter = 0, centre?: THREE.Vector3): THREE.BufferGeometry {
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  let m = g.index ? g : g.clone();
  m = mergeVertices(m, 1e-4);
  if (jitter > 0) {
    const p = m.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const j = 1 + (hv(x, y, z) - 0.5) * 2 * jitter;
      if (centre) p.setXYZ(i, centre.x + (x - centre.x) * j, centre.y + (y - centre.y) * j, centre.z + (z - centre.z) * j);
      else p.setXYZ(i, x * j, y, z * j);
    }
  }
  m.computeVertexNormals();
  return m;
}
function finish(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  g.computeBoundingSphere();
  return g;
}

let _con: THREE.BufferGeometry | null = null, _broad: THREE.BufferGeometry | null = null;
/** A conifer of unit height: a trunk and five drooping tiers (50 triangles). */
export function coniferGeo(): THREE.BufferGeometry {
  if (_con) return _con;
  const ps: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.03, 0.05, 0.22, 5, 1, true); trunk.translate(0, 0.11, 0);
  ps.push(part(trunk));
  for (let i = 0; i < 5; i++) {
    const base = 0.1 + i * 0.165, h = 0.36 - i * 0.04, r = 0.34 * (1 - i * 0.175);
    const c = new THREE.ConeGeometry(r, h, 8, 1, true); c.translate(0, base + h / 2, 0);
    const p = part(c, 0.09);
    // droop the skirt
    const a = p.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < a.count; k++) if (a.getY(k) < base + 0.02) a.setY(k, a.getY(k) - 0.025);
    ps.push(p);
  }
  return (_con = finish(ps));
}
/** A broadleaf of unit height: trunk plus three lumpy crown blobs (190 triangles). Squashed, it is also a shrub. */
export function broadGeo(): THREE.BufferGeometry {
  if (_broad) return _broad;
  const ps: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.065, 0.5, 5, 1, true); trunk.translate(0, 0.25, 0);
  ps.push(part(trunk));
  const blob = (x: number, y: number, z: number, r: number, d: number, sy = 0.85) => {
    const g = new THREE.IcosahedronGeometry(r, d); g.scale(1, sy, 1); g.translate(x, y, z);
    ps.push(part(g, 0.14, new THREE.Vector3(x, y, z)));
  };
  blob(0, 0.64, 0, 0.3, 1);
  blob(0.17, 0.52, 0.09, 0.21, 1);
  blob(-0.14, 0.76, -0.1, 0.2, 0);
  return (_broad = finish(ps));
}

// ---- planting ------------------------------------------------------------------------------------------------------
export type Item = {x: number; z: number; h: number; w: number; c: THREE.Color};
export type Spot = {x: number; z: number; r: number};
export const inHex = (x: number, z: number, R: number, k: number) => {
  const ax = Math.abs(x), az = Math.abs(z), lim = R * 0.866 * k;
  return ax <= lim && ax * 0.5 + az * 0.866 <= lim;
};
export type ForestCfg = {
  n: number; conFrac: number; shrubFrac?: number; keep?: Spot[]; spread?: number; tall?: number; gap?: number;
  /** 0 engineered green, 1 wild old growth (darker, more varied) */
  wild?: number; hueShift?: number; accents?: number; /** conifer width multiplier */ slim?: number; /** triangle budget for the trees (default 4400) */ tris?: number;
};
/** Scatter trees (dart throwing, tallest toward the middle) and tint each one. */
export function plant(rnd: () => number, R: number, cfg: ForestCfg): {con: Item[]; broad: Item[]} {
  const {n, conFrac, shrubFrac = 0.22, keep = [], spread = 0.9, tall = 1, gap = 0.1, wild = 0, hueShift = 0, accents = 0.1, slim = 1, tris = 4400} = cfg;
  let used = 0;
  const pts: Array<{x: number; z: number}> = [];
  for (let k = 0; pts.length < n && k < n * 60; k++) {
    const x = (rnd() * 2 - 1) * R, z = (rnd() * 2 - 1) * R;
    if (!inHex(x, z, R, spread)) continue;
    if (keep.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) continue;
    const g = R * gap * (k < n * 30 ? 1 : 0.55);
    if (pts.every((p) => Math.hypot(p.x - x, p.z - z) > g)) pts.push({x, z});
  }
  const con: Item[] = [], broad: Item[] = [];
  const col = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h + hueShift) % 1 + 1) % 1, s, l);
  for (const p of pts) {
    const d = Math.hypot(p.x, p.z) / R;
    const edge = 1.12 - d * 0.42;
    let isCon = rnd() < conFrac;
    if (!isCon && used + 190 > tris) isCon = true;
    if (used + (isCon ? 50 : 190) > tris) break;
    used += isCon ? 50 : 190;
    if (isCon) {
      const h = R * tall * (0.5 + rnd() * (0.55 + wild * 0.35)) * edge;
      con.push({x: p.x, z: p.z, h, w: h * slim * (0.78 + rnd() * 0.5), c: col(0.36 + rnd() * 0.1, 0.4 + rnd() * 0.25, 0.14 + rnd() * 0.1 + wild * 0.01)});
    } else if (rnd() < shrubFrac) {
      const h = R * (0.13 + rnd() * 0.1) * tall;
      const hue = rnd() < 0.3 ? 0.12 + rnd() * 0.05 : 0.22 + rnd() * 0.1;
      broad.push({x: p.x, z: p.z, h, w: h * (2.1 + rnd() * 0.9), c: col(hue, 0.4 + rnd() * 0.3, 0.2 + rnd() * 0.12)});
    } else {
      const h = R * tall * (0.36 + rnd() * (0.38 + wild * 0.2)) * edge;
      let hue = 0.22 + rnd() * 0.12, s = 0.4 + rnd() * 0.3, l = 0.2 + rnd() * 0.16;
      const a = rnd();
      if (a < accents * 0.5) { hue = 0.03 + rnd() * 0.05; s = 0.6; l = 0.3; }         // rust-red leaves
      else if (a < accents) { hue = 0.47 + rnd() * 0.05; s = 0.5; l = 0.24; }          // teal-leaved Martian cultivar
      broad.push({x: p.x, z: p.z, h, w: h * (0.85 + rnd() * 0.45), c: col(hue, s, l)});
    }
  }
  return {con, broad};
}
export const triCountOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

// ---- the tree material: wind, spring-up growth, dew, bioluminescent tips -------------------------------------------
export function foliageMaterial(fx: Fx, tip: THREE.ColorRepresentation = '#47ffc4', flutter = 1, glow: THREE.ColorRepresentation = '#5dff7a'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.82, metalness: 0});
  const tipC = new THREE.Color(tip), glowC = new THREE.Color(glow);
  m.onBeforeCompile = (sh) => {
    fxUniforms(sh, fx);
    sh.uniforms.uTip = {value: tipC}; sh.uniforms.uGlow = {value: glowC}; sh.uniforms.uFlutter = {value: flutter};
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uAge, uNight, uR, uSway, uFlutter;
        varying float vH, vPh, vGlow; varying vec3 vL;
        ${NOISE}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vec3 iO = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = hash21(iO.xz*37.0 + 3.1);
        float dd = length(iO.xz)/uR;
        float gx = clamp((uAge - (0.14 + dd*0.85 + ph*0.12))/0.55, 0., 1.);
        float gk = easeBack(gx);
        float kw = gk > 1. ? 1. + (gk-1.)*.3 : gk;
        transformed.y *= max(gk, 0.);
        transformed.xz *= max(kw, 0.);
        float hh = clamp(position.y, 0., 1.);
        float sw = uSway*hh*hh;
        float gust = sin(uT*1.05 + iO.x*5.0 + iO.z*3.0) + .5*sin(uT*2.3 + iO.x*11.0 - iO.z*7.0 + ph*6.28);
        transformed.x += gust*0.032*sw;
        transformed.z += cos(uT*1.6 + ph*6.28 + iO.x*4.)*0.02*sw;
        transformed += vec3(sin(position.x*31.+uT*4.6+ph*9.), cos(position.z*27.+uT*4.1), sin(position.y*29.+uT*5.2))*0.011*uSway*uFlutter*hh;
        float rr = (uAge - 0.1)*1.15;
        float ring = exp(-pow((dd-rr)*5., 2.))*(1.-smoothstep(1.2,1.8,uAge));
        vGlow = (sin(gx*3.14159)*step(gx,.999)*step(.001,gx))*.8 + ring*.9;
        vH = hh; vPh = ph; vL = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uNight; uniform vec3 uTip, uGlow;
        varying float vH, vPh, vGlow; varying vec3 vL;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(.42, 1.2, vH*.5 + vH*vH*.5);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 cl = floor(vL*vec3(46.,40.,46.)); float hc = hash21(cl.xz + cl.y*17.3 + vPh*91.);
        float blink = .5 + .5*sin(uT*(1.5+hc*2.) + hc*80.);
        vec3 fc = fract(vL*vec3(46.,40.,46.)) - .5; float rnd2 = smoothstep(.5,.12,length(fc));
        float dew = step(.972, hc) * rnd2 * pow(blink, 3.) * (1. - uNight) * smoothstep(.2,.7,vH);
        float hb = hash21(cl.xz*1.7 + cl.y*9.1 + 5.);
        float bio = (step(.982, hb) * rnd2 * (.3 + .7*pow(.5+.5*sin(uT*1.2+hb*70.), 2.)) * 1.6 + .2*smoothstep(.55,1.,vH)*(.6+.4*sin(uT*.8+vPh*20.))) * uNight;
        totalEmissiveRadiance += diffuseColor.rgb*.12*(.4+vH) + vec3(1.,.97,.82)*dew*1.6 + uTip*bio*1.2 + uGlow*vGlow*.5*(.3+vH);`);
  };
  m.customProgramCacheKey = () => 'fol1';
  return m;
}

/** An InstancedMesh with one fixed matrix and colour per tree (all motion happens in the shader). */
export function treeMesh(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[]): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const o = new THREE.Object3D();
  items.forEach((t, i) => {
    o.position.set(t.x, 0, t.z); o.scale.set(t.w, t.h, t.w); o.rotation.set(0, 0, 0); o.updateMatrix();
    m.setMatrixAt(i, o.matrix); m.setColorAt(i, t.c);
  });
  m.count = items.length;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.frustumCulled = false;
  return m;
}

// ---- terrain: mossy hex ground, terrace stone, rocks --------------------------------------------------------------
export type TerrainOpts = {
  c1?: THREE.ColorRepresentation; c2?: THREE.ColorRepresentation; c3?: THREE.ColorRepresentation;
  /** colour comes from noise between c1..c3 (ground) rather than vertex colour (terraces, rocks) */
  mossy?: boolean; mound?: number; spread?: boolean; rise?: boolean; riseDelay?: number;
  owner?: THREE.ColorRepresentation; rim?: number; bio?: THREE.ColorRepresentation; flowers?: [THREE.ColorRepresentation, THREE.ColorRepresentation];
  seed?: number; roughness?: number; ripple?: boolean; /** where the hex edge sits in hexD units (default .866) */ rimAt?: number; /** soft owner-coloured glow pooled around the middle of the tile */ glow?: number;
};
export function terrainMaterial(fx: Fx, o: TerrainOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: o.roughness ?? 0.95, metalness: 0, vertexColors: true});
  const C = (c: THREE.ColorRepresentation | undefined, d: string) => new THREE.Color(c ?? d);
  const c1 = C(o.c1, '#1d4a1f'), c2 = C(o.c2, '#4f8a2c'), c3 = C(o.c3, '#7aa83a'), own = C(o.owner, '#ffffff'), bio = C(o.bio, '#35ffb4');
  const f1 = C(o.flowers?.[0], '#ffe27a'), f2 = C(o.flowers?.[1], '#ff9ec0');
  const flags = [o.mossy ? 'M' : '', o.mound ? 'H' : '', o.spread ? 'S' : '', o.rise ? 'R' : '', o.flowers ? 'F' : '', o.ripple ? 'P' : '', o.rim ? 'O' : '', o.glow ? 'G' : ''].join('');
  m.onBeforeCompile = (sh) => {
    fxUniforms(sh, fx);
    Object.assign(sh.uniforms, {uC1: {value: c1}, uC2: {value: c2}, uC3: {value: c3}, uOwner: {value: own}, uRim: {value: o.rim ?? 0}, uBio: {value: bio},
      uF1: {value: f1}, uF2: {value: f2}, uSeed: {value: o.seed ?? 0}, uMound: {value: o.mound ?? 0}, uRiseD: {value: o.riseDelay ?? 0}, uRimAt: {value: o.rimAt ?? 0.866}, uGlow: {value: o.glow ?? 0}});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uAge, uNight, uR, uSeed, uMound, uRiseD;
        varying vec2 vP; varying float vY;
        ${NOISE}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vP = position.xz; vY = position.y;
        ${o.mound ? 'transformed.y += (.004*uR + max(0., fbm(position.xz/uR*4.+uSeed) - .3) * uMound * uR) * smoothstep(.87,.7,hexD(position.xz/uR));' : ''}
        ${o.spread ? 'float sp = clamp(uAge/.8,0.,1.); sp = 1.-pow(1.-sp,3.); transformed.xz *= sp;' : ''}
        ${o.rise ? `float rz = clamp((uAge - uRiseD - position.y/uR*.35)/.7, 0., 1.); transformed.y *= max(easeBack(rz), 0.);` : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uAge, uNight, uR, uSeed, uRim, uRimAt, uGlow; uniform vec3 uC1, uC2, uC3, uOwner, uBio, uF1, uF2;
        varying vec2 vP; varying float vY;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q = vP/uR;
        float n1 = fbm(q*4.5+uSeed), n2 = fbm(q*16.+uSeed*2.);
        ${o.mossy
          ? `vec3 mc = mix(uC1, uC2, smoothstep(.25,.75,n1)); mc = mix(mc, uC3, smoothstep(.55,.85,n2)*.7); diffuseColor.rgb = mc * vColor.rgb;`
          : `diffuseColor.rgb *= .68 + .6*n2;`}
        ${o.flowers ? `{ vec2 cf = fract(q*52.)-.5; float fh = hash21(floor(q*52.)+uSeed); float fl = step(.968, fh)*smoothstep(.3,.2,length(cf));
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(uF1, uF2, step(.5, fract(fh*37.))), fl); }` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 cb = fract(q*34.)-.5; float bf = step(.962, hash21(floor(q*34.)+3.)) * smoothstep(.34,.1,length(cb)) * (.5 + .5*sin(uT*1.4 + hash21(floor(q*34.))*40.));
        totalEmissiveRadiance += uBio*bf*uNight*.85*smoothstep(.2,.6,n2);
        float dw = step(.988, hash21(floor(q*70.) + floor(uT*2.)*.37)) * smoothstep(.4,.1,length(fract(q*70.)-.5));
        totalEmissiveRadiance += vec3(1.,.97,.85)*dw*(1.-uNight)*.55;
        ${o.rim ? `{ float hd = hexD(q); float rim = smoothstep(uRimAt-.12,uRimAt-.02,hd)*(1.-smoothstep(uRimAt-.01,uRimAt,hd));
          totalEmissiveRadiance += uOwner*rim*uRim*(.5 + 1.0*uNight)*(.85+.15*sin(uT*2.1)); }` : ''}
        ${o.glow ? `totalEmissiveRadiance += uOwner*uGlow*exp(-pow(length(q)*3.2, 2.))*(.3 + .9*uNight);` : ''}
        ${o.ripple ? `{ float rr = (uAge-.1); float rg = exp(-pow((length(q)-rr)*8.,2.))*(1.-smoothstep(1.,1.7,uAge));
          totalEmissiveRadiance += vec3(.4,1.,.5)*rg*.5; }` : ''}`);
  };
  m.customProgramCacheKey = () => 'ter1' + flags;
  return m;
}

/** A pointy-top hex (circumradius R, vertices on ±z) as a finely divided fan with a colour attribute. */
export function hexGround(R: number, N = 6, rgb: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const cor = (i: number) => [Math.sin(i * Math.PI / 3) * R, Math.cos(i * Math.PI / 3) * R];
  for (let s = 0; s < 6; s++) {
    const A = cor(s), B = cor(s + 1), base = pos.length / 3, id = new Map<string, number>();
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N - i; j++) {
      id.set(i + ',' + j, pos.length / 3);
      pos.push((A[0] * i + B[0] * j) / N, 0, (A[1] * i + B[1] * j) / N);
    }
    void base;
    const get = (i: number, j: number) => id.get(i + ',' + j)!;
    for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
      const a = get(i, j), b = get(i + 1, j), c = get(i, j + 1);
      const tri = (p: number, q: number, r: number) => {
        const ux = pos[q * 3] - pos[p * 3], uz = pos[q * 3 + 2] - pos[p * 3 + 2], vx = pos[r * 3] - pos[p * 3], vz = pos[r * 3 + 2] - pos[p * 3 + 2];
        // cross.y = uz*vx - ux*vz must be positive for an up-facing triangle
        if (uz * vx - ux * vz > 0) idx.push(p, q, r); else idx.push(p, r, q);
      };
      tri(a, b, c);
      if (j < N - i - 1) tri(b, get(i + 1, j + 1), c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = pos.length / 3, nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { nor[i * 3 + 1] = 1; col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Give a geometry a flat colour attribute (for terrain material on terraces and rocks). */
export function tint(g: THREE.BufferGeometry, c: THREE.ColorRepresentation, perVertex?: (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const base = new THREE.Color(c), n = g.getAttribute('position').count, a = new Float32Array(n * 3), tmp = new THREE.Color();
  const p = g.getAttribute('position'), nr = g.getAttribute('normal');
  for (let i = 0; i < n; i++) {
    tmp.copy(base);
    if (perVertex) perVertex(p.getX(i), p.getY(i), p.getZ(i), nr?.getX(i) ?? 0, nr?.getY(i) ?? 1, nr?.getZ(i) ?? 0, tmp);
    a[i * 3] = tmp.r; a[i * 3 + 1] = tmp.g; a[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// ---- the points shader: pollen, fireflies, spores, halos, walkers, birds -------------------------------------------
export const PT = {POLLEN: 0, FIREFLY: 1, SPORE: 2, HALO: 3, WALKER: 4, BIRD: 5} as const;
export type PtSpec = {
  kind: number; n: number; /** diameter in world units */ size: number; colors: THREE.ColorRepresentation[];
  pos?: (i: number) => [number, number, number]; seed?: (i: number) => [number, number, number]; alpha?: number;
};
export function pointsMesh(fx: Fx, rnd: () => number, specs: PtSpec[]): THREE.Points {
  const total = specs.reduce((s, p) => s + p.n, 0);
  const pos = new Float32Array(total * 3), seed = new Float32Array(total * 4), col = new Float32Array(total * 3), size = new Float32Array(total), alpha = new Float32Array(total);
  let k = 0;
  const c = new THREE.Color();
  for (const s of specs) for (let i = 0; i < s.n; i++, k++) {
    const p = s.pos?.(i) ?? [0, 0, 0], sd = s.seed?.(i) ?? [rnd(), rnd(), rnd()];
    pos.set(p, k * 3); seed.set([sd[0], sd[1], sd[2], s.kind], k * 4);
    c.set(s.colors[Math.floor(rnd() * s.colors.length)]); col.set([c.r, c.g, c.b], k * 3);
    size[k] = s.size * (0.7 + rnd() * 0.6); alpha[k] = s.alpha ?? 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), fx.uR.value * 2.5);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uR: fx.uR, uPx: fx.uPx, uShow: fx.uShow},
    vertexShader: /* glsl */`
      attribute vec4 aSeed; attribute vec3 aCol; attribute float aSize; attribute float aAlpha;
      uniform float uT, uAge, uNight, uR, uPx, uShow;
      varying vec3 vC; varying float vA;
      void main(){
        float k = aSeed.w; vec4 sd = aSeed; vec3 p = position; float a = aAlpha; float show = uShow;
        if (k < .5) {
          float ang = sd.x*6.2832 + uT*.04*(sd.z-.5), rr = sqrt(sd.y)*.78*uR, lf = fract(sd.z + uT*(.018+.02*sd.x));
          p = vec3(sin(ang)*rr, (.04+lf*.6)*uR, cos(ang)*rr);
          p.xz += vec2(sin(uT*.5+sd.z*20.), cos(uT*.4+sd.x*20.))*.05*uR;
          a *= (1.-uNight*.9) * sin(3.14159*lf) * .8;
        } else if (k < 1.5) {
          float ang = sd.x*6.2832 + sin(uT*.13+sd.z*9.)*.6, rr = sqrt(sd.y)*.8*uR;
          p = vec3(sin(ang)*rr, (.05 + .3*(.5+.5*sin(uT*.31+sd.x*13.)))*uR, cos(ang)*rr);
          p.xz += vec2(sin(uT*.7+sd.z*20.), cos(uT*.6+sd.x*20.))*.06*uR;
          a *= uNight * pow(.5+.5*sin(uT*(.9+sd.x*1.4)+sd.y*40.), 3.);
        } else if (k < 2.5) {
          float life = clamp((uAge - .05 - sd.z*.3)/1.3, 0., 1.), e = 1.-pow(1.-life, 2.);
          float ang = sd.x*6.2832, rr = e*(.25+.75*sd.y)*.8*uR;
          p = vec3(sin(ang)*rr, uR*.04 + sin(life*3.14159)*uR*(.35+.6*sd.y), cos(ang)*rr);
          a *= sin(3.14159*life) * (uAge < 20. ? 1. : 0.); show = 1.;
        } else if (k < 3.5) {
          a *= mix(sd.z, 1., uNight) * (.82 + .18*sin(uT*1.7 + sd.x*30.));
        } else if (k < 4.5) {
          float sp = (.1 + .1*sd.y) * (sd.z > .5 ? 1. : -1.), an = sd.x*6.2832 + uT*sp, rad = (.18 + .5*sd.y)*uR;
          p = position + vec3(cos(an)*rad, abs(sin(uT*3.+sd.x*20.))*.012*uR, sin(an)*rad*.8);
          a *= (.5 + .5*uNight) * (.85 + .15*sin(uT*2.3 + sd.y*50.));
        } else {
          float an = sd.x*6.2832 + uT*(.22+.2*sd.y)*(sd.z > .5 ? 1. : -1.), rad = (.3 + .35*sd.y)*uR;
          p = position + vec3(cos(an)*rad, sin(an*2.+sd.x*9.)*.05*uR, sin(an)*rad);
          a *= .8 * (1. - uNight*.55) * (.7 + .3*sin(uT*9.+sd.y*50.));
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(aSize * .5 * uPx * projectionMatrix[1][1] / max(-mv.z, .01), 1.5);
        vC = aCol; vA = a * show;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA;
      void main(){
        float d = length(gl_PointCoord - .5)*2.; float core = smoothstep(1., 0., d);
        float a = core*core + pow(core, 7.)*1.3;
        gl_FragColor = vec4(vC, a*vA);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false; pts.renderOrder = 6;
  return pts;
}

export function disposeAll(...xs: Array<{dispose?: () => void} | null | undefined>) { xs.forEach((x) => x?.dispose?.()); }
