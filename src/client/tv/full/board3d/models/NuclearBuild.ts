// Private builders for NuclearZone.tsx: the shared ground, structures, dome, core and effect geometry/materials.
import * as THREE from 'three';
import {canvasTexture, GlowSet, hexGrid, hexR, mergeParts, type Part} from './NuclearGeo';

const TAU = Math.PI * 2;
/** crater centres and radii in unit space (x, z, r) */
export const CRATERS: Array<[number, number, number]> = [[-0.54, 0.16, 0.17], [0.55, 0.12, 0.15], [0.02, -0.66, 0.13], [-0.18, 0.64, 0.08]];
const DOME_R = 0.36;
const TOWERS: Array<[number, number]> = [[0.56, -0.4], [-0.58, -0.42]];
const TREFOIL = {x: 0.34, z: 0.62, r: 0.13};

function height(x: number, z: number): number {
  let h = 0;
  for (const [cx, cz, r] of CRATERS) {
    const d = Math.hypot(x - cx, z - cz) / r;
    h -= 0.045 * Math.max(0, 1 - d * d) * (r / 0.15);
    h += 0.02 * Math.exp(-Math.pow((d - 1.05) / 0.22, 2));
  }
  // scorched swell between the craters
  h += 0.006 * Math.sin(x * 9) * Math.cos(z * 8);
  const dm = Math.hypot(x, z);
  if (dm < DOME_R + 0.1) h *= Math.max(0, (dm - DOME_R + 0.1) / 0.1);
  // the field stands a little proud of the prism and slopes down to its edge, so crater floors stay visible
  const f = dm / hexR(Math.atan2(z, x)), e = Math.min(1, Math.max(0, (0.99 - f) / 0.16));
  return (h + 0.05) * (e * e * (3 - 2 * e));
}

let cache: ReturnType<typeof make> | null = null;
export function nuclearAssets() { return (cache ??= make()); }

