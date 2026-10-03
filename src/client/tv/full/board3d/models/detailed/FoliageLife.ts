// Moving life and atmosphere for the Detailed living tiles: birds and butterflies (instanced, flown entirely in the
// vertex shader), ground mist and light shafts, a grazing herd with walking legs, a waterfall sheet, the ranger beacon,
// and the glass dome. All of it reads the shared per-tile Fx uniforms; nothing here allocates per frame.
import * as THREE from 'three';
import {NOISE, type Fx} from '../FoliageKit';

// ---- birds and butterflies --------------------------------------------------------------------------------------
let _wing: THREE.BufferGeometry | null = null;
/** a creature of wingspan 1 lying along z: body, two two-triangle wings; aW = signed span fraction (-1 .. 1) and a row (0 body .. 1 tip) */
function wingGeo(): THREE.BufferGeometry {
  if (_wing) return _wing;
  const pos: number[] = [], w: number[] = [], t: number[] = [];
  const v = (x: number, y: number, z: number, sp: number, row: number, tone: number) => { pos.push(x, y, z); w.push(sp, row, tone); t.push(0); };
  // body (a thin kite)
  v(0, 0, 0.32, 0, 0, 0.2); v(-0.025, 0, -0.1, 0, 0, 0.1); v(0.025, 0, -0.1, 0, 0, 0.1);
  v(0, 0.02, 0.0, 0, 0, 0.25); v(0.025, 0, -0.1, 0, 0, 0.1); v(-0.025, 0, -0.1, 0, 0, 0.1);
  for (const s of [-1, 1]) {
    // wing: root, leading tip, trailing tip, rear
    v(0, 0, 0.14, 0, 0, 0.5); v(s * 0.5, 0, 0.08, s, 1, 1.0); v(0, 0, -0.1, 0, 0, 0.5);
    v(0, 0, -0.1, 0, 0, 0.5); v(s * 0.5, 0, 0.08, s, 1, 1.0); v(s * 0.34, 0, -0.22, s * 0.8, 1, 0.8);
    v(0, 0, 0.14, 0, 0, 0.5); v(0, 0, -0.1, 0, 0, 0.5); v(s * 0.5, 0, 0.08, s, 1, 1.0);
    v(0, 0, -0.1, 0, 0, 0.5); v(s * 0.34, 0, -0.22, s * 0.8, 1, 0.8); v(s * 0.5, 0, 0.08, s, 1, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(w, 3));
  return (_wing = g);
}

export type CritterCfg = {birds: number; butterflies: number; R: number; centre?: [number, number]; birdHeight?: number; spread?: number; hideAt?: number};
export function critters(fx: Fx, rnd: () => number, cfg: CritterCfg): THREE.Mesh {
  const n = cfg.birds + cfg.butterflies;
  const g = wingGeo().clone();
  const seed = new Float32Array(n * 4), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  const bc = ['#ffffff', '#f4f4ee', '#e0e8f0', '#fff8ee'], fc = ['#ffd33a', '#ff8a3a', '#ff6fb0', '#7ad4ff', '#ffffff', '#c78aff'];
  for (let i = 0; i < n; i++) {
    const bird = i < cfg.birds;
    seed.set([rnd(), rnd(), rnd(), bird ? 0 : 1], i * 4);
    c.set((bird ? bc : fc)[Math.floor(rnd() * (bird ? bc : fc).length)]); col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), cfg.R * 3);
  const cen = cfg.centre ?? [0, 0];
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uR: fx.uR, uSway: fx.uSway, uBH: {value: cfg.birdHeight ?? 1}, uSpread: {value: cfg.spread ?? 0.8}, uCen: {value: new THREE.Vector2(...cen)}, uHide: {value: cfg.hideAt ?? 1.8}},
    vertexShader: `${NOISE}
      attribute vec3 aW; attribute vec4 aSeed; attribute vec3 aCol;
      uniform float uT, uAge, uNight, uR, uSway, uBH, uSpread, uHide; uniform vec2 uCen;
      varying vec3 vC; varying vec3 vW; varying float vLit;
      void main(){
        float bird = 1. - aSeed.w;
        float t = uT;
        vec3 ctr; vec3 fwd; float flap; float size; float bank = 0.;
        if (bird > .5) {
          float sp = (.16 + .1*aSeed.y)*(aSeed.z > .5 ? 1. : -1.);
          float a = aSeed.x*6.2832 + t*sp;
          float rr = (.3 + .45*aSeed.y)*uR*uSpread;
          ctr = vec3(uCen.x + cos(a)*rr, (.7 + .55*aSeed.z)*uR*uBH + sin(t*.7 + aSeed.x*20.)*.04*uR, uCen.y + sin(a)*rr*.85);
          vec3 d = vec3(-sin(a), 0., cos(a)*.85)*sign(sp);
          fwd = normalize(d + vec3(0., cos(t*.7 + aSeed.x*20.)*.05, 0.));
          flap = sin(t*(8. + aSeed.y*3.) + aSeed.x*30.)*(.45 + .55*sin(t*.45 + aSeed.y*20.))*.6 + .15;
          size = .07*uR; bank = sign(sp)*.35;
        } else {
          float k = aSeed.x*40.;
          vec3 hb = vec3(uCen.x + (aSeed.x - .5)*1.3*uR*uSpread, 0.09*uR, uCen.y + (aSeed.y - .5)*1.3*uR*uSpread);
          ctr = hb + vec3(sin(t*.55 + k)*.16*uR + sin(t*1.7 + k*2.)*.03*uR, .06*uR + (.5 + .5*sin(t*1.1 + k))*.09*uR, cos(t*.47 + k*1.3)*.16*uR + cos(t*1.9 + k)*.03*uR);
          vec3 vel = vec3(cos(t*.55 + k)*.16*.55 , cos(t*1.1 + k)*.05, -sin(t*.47 + k*1.3)*.16*.47);
          fwd = normalize(vel + vec3(1e-4));
          flap = sin(t*(19. + aSeed.y*6.) + k)*1.0;
          size = .036*uR;
        }
        // arrival: wildlife flies in from outside as the build-in ends, and shrinks at night
        float arrive = clamp((uAge - uHide - aSeed.z*.6 - .5)/1.1, 0., 1.);
        float vis = (uAge > 98. ? 1. : smoothstep(0., .2, arrive)) * (bird > .5 ? 1. - smoothstep(.55, .85, uNight) : 1. - smoothstep(.25, .6, uNight));
        float far = uAge > 98. ? 0. : (1. - arrive);
        ctr.xz *= 1. + far*2.6; ctr.y += far*uR*.5;
        vec3 up = vec3(0., 1., 0.);
        vec3 r = normalize(cross(up, fwd)); vec3 u2 = cross(fwd, r);
        // bank into the turn
        vec3 rb = r*cos(bank) + u2*sin(bank); vec3 ub = u2*cos(bank) - r*sin(bank);
        vec3 p = position;
        float span = aW.x;
        float lift = flap*abs(span)*.55*uSway*mix(1., 1.8, aSeed.w);
        float ang = lift*sign(span);
        // fold the wing about the body axis
        float cx = p.x*cos(lift) , cy = abs(p.x)*sin(lift);
        vec3 wp = rb*cx + ub*cy + fwd*p.z;
        // body kite sits on the axis
        wp = aW.y < .5 && abs(p.x) < .03 ? rb*p.x + ub*p.y + fwd*p.z : wp;
        vec3 world = ctr + wp*size*(.001 + vis);
        vC = aCol; vW = aW; vLit = p.y*0. + aW.z;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(world, 1.);
      }`,
    fragmentShader: `
      uniform float uNight;
      varying vec3 vC; varying vec3 vW; varying float vLit;
      void main(){
        vec3 c = vC*(.78 + .22*vLit);
        float edge = smoothstep(.55, 1., abs(vW.x));
        c = mix(c, c*.4, edge*.55*(1. - vW.z*0.));
        c *= .6 + .4*(1. - uNight*.75);
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  const m = new THREE.InstancedMesh(g, mat, n);
  m.frustumCulled = false; m.renderOrder = 4;
  return m;
}

// ---- mist wisps and light shafts ------------------------------------------------------------------------------
export type MistCfg = {R: number; wisps: number; shafts: number; seed: () => number; height?: number; at?: [number, number]; rad?: number};
export function mistMesh(fx: Fx, cfg: MistCfg): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], sd: number[] = [], ty: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], type: number, s: number) => {
    const pts = [a, b, c, a, c, d], uvs = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    pts.forEach((p, i) => { pos.push(p[0], p[1], p[2]); uv.push(uvs[i][0], uvs[i][1]); sd.push(s); ty.push(type); });
  };
  const R = cfg.R, r = cfg.seed;
  for (let i = 0; i < cfg.wisps; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * (cfg.rad ?? 0.55) * R, cx = Math.cos(a) * d + (cfg.at ? cfg.at[0] * R : 0), cz = Math.sin(a) * d + (cfg.at ? cfg.at[1] * R : 0), y = R * (0.025 + r() * 0.12) * (cfg.height ?? 1);
    const s = R * (0.34 + r() * 0.3), rot = r() * 6.28, cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (u: number, v: number) => [cx + (u * cr - v * sr) * s, y, cz + (u * sr + v * cr) * s * 0.55];
    quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), 0, r());
  }
  for (let i = 0; i < cfg.shafts; i++) {
    // a slanted band of light falling from the canopy to the ground, along the sun direction
    const a = r() * 6.28, d = (0.15 + r() * 0.4) * R, cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const top = [cx - R * 0.28, R * 1.05, cz - R * 0.14], bot = [cx + R * 0.12, 0.005 * R, cz + R * 0.06];
    const w = R * (0.06 + r() * 0.07), nx = 0.5, nz = -1.0, nl = Math.hypot(nx, nz), px = nx / nl * w, pz = nz / nl * w;
    quad([top[0] - px, top[1], top[2] - pz], [top[0] + px, top[1], top[2] + pz], [bot[0] + px * 1.6, bot[1], bot[2] + pz * 1.6], [bot[0] - px * 1.6, bot[1], bot[2] - pz * 1.6], 1, r());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(sd, 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(ty, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, R * 0.5, 0), R * 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uR: fx.uR},
    vertexShader: `attribute vec2 aUv; attribute float aS, aT; uniform float uT, uR; varying vec2 vUv; varying float vS, vT; varying vec2 vXZ;
      void main(){
        vUv = aUv; vS = aS; vT = aT;
        vec3 p = position;
        if (aT < .5) { p.x += sin(uT*.07 + aS*30.)*.09*uR; p.z += cos(uT*.06 + aS*20.)*.06*uR; }
        vXZ = p.xz;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(p, 1.);
      }`,
    fragmentShader: `${NOISE}
      uniform float uT, uAge, uNight, uR; varying vec2 vUv; varying float vS, vT; varying vec2 vXZ;
      void main(){
        float day = 1. - uNight;
        float grow = clamp((uAge - 1.6 - vS*.6)/1.4, 0., 1.);
        float hd = hexD(vXZ/uR);
        float inside = 1. - smoothstep(.62, .84, hd);
        if (vT < .5) {
          vec2 c = vUv*2. - 1.;
          float soft = smoothstep(1., .1, length(c));
          float n = fbm(vUv*3.2 + vec2(uT*.045, -uT*.03) + vS*20.);
          float a = soft*smoothstep(.3, .75, n)*.34*day*grow*inside;
          vec3 col = mix(vec3(.9,.97,.95), vec3(1.,.93,.82), vS);
          gl_FragColor = vec4(col*a, a);
        } else {
          float across = 1. - abs(vUv.x*2. - 1.);
          float along = vUv.y;
          float a = smoothstep(0., .5, across)*(1. - pow(along, 1.6))*(.5 + .5*sin(uT*.4 + vS*20.))*(.55 + .45*fbm(vec2(vUv.x*4. + vS*9., uT*.08)));
          a *= .16*day*grow*inside;
          gl_FragColor = vec4(vec3(1.,.9,.6)*a, 0.);
        }
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false; m.renderOrder = 5;
  return m;
}

// ---- the grazing herd -----------------------------------------------------------------------------------------
const _graze: Record<string, THREE.BufferGeometry> = {};
/** An antlered grazer, one unit long, facing +z, hooves on y = 0. Vertex attributes: aL = (leg weight, gait phase), aHd = head weight. */
export function grazerGeo(lite = false): THREE.BufferGeometry {
  const key = lite ? 'l' : 'f';
  if (_graze[key]) return _graze[key];
  const pos: number[] = [], nor: number[] = [], col: number[] = [], aL: number[] = [], aH: number[] = [];
  const add = (g: THREE.BufferGeometry, tone: (x: number, y: number, z: number, ny: number) => [number, number, number], leg: (y: number) => [number, number], head: (x: number, y: number, z: number) => number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position'), n = ng.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      pos.push(x, y, z); nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(...tone(x, y, z, n.getY(i))); aL.push(...leg(y)); aH.push(head(x, y, z));
    }
  };
  const coat = (x: number, y: number, z: number, ny: number): [number, number, number] => {
    const belly = Math.max(0, 0.4 - y) * 1.2, back = Math.max(0, ny) * 0.12;
    const spot = (Math.sin(x * 38 + z * 21) * Math.sin(z * 33 - x * 17) > 0.8 && y > 0.45 && Math.abs(ny) < 0.8) ? 0.5 : 0;
    const v = 0.8 + back - belly * 0.3 + spot;
    return [v, v * 0.92, v * 0.84];
  };
  const noLeg = () => [0, 0] as [number, number], noHead = () => 0;
  const body = new THREE.SphereGeometry(0.5, lite ? 8 : 12, lite ? 5 : 8); body.scale(0.4, 0.4, 1); body.translate(0, 0.55, 0);
  add(body, coat, noLeg, noHead);
  const rump = new THREE.SphereGeometry(0.3, lite ? 6 : 8, lite ? 4 : 6); rump.scale(0.55, 0.6, 0.8); rump.translate(0, 0.55, -0.36);
  add(rump, coat, noLeg, noHead);
  const neck = new THREE.CylinderGeometry(0.075, 0.12, 0.46, lite ? 5 : 7, lite ? 1 : 2, true); neck.rotateX(0.7); neck.translate(0, 0.84, 0.49);
  add(neck, coat, noLeg, (_x, y) => Math.max(0, Math.min(1, (y - 0.62) / 0.4)) * 0.4 + 0.6 * 0 + (y > 0.8 ? 0.6 : 0));
  const head = new THREE.SphereGeometry(0.15, lite ? 6 : 9, lite ? 4 : 7); head.scale(0.8, 0.85, 1.5); head.rotateX(0.35); head.translate(0, 1.03, 0.69);
  add(head, (x, y, z, ny) => { const c = coat(x, y, z, ny); return [c[0] * 0.95, c[1] * 0.9, c[2] * 0.85]; }, noLeg, () => 1);
  if (!lite) { const nose = new THREE.SphereGeometry(0.045, 5, 4); nose.translate(0, 0.97, 0.84);
  add(nose, () => [0.08, 0.06, 0.06], noLeg, () => 1); }
  for (const sx of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.04, 0.14, 4); ear.rotateZ(sx * -0.9); ear.rotateX(-0.2); ear.translate(sx * 0.1, 1.15, 0.6);
    add(ear, coat, noLeg, () => 1);
    // antlers: a main beam and two tines
    const beam = new THREE.CylinderGeometry(0.008, 0.016, 0.3, 4, 1, true); beam.rotateZ(sx * -0.35); beam.rotateX(-0.25); beam.translate(sx * 0.09, 1.29, 0.57);
    add(beam, () => [0.62, 0.5, 0.34], noLeg, () => 1);
    for (const f of lite ? [] : [0.35, 0.8]) {
      const tine = new THREE.CylinderGeometry(0.005, 0.01, 0.12, 3, 1, true); tine.rotateZ(sx * -1.1); tine.rotateX(-0.2); tine.translate(sx * (0.07 + f * 0.1), 1.2 + f * 0.2, 0.56 + f * 0.04);
      add(tine, () => [0.6, 0.48, 0.32], noLeg, () => 1);
    }
  }
  const legC = (_x: number, y: number): [number, number, number] => { const k = 0.55 - Math.max(0, 0.22 - y) * 0.8; return [k * 0.82, k * 0.7, k * 0.58]; };
  const legs: Array<[number, number, number]> = [[-0.13, 0.3, 0], [0.13, 0.3, Math.PI], [-0.13, -0.3, Math.PI], [0.13, -0.3, 0]];
  for (const [lx, lz, ph] of legs) {
    const up = new THREE.CylinderGeometry(0.05, 0.035, 0.28, lite ? 4 : 5, 1, true); up.translate(lx, 0.36, lz);
    add(up, legC, (y) => [Math.max(0, 1 - y / 0.5) * 0.6, ph], noHead);
    const lo = new THREE.CylinderGeometry(0.03, 0.022, 0.26, lite ? 4 : 5, 1, true); lo.translate(lx, 0.13, lz);
    add(lo, legC, (y) => [1 - y * 0.2, ph], noHead);
    if (!lite) { const hoof = new THREE.ConeGeometry(0.034, 0.05, 5); hoof.translate(lx, 0.025, lz);
    add(hoof, () => [0.1, 0.08, 0.07], () => [1, ph], noHead); }
  }
  const tail = new THREE.ConeGeometry(0.05, 0.16, 5); tail.rotateX(-2.1); tail.translate(0, 0.66, -0.68);
  add(tail, () => [0.95, 0.92, 0.88], noLeg, noHead);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aL', new THREE.Float32BufferAttribute(aL, 2));
  g.setAttribute('aHd', new THREE.Float32BufferAttribute(aH, 1));
  g.computeBoundingSphere();
  return (_graze[key] = g);
}