function rnd(seed: number) { let a = seed; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function make() {
  const S = 1024;
  const px = (v: number) => ((v + 1) / 2) * S;
  // ---- colour and emissive maps for the ground ----
  const cracks: Array<Array<[number, number]>> = [];
  { const r = rnd(7);
    for (let i = 0; i < 17; i++) {
      let a = (i / 17) * TAU + r() * 0.3, x = Math.cos(a) * (DOME_R + 0.04), z = Math.sin(a) * (DOME_R + 0.04);
      const pts: Array<[number, number]> = [[x, z]];
      const n = 5 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) { a += (r() - 0.5) * 0.7; const l = 0.05 + r() * 0.07; x += Math.cos(a) * l; z += Math.sin(a) * l; pts.push([x, z]); }
      cracks.push(pts);
    } }
  const colorMap = canvasTexture(S, (g) => {
    g.fillStyle = '#7a6354'; g.fillRect(0, 0, S, S);
    const r = rnd(3);
    for (let i = 0; i < 9000; i++) { const v = 50 + r() * 90; g.fillStyle = `rgba(${v + 18},${v + 8},${v},${0.18 + r() * 0.3})`; g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3); }
    // scorched halo and crater floors
    for (const [cx, cz, cr] of CRATERS) {
      const gr = g.createRadialGradient(px(cx), px(cz), 0, px(cx), px(cz), cr * S * 0.9);
      gr.addColorStop(0, 'rgba(14,10,8,0.95)'); gr.addColorStop(0.7, 'rgba(26,18,14,0.75)'); gr.addColorStop(1, 'rgba(30,22,18,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(px(cx), px(cz), cr * S * 0.95, 0, TAU); g.fill();
    }
    // glassy fused patches (dark teal, bright rim)
    for (let i = 0; i < 14; i++) {
      const a = r() * TAU, d = 0.42 + r() * 0.42, x = px(Math.cos(a) * d), y = px(Math.sin(a) * d), rr = 14 + r() * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(30,86,80,0.85)'); gr.addColorStop(0.8, 'rgba(18,56,54,0.7)'); gr.addColorStop(1, 'rgba(120,200,190,0.35)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr, rr * (0.55 + r() * 0.4), r() * 3, 0, TAU); g.fill();
    }
    // hazard ring round the dome
    const r0 = px(DOME_R + 0.09) - px(0), r1 = px(DOME_R + 0.16) - px(0), c = px(0);
    g.save(); g.beginPath(); g.arc(c, c, r1, 0, TAU); g.arc(c, c, r0, 0, TAU, true); g.clip();
    for (let k = 0; k < 40; k++) { g.fillStyle = k % 2 ? '#f0b81c' : '#16110d'; g.beginPath(); g.moveTo(c, c); g.arc(c, c, r1 + 4, (k / 40) * TAU, ((k + 1) / 40) * TAU); g.fill(); }
    g.restore();
    // trefoil on a yellow disc
    const tx = px(TREFOIL.x), tz = px(TREFOIL.z), tr = (TREFOIL.r / 2) * S * 2 / 2;
    g.fillStyle = '#e9ae17'; g.beginPath(); g.arc(tx, tz, tr, 0, TAU); g.fill();
    g.strokeStyle = '#18120d'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#18120d';
    for (let k = 0; k < 3; k++) { const a0 = (k / 3) * TAU - Math.PI / 2 - 0.52; g.beginPath(); g.moveTo(tx, tz); g.arc(tx, tz, tr * 0.8, a0, a0 + 1.04); g.closePath(); g.fill(); }
    g.fillStyle = '#e9ae17'; g.beginPath(); g.arc(tx, tz, tr * 0.28, 0, TAU); g.fill();
    g.fillStyle = '#18120d'; g.beginPath(); g.arc(tx, tz, tr * 0.17, 0, TAU); g.fill();
    // glowing cracks, dark under the glow
    g.lineCap = 'round';
    for (const pts of cracks) { g.strokeStyle = 'rgba(5,4,3,0.9)'; g.lineWidth = 6; g.beginPath(); pts.forEach(([x, z], i) => i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z))); g.stroke(); }
  });
  const emissiveMap = canvasTexture(S, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const c = px(0), gr = g.createRadialGradient(c, c, 0, c, c, S * 0.46);
    gr.addColorStop(0, 'rgba(40,255,170,0.55)'); gr.addColorStop(0.45, 'rgba(20,160,120,0.25)'); gr.addColorStop(1, 'rgba(0,60,50,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pts of cracks) {
      for (const [w, col, blur] of [[9, 'rgba(30,230,150,0.5)', 14], [3.2, '#aaffd8', 6]] as const) {
        g.strokeStyle = col; g.lineWidth = w; g.shadowColor = '#22ffaa'; g.shadowBlur = blur;
        g.beginPath(); pts.forEach(([x, z], i) => i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z))); g.stroke();
      }
    }
    g.shadowBlur = 0;
    for (const [cx, cz, cr] of CRATERS) { // faint glow pooled in the crater floors
      const q = g.createRadialGradient(px(cx), px(cz), 0, px(cx), px(cz), cr * S * 0.7);
      q.addColorStop(0, 'rgba(20,150,110,0.45)'); q.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = q; g.beginPath(); g.arc(px(cx), px(cz), cr * S * 0.7, 0, TAU); g.fill();
    }
  });
  const ground = hexGrid(16, 66, height);
  const groundMat = new THREE.MeshStandardMaterial({map: colorMap, emissiveMap, emissive: '#ffffff', emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.25});

  // ---- structures: plinth, cooling towers, pipes, tanks, beacon posts ----
  const parts: Part[] = [];
  const cyl = (rt: number, rb: number, h: number, seg = 14) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, h / 2, 0); return g; };
  parts.push({g: cyl(DOME_R + 0.07, DOME_R + 0.09, 0.05, 36), c: '#4d4a46', f: 0.3, d: 0.1});
  parts.push({g: cyl(DOME_R + 0.015, DOME_R + 0.015, 0.06, 36), c: '#25282b', p: [0, 0.05, 0], f: 0.3, d: 0.1});
  const tower = (() => { // hyperboloid cooling tower: LatheGeometry profile
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, y = t * 0.72, w = 0.16 - 0.075 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.8) + 0.03 * t; pts.push(new THREE.Vector2(w, y)); }
    return new THREE.LatheGeometry(pts, 18);
  })();
  TOWERS.forEach(([x, z], i) => {
    parts.push({g: tower, c: '#c2bbae', p: [x, 0, z], s: [1, 1, 1], f: 0.55, d: 0.55 + i * 0.12});
    parts.push({g: cyl(0.14, 0.14, 0.012, 18), c: '#2b2724', p: [x, 0.71, z], f: 0.55, d: 0.55 + i * 0.12});
    parts.push({g: cyl(0.145, 0.15, 0.035, 18), c: '#5a554e', p: [x, 0, z], f: 0.55, d: 0.55 + i * 0.12});
    // a hazard band near the top of each tower
    parts.push({g: cyl(0.118, 0.118, 0.018, 18), c: '#d89c14', p: [x, 0.6, z], f: 0.55, d: 0.55 + i * 0.12});
    // pipe to the dome plinth
    const dx = -x, dz = -z, len = Math.hypot(dx, dz) - 0.14 - DOME_R - 0.05, ang = Math.atan2(dx, dz);
    const mx = x + Math.sin(ang) * (0.14 + len / 2), mz = z + Math.cos(ang) * (0.14 + len / 2);
    const pipe = new THREE.CylinderGeometry(0.018, 0.018, len, 8); pipe.rotateX(Math.PI / 2); // along z
    parts.push({g: pipe, c: '#6c7177', p: [mx, 0.045, mz], r: [0, ang, 0], f: 0.2, d: 0.7 + i * 0.1});
  });
  // tanks and a short stack
  parts.push({g: cyl(0.06, 0.06, 0.07, 14), c: '#8e9aa0', p: [0.28, 0, -0.62], f: 0.2, d: 0.9});
  parts.push({g: cyl(0.05, 0.05, 0.09, 14), c: '#9aa3a8', p: [0.16, 0, -0.7], f: 0.2, d: 0.95});
  parts.push({g: cyl(0.02, 0.026, 0.2, 8), c: '#454a50', p: [-0.2, 0, -0.64], f: 0.3, d: 0.9});
  // beacon posts around the perimeter (one at each vertex of the hex)
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3, rr = 0.84, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    parts.push({g: cyl(0.014, 0.018, 0.12, 6), c: k % 2 ? '#d9a21a' : '#2a2b2e', p: [x, 0, z], f: 0.3, d: 0.4 + k * 0.08});
    parts.push({g: new THREE.SphereGeometry(0.022, 8, 6), c: '#e8e0d0', p: [x, 0.125, z], f: 0.3, d: 0.4 + k * 0.08});
  }
  const structures = mergeParts(parts);

  // ---- dome shell (shader: fresnel + panel lattice + breathing pulse) ----
  const dome = new THREE.SphereGeometry(DOME_R, 36, 14, 0, TAU, 0, Math.PI / 2);
  const domeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    uniforms: {uTime: {value: 0}, uNight: {value: 0}},
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP=position; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=-mv.xyz; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime,uNight; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float tri(float x){ return abs(fract(x)-0.5)*2.; }
      void main(){
        vec3 n=normalize(vN); vec3 v=normalize(vV);
        float fr=pow(1.-abs(dot(n,v)),2.2);
        float az=atan(vP.z,vP.x)*(18./6.28318), el=acos(clamp(vP.y/${DOME_R.toFixed(3)},0.,1.))*(7./1.5708);
        float lat=1.-smoothstep(0.,.07,.5-abs(fract(el)-.5)), lon=1.-smoothstep(0.,.07,.5-abs(fract(az+floor(el)*.5)-.5));
        float grid=max(lat,lon);
        float pulse=.5+.5*sin(uTime*1.15);
        float sweep=(1.-smoothstep(0.,.12,.5-abs(fract(vP.y*1.6-uTime*.25)-.5)))*.25;
        float glow=mix(.55,1.,uNight)*(.65+.35*pulse);
        vec3 col=mix(vec3(.25,.8,.8),vec3(.55,1.,.85),pulse)*(fr*1.3+grid*.9+sweep)+vec3(.05,.45,.3)*.25*glow;
        float al=clamp(.07+fr*.55+grid*.5*glow+sweep*.5,0.,.85);
        gl_FragColor=vec4(col,al);
      }`,
  });

  // ---- core: pulsing emissive sphere + an inner cage ----
  const core = new THREE.IcosahedronGeometry(0.115, 3);
  const coreMat = new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uNight: {value: 0}},
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vL; uniform float uTime; void main(){ vL=position; float p=.5+.5*sin(uTime*1.15); vec3 q=position*(1.+.03*p+.012*sin(position.y*40.+uTime*3.)); vec4 mv=modelViewMatrix*vec4(q,1.); vN=normalize(normalMatrix*normal); vV=-mv.xyz; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime,uNight; varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main(){
        vec3 n=normalize(vN), v=normalize(vV); float fr=pow(1.-abs(dot(n,v)),1.6);
        float p=.5+.5*sin(uTime*1.15);
        float w=.5+.5*sin(vL.x*60.+uTime*2.)*sin(vL.y*55.-uTime*1.7)*sin(vL.z*50.+uTime*2.3);
        vec3 hot=mix(vec3(.05,.9,.45),vec3(.45,1.,.75),p*.5+w*.3);
        vec3 col=hot*(.7+.7*p)*(1.+fr*.6)+vec3(.0,.3,.25)*fr;
        gl_FragColor=vec4(col*mix(.9,1.2,uNight),1.);
      }`,
  });

  // ---- fx: flash pillar + ground shockwave (per-instance material clones; uAge drives it) ----
  const fxG = (() => {
    const disc = new THREE.CircleGeometry(0.98, 48); disc.rotateX(-Math.PI / 2); disc.translate(0, 0.012, 0);
    const pillar = new THREE.CylinderGeometry(0.16, 0.2, 1.4, 20, 1, true); pillar.translate(0, 0.7, 0);
    const kind = (n: number, k: number) => new THREE.Float32BufferAttribute(new Float32Array(n).fill(k), 1);
    disc.setAttribute('aK', kind(disc.attributes.position.count, 0));
    pillar.setAttribute('aK', kind(pillar.attributes.position.count, 1));
    disc.deleteAttribute('uv'); pillar.deleteAttribute('uv'); disc.deleteAttribute('normal'); pillar.deleteAttribute('normal');
    // keep a normal-ish attribute for the pillar's soft edge via position
    const m = mergeGeometries2([disc, pillar]);
    return m;
  })();
  const fxMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {uAge: {value: 0}},
    vertexShader: `attribute float aK; varying float vK; varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vK=aK; vP=position; vN=normalize(normalMatrix*vec3(position.x,0.,position.z)); vec4 mv=modelViewMatrix*vec4(position,1.); vV=-mv.xyz; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uAge; varying float vK; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        float f1=1.-smoothstep(.0,.55,uAge), f2=exp(-pow((uAge-1.45)/.22,2.));
        vec3 col; float a;
        if (vK<.5) {
          float d=length(vP.xz);
          float rr=.98*(1.-pow(1.-clamp((uAge-1.35)/.85,0.,1.),2.)); float ringOn=step(1.35,uAge)*(1.-smoothstep(1.9,2.25,uAge));
          float ring=exp(-pow((d-rr)/.05,2.))*ringOn;
          float rr2=.9*clamp((uAge-.05)/.5,0.,1.); float blast=exp(-pow((d-rr2)/.08,2.))*(1.-smoothstep(.3,.6,uAge))*step(.0,uAge);
          float flash=exp(-d*3.5)*f1*1.2;
          col=vec3(.4,1.,.8)*(ring*1.6+blast*1.3)+vec3(.9,1.,.95)*flash; a=1.;
        } else {
          float e=pow(abs(dot(normalize(vN),normalize(vV))),1.4);
          float up=1.-vP.y/1.4;
          col=mix(vec3(.5,1.,.8),vec3(1.),f1)*e*up*(f1*2.2+f2*1.1); a=1.;
        }
        gl_FragColor=vec4(col,a);
      }`,
  });

  return {ground, groundMat, structures, dome, domeMat, core, coreMat, fx: fxG, fxMat, DOME_R, TOWERS};
}