/** Instanced grazers: walking legs and a grazing head, driven by per-instance state (walk, graze, gait phase). */
export function grazerMesh(fx: Fx, n: number, coats: THREE.ColorRepresentation[], lite = false): {mesh: THREE.InstancedMesh; state: Float32Array; stateAttr: THREE.InstancedBufferAttribute} {
  const g = grazerGeo(lite).clone();
  const state = new Float32Array(n * 3);
  const stateAttr = new THREE.InstancedBufferAttribute(state, 3);
  stateAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aSt', stateAttr);
  const mat = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.86, vertexColors: true});
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = fx.uNight; sh.uniforms.uT = fx.uT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aL; attribute float aHd; attribute vec3 aSt;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float swing = sin(aSt.z + aL.y)*aSt.x;
        transformed.z += swing*.17*aL.x;
        transformed.y += max(0., cos(aSt.z + aL.y))*.05*aL.x*aSt.x;
        // head: dips to graze about the base of the neck
        float gz = aSt.y*1.15;
        vec2 hp = vec2(transformed.y - .8, transformed.z - .45);
        float cg = cos(gz*aHd), sg = sin(gz*aHd);
        transformed.y = .8 + hp.x*cg - hp.y*sg;
        transformed.z = .45 + hp.x*sg + hp.y*cg;
        transformed.y += sin(aSt.z*.5)*.012*aSt.x*(aHd > .5 ? 1. : 0.);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb*.04 + vec3(1.,.8,.5)*0.0;`);
  };
  mat.customProgramCacheKey = () => 'grazeD1';
  const mesh = new THREE.InstancedMesh(g, mat, n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) { c.set(coats[i % coats.length]); mesh.setColorAt(i, c); }
  mesh.frustumCulled = false;
  return {mesh, state, stateAttr};
}

// ---- waterfall --------------------------------------------------------------------------------------------------
/** A falling sheet following a stepped profile (points are [horizontal run, y] in the sheet's own plane); width w. Placed by the caller. */
export function waterfallMesh(fx: Fx, profile: Array<[number, number]>, w: number): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let acc = 0;
  const arc: number[] = [0];
  for (let i = 1; i < profile.length; i++) { acc += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]); arc.push(acc); }
  profile.forEach(([h, y], i) => {
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      // the sheet narrows a little toward the foot and fans out into the pool
      const ww = w * (1 + 0.25 * (i / (profile.length - 1))) * (1 + 0.04 * Math.sin(u * 3.14 * 3));
      pos.push((u - 0.5) * ww, y, h); uv.push(u, arc[i] / acc);
    }
  });
  for (let i = 0; i + 1 < profile.length; i++) for (let k = 0; k < 8; k++) {
    const a = i * 9 + k, b = a + 1, c = a + 9, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 5);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uLen: {value: acc}},
    vertexShader: 'attribute vec2 aUv; varying vec2 vUv; varying vec3 vP; void main(){ vUv = aUv; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `${NOISE}
      uniform float uT, uAge, uNight, uLen; varying vec2 vUv; varying vec3 vP;
      void main(){
        float flow = vUv.y*uLen;
        float s1 = fbm(vec2(vUv.x*14., flow*8. + uT*3.6));
        float s2 = vn(vec2(vUv.x*38., flow*18. + uT*6.2));
        float streak = smoothstep(.25, .85, s1*.7 + s2*.5);
        float edge = smoothstep(0., .12, vUv.x)*smoothstep(1., .88, vUv.x);
        float foot = smoothstep(.82, 1., vUv.y);
        float top = smoothstep(0., .08, vUv.y);
        float grow = clamp((uAge - 2.0)/.8, 0., 1.);
        float revealY = smoothstep(1. - grow*1.05, 1. - grow*1.05 + .1, 1. - vUv.y);
        float a = (.35 + .55*streak)*edge*top*mix(1., 1.3, foot)*grow;
        vec3 c = mix(vec3(.55,.8,.9), vec3(1.), streak*.8 + foot*.6);
        c = mix(c, c*vec3(.55,.75,.95) + vec3(.02,.1,.12), uNight*.6);
        c += vec3(.15,.55,.5)*uNight*.4*streak;
        gl_FragColor = vec4(c, clamp(a, 0., .92));
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false; m.renderOrder = 4;
  return m;
}

// ---- ranger beacon beam -----------------------------------------------------------------------------------------
/** A column of light plus two slow-turning sweep blades; origin at the lantern. */
export function beaconBeam(fx: Fx, colour: THREE.ColorRepresentation, R: number, height: number): THREE.Mesh {
  const pos: number[] = [], t: number[] = [], uv: number[] = [];
  const N = 20;
  for (let i = 0; i < N; i++) {
    const a0 = i / N * 6.2832, a1 = (i + 1) / N * 6.2832;
    const r0 = R * 0.03, r1 = R * 0.2;
    const P = (a: number, r: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
    const v = [P(a0, r0, 0), P(a0, r1, height), P(a1, r1, height), P(a0, r0, 0), P(a1, r1, height), P(a1, r0, 0)];
    v.forEach((p) => { pos.push(...p); t.push(0); uv.push(p[1] / height, 0); });
  }
  for (const s of [0, 1]) {
    // a flat fan of light lying a little off the horizontal: uv = (along 0..1, across -1..1)
    const dir = s * Math.PI, L = R * 1.45, wdt = R * 0.2;
    const a = [0, 0, 0], tip = [Math.cos(dir) * L, -R * 0.05, Math.sin(dir) * L];
    const perp = [-Math.sin(dir) * wdt, 0, Math.cos(dir) * wdt];
    const b0 = [tip[0] + perp[0], tip[1], tip[2] + perp[2]], b1 = [tip[0] - perp[0], tip[1], tip[2] - perp[2]];
    const mid = [tip[0] * 0.5, tip[1] * 0.5, tip[2] * 0.5];
    const m0 = [mid[0] + perp[0] * 0.5, mid[1], mid[2] + perp[2] * 0.5], m1 = [mid[0] - perp[0] * 0.5, mid[1], mid[2] - perp[2] * 0.5];
    const V: Array<[number[], number, number]> = [[a, 0, 0], [m0, 0.5, 1], [m1, 0.5, -1], [m0, 0.5, 1], [b0, 1, 1], [b1, 1, -1], [m0, 0.5, 1], [b1, 1, -1], [m1, 0.5, -1]];
    V.forEach(([p, u, v]) => { pos.push(...p); t.push(1); uv.push(u, v); });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), R * 2.5);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uCol: {value: new THREE.Color(colour)}, uH: {value: height}},
    vertexShader: `attribute float aT; attribute vec2 aUv; uniform float uT, uAge, uH; varying float vT; varying vec2 vUv; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){
        vT = aT; vUv = aUv; vec3 p = position;
        float ig = clamp((uAge - 1.5)/.7, 0., 1.);
        if (aT > .5) { float a = uT*.8; float c = cos(a), s = sin(a); p.xz = mat2(c, -s, s, c)*p.xz; p *= ig; }
        else { p.y *= max(ig, .0001); }
        vY = position.y/uH;
        vec4 mv = modelViewMatrix*vec4(p, 1.); vV = -mv.xyz; vN = normalize(normalMatrix*normalize(vec3(position.x, 0., position.z) + 1e-4));
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `uniform float uT, uAge, uNight; uniform vec3 uCol; varying float vT; varying vec2 vUv; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 c0 = mix(uCol, vec3(.85,1.,.9), .35);
        if (vT < .5) {
          float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
          float bands = .65 + .35*sin(vY*16. - uT*1.5);
          float pop = exp(-pow((uAge - 1.9)*5., 2.));
          float a = f*pow(1. - vY, 1.3)*bands*(.18 + .42*uNight + pop*.6)*(.9 + .1*sin(uT*2.1));
          gl_FragColor = vec4(c0*a*1.5, 1.);
        } else {
          float al = pow(1. - vUv.x, 1.4)*smoothstep(1., .15, abs(vUv.y));
          float kk = (.05 + .38*uNight)*(.8 + .2*sin(uT*3.1));
          gl_FragColor = vec4(c0*al*kk*1.3, 1.);
        }
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false; m.renderOrder = 7;
  return m;
}