import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
function mergeGeometries2(l: THREE.BufferGeometry[]) { return mergeGeometries(l, false)!; }

/** Glow points for one tile: vapour above each tower, shimmer over the dome, beacon lights in the owner colour. */
export function nuclearGlow(owner: string, rand: () => number): THREE.BufferGeometry {
  const s = new GlowSet();
  TOWERS.forEach(([x, z], i) => {
    for (let k = 0; k < 14; k++) s.add(x + (rand() - 0.5) * 0.05, 0.72, z + (rand() - 0.5) * 0.05, k % 3 ? '#d7dfdc' : '#bfe8d8', 0.12 + rand() * 0.05, 2, {phase: rand(), speed: 0.8 + rand() * 0.5, delay: 1.0 + i * 0.1, rise: 0.55 + rand() * 0.2, drift: -0.05 + rand() * 0.1});
  });
  // thin vapour leaking from the stack
  for (let k = 0; k < 5; k++) s.add(-0.2, 0.2, -0.64, '#8e8a84', 0.05, 2, {phase: rand(), speed: 1, delay: 1.1, rise: 0.25, drift: 0.05});
  for (let k = 0; k < 26; k++) {
    const a = rand() * TAU, d = 0.05 + rand() * 0.3;
    s.add(Math.cos(a) * d, 0.12, Math.sin(a) * d, k % 2 ? '#7dffc4' : '#9afff0', 0.022 + rand() * 0.016, 3, {phase: rand(), speed: 0.7 + rand() * 0.8, delay: 1.5, rise: 0.35 + rand() * 0.3, drift: 0.02 + rand() * 0.04});
  }
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3, x = Math.cos(a) * 0.84, z = Math.sin(a) * 0.84;
    s.add(x, 0.127, z, k % 2 ? owner : '#ffb23a', 0.14, 1, {phase: (k * 0.17 + rand() * 0.1), speed: 2.1, delay: 0.7 + k * 0.08});
  }
  // a steady green status lamp on each tower rim and a large soft halo around the core
  TOWERS.forEach(([x, z], i) => s.add(x, 0.6, z + 0.12, '#58ff9c', 0.07, 0, {delay: 0.9 + i * 0.1}));
  s.add(0, 0.22, 0, '#14e08a', 1.15, 0, {delay: 1.3});
  return s.build();
}