// ---- the glass dome ----------------------------------------------------------------------------------------------
export function domeMaterial(fx: Fx, glass: THREE.ColorRepresentation = '#a8f0ff', owner: THREE.ColorRepresentation = '#ffffff'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uGlass: {value: new THREE.Color(glass)}, uOwner: {value: new THREE.Color(owner)}},
    vertexShader: `${NOISE}
      uniform float uAge; varying vec3 vN, vV, vU;
      void main(){
        float g = clamp((uAge - .85)/.9, 0., 1.); float k = max(easeBack(g), .0001);
        vec3 p = position*k; vU = normalize(position);
        vec4 mv = modelViewMatrix*vec4(p, 1.);
        vN = normalize(normalMatrix*normal); vV = -mv.xyz;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `${NOISE}
      uniform float uT, uAge, uNight; uniform vec3 uGlass, uOwner; varying vec3 vN, vV, vU;
      float ln(float x, float w){ x = abs(fract(x) - .5)*2.; return smoothstep(1. - w, 1., x); }
      void main(){
        vec3 n = normalize(vN), v = normalize(vV);
        float f = pow(1. - abs(dot(n, v)), 2.1);
        float az = atan(vU.x, vU.z)/6.2832, pol = acos(clamp(vU.y, 0., 1.))/1.5708;
        // a geodesic-ish frame: meridians, parallels and diagonals
        float ribs = ln(az*16. + .5, .07/(.3 + pol))*smoothstep(0., .06, pol);
        float rings = ln(pol*5., .05);
        float diag = ln(az*16. + pol*5.*.5 + .25, .05/(.3 + pol*.4))*step(.03, pol);
        float lat = max(max(ribs, rings), diag*.7);
        // single panels flash like sun on glass
        vec2 cell = vec2(floor(az*16.), floor(pol*5.));
        float h = hash21(cell + floor(uT*.35));
        float flash = step(.93, h)*(.4 + .6*sin(uT*3. + h*30.))*(1. - uNight*.6);
        float sweep = pow(.5 + .5*sin(vU.y*6. + az*18.85 - uT*1.2), 12.);
        float pop = exp(-pow((uAge - 1.7)*5., 2.));
        // thin-film colour at grazing angles
        vec3 irid = .5 + .5*cos(6.2832*(f*1.4 + vec3(0., .33, .67) + .1*sin(uT*.3)));
        float a = .03 + .42*f + .6*lat*(.35 + .65*f) + .5*sweep*(.25 + f) + flash*.12 + pop*.22*(.3 + f) + uNight*.1*f;
        a *= smoothstep(.85, 1.2, uAge);
        vec3 c = mix(uGlass, irid*.9 + uGlass*.3, f*.45)*(1. + uNight*.4) + vec3(.2,.35,.3)*pop;
        // owner colour tints the base band
        float baseBand = smoothstep(.1, 0., pol)*(.5 + uNight);
        c += uOwner*baseBand*.6;
        a += baseBand*.25;
        gl_FragColor = vec4(c*a*(.75 + .25*(1. - uNight)), 1.);
      }`,
  });
}
