// Mohole: shaders and shared geometry (all in unit-radius space; the model group is scaled by the hex radius).
import * as THREE from 'three';

export const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ return vn(p)*.55 + vn(p*2.03+7.1)*.3 + vn(p*4.1+3.3)*.15; }
`;
const TAIL = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

// ---- the shaft: a fake deep bore seen through a disc (analytic ray vs cylinder), hot at the bottom ---------
export const SHAFT_RADIUS = 0.4;
export const SHAFT_Y = 0.028;
export function shaftMaterial() {
  const u = {uT: {value: 0}, uBore: {value: 1}, uOpen: {value: 1}, uFlash: {value: 0}, uGlow: {value: 1}, uOwner: {value: new THREE.Color('#ffffff')}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      varying vec3 vL; varying vec3 vCam;
      void main(){ vL = position; vCam = (inverse(modelMatrix) * vec4(cameraPosition,1.)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uT, uBore, uOpen, uFlash, uGlow; uniform vec3 uOwner;
      varying vec3 vL; varying vec3 vCam;
      ${NOISE}
      vec3 heat(float x){ // deep red -> orange -> yellow -> white
        return mix(mix(vec3(.05,.01,.01), vec3(.85,.16,.03), smoothstep(0.,.45,x)), mix(vec3(1.,.5,.08), vec3(1.,.93,.7), smoothstep(.75,1.,x)), smoothstep(.4,.8,x)); }
      void main(){
        float rs = ${SHAFT_RADIUS.toFixed(3)};
        float rr = length(vL.xz);
        float open = rs * uOpen;
        if (rr > open) discard;
        vec3 O = vec3(vL.x, 0., vL.z);
        vec3 d = normalize(vL - vCam);
        float D = 1.15 * max(uBore, .05);
        vec2 oxz = O.xz, dxz = d.xz;
        float a = max(dot(dxz,dxz), 1e-5), b = dot(oxz,dxz), c = dot(oxz,oxz) - rs*rs;
        float tw = (-b + sqrt(max(b*b - a*c, 0.))) / a;
        float tf = D / max(-d.y, 1e-4);
        bool floorHit = tf < tw;
        float t = min(tw, tf);
        vec3 H = O + d*t;
        float depth = clamp(-H.y / D, 0., 1.);
        float ang = atan(H.z, H.x);
        // rock strata and terrace lines
        float strata = fbm(vec2(ang*3.0, H.y*4.0)) ;
        float rings = smoothstep(.82,1., sin(H.y*34.)) * .5;
        vec3 col = vec3(.09,.04,.03) * (.6 + strata);
        // magma veins climbing the wall, drifting upward
        float vein = fbm(vec2(ang*5. + 3., H.y*3.6 - uT*.22) * vec2(1.,1.));
        float veins = smoothstep(.52,.78,vein);
        float g = pow(depth, 1.5);
        vec3 hot = heat(g*.85 + veins*.35*depth + .1*strata*depth);
        col += hot * (.5 + 2.3*g) * (.55 + veins*1.0);
        col += vec3(.5,.14,.04) * rings * g * 2.;
        // owner-coloured guide lights sliding down the wall
        float lane = smoothstep(.93,1., sin(ang*8.));
        float run = smoothstep(.0,.15, fract(depth*2. - uT*.55)) * (1.-smoothstep(.15,.45, fract(depth*2. - uT*.55)));
        col += uOwner * lane * run * (.5 + .9*depth) * 1.2;
        if (floorHit) { // the bore's floor: churning molten rock
          vec2 q = H.xz*3.2;
          float sw = fbm(q + vec2(uT*.12, -uT*.1) + fbm(q*1.7 - uT*.15)*1.2);
          col = heat(.62 + sw*.55) * (1.5 + 1.2*sw);
        }
        // dark collar at the lip (ambient occlusion), then the glow
        col *= mix(.15, 1., smoothstep(0., .1, depth));
        // the iris edge while opening, and the white burst
        float edge = smoothstep(open*.8, open, rr);
        col += vec3(1.,.55,.15) * edge * (1. - uOpen*.75) * 3.;
        col += vec3(1.,.8,.5) * uFlash * (1.6 - rr/rs*.6);
        col *= uGlow;
        gl_FragColor = vec4(col, 1.);
        ${TAIL}
      }`,
  });
  return {mat, u};
}

// ---- heat shimmer + light column above the bore --------------------------------------------------------------
export function columnMaterial() {
  const u = {uT: {value: 0}, uAmt: {value: 1}, uFlash: {value: 0}, uGrow: {value: 1}, uOwner: {value: new THREE.Color('#ffffff')}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uT, uAmt, uFlash, uGrow; uniform vec3 uOwner;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){
        float h = vUv.y;
        if (h > uGrow) discard;
        // rising wavy bands: a scrolling noise sprite wrapped round the column
        vec2 p = vec2(vUv.x*14., h*3.2 - uT*.7);
        p.x += sin(h*9. + uT*1.3)*.6;
        float n = mix(fbm(p), fbm(p - vec2(14.,0.)), vUv.x);
        vec2 p2 = p*vec2(.6,1.7) + vec2(4., -uT*.5);
        float n2 = mix(fbm(p2), fbm(p2 - vec2(8.4,0.)), vUv.x);
        float bands = smoothstep(.35,.85, n*.6 + n2*.5);
        float fres = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
        float fade = pow(1.-h, 1.6) * smoothstep(0., .08, h);
        vec3 c = mix(vec3(1.,.42,.1), vec3(1.,.82,.5), (1.-h)*.8);
        float a = bands * fres * fade * uAmt * .45;
        // build-in: a pillar of white light straight up the bore
        float beam = uFlash * pow(1.-h, .8) * (.5 + fres*.8);
        gl_FragColor = vec4(c*a*1.1 + vec3(1.,.85,.6)*beam, 1.);
        ${TAIL}
      }`,
  });
  return {mat, u};
}
export function columnGeometry() {
  const g = new THREE.CylinderGeometry(0.36, 0.72, 1.7, 28, 1, true);
  g.translate(0, 0.85 + SHAFT_Y, 0);
  return g;
}

// ---- the ground: a hot halo, and the stamp's shockwave ring --------------------------------------------------
export function groundFxMaterial() {
  const u = {uGlow: {value: 0.3}, uRing: {value: -1}, uRingA: {value: 0}, uFlash: {value: 0}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow, uRing, uRingA, uFlash; varying vec2 vP;
      void main(){
        float r = length(vP);
        float halo = exp(-r*r*3.2) * uGlow * (1. - smoothstep(.9, 1.35, r));
        float ring = exp(-pow((r - uRing)*9., 2.)) * uRingA;
        vec3 c = vec3(1.,.4,.08)*halo*1.4 + vec3(1.,.8,.55)*ring*1.3 + vec3(1.,.7,.4)*uFlash*exp(-r*r*2.2);
        gl_FragColor = vec4(c, 1.);
        ${TAIL}
      }`,
  });
  return {mat, u};
}
export function groundFxGeometry() {
  const g = new THREE.CircleGeometry(1.35, 40); g.rotateX(-Math.PI / 2); g.translate(0, 0.012, 0); return g;
}

// ---- points: steam plumes, rising embers and blinking warning lights (one draw call) ----------------------------
export type MoleLight = [number, number, number];
export function pointsGeometry(lights: MoleLight[], steam: number, embers: number, rnd: () => number) {
  const n = steam + embers + lights.length;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), kind = new Float32Array(n);
  let i = 0;
  for (let s = 0; s < steam; s++, i++) { pos.set([0, SHAFT_Y, 0], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); kind[i] = 0; }
  for (let s = 0; s < embers; s++, i++) { pos.set([0, SHAFT_Y, 0], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); kind[i] = 1; }
  for (const l of lights) { pos.set(l, i * 3); seed.set([rnd(), rnd(), i % 2 ? 0.8 : 0.2, rnd()], i * 4); kind[i] = 2; i++; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 2.2);
  return g;
}
export function pointsMaterial() {
  const u = {uT: {value: 0}, uAge: {value: 99}, uNight: {value: 0}, uPx: {value: 1000}, uOwner: {value: new THREE.Color('#ffffff')}, uSteam: {value: 1}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uT, uAge, uNight, uPx, uSteam; uniform vec3 uOwner; attribute vec4 aSeed; attribute float aKind;
      varying vec4 vC; varying float vK;
      void main(){
        vec3 p = position; float size = 0.; vec3 col = vec3(1.); float alpha = 0.;
        float blast = uAge > .5 ? exp(-(uAge-.5)*1.3) : 0.;
        float on = smoothstep(.4, .5, uAge);
        if (aKind < .5) { // steam plume
          float T = 3.6 + aSeed.x*3.4;
          float ph = fract(uT/T + aSeed.y);
          float ang = aSeed.w*6.283 + ph*(1.2+aSeed.x);
          float r0 = aSeed.z*.28;
          float rise = ph*(1.05 + blast*1.6);
          p = vec3(cos(ang)*(r0+ph*.22), .03 + rise, sin(ang)*(r0+ph*.22));
          p.x += ph*ph*.45; p.z -= ph*.12;
          size = (.1 + ph*.34) * (1. + blast*.7);
          float life = sin(3.1416*ph);
          alpha = life*life*(.3 + blast*.35) * on * uSteam;
          col = mix(vec3(1.,.5,.18), mix(vec3(.82,.8,.8), vec3(1.,.72,.5), uNight*.7), smoothstep(.0,.55,ph));
        } else if (aKind < 1.5) { // embers
          float T = 1.6 + aSeed.x*2.2;
          float ph = fract(uT/T + aSeed.y);
          float ang = aSeed.w*6.283 + ph*3.;
          float r = aSeed.z*.3*(1.+ph*.8);
          p = vec3(cos(ang)*r + ph*ph*.3, .03 + ph*(.8+aSeed.x*.8)*(1.+blast*1.2), sin(ang)*r);
          size = .018 + .012*aSeed.z;
          alpha = (1.-ph)*(.6+.4*sin(uT*14.+aSeed.w*30.)) * on * (.5 + uNight*.5 + .4);
          col = mix(vec3(1.,.85,.4), vec3(1.,.35,.06), ph);
        } else { // warning / owner lights
          float blink = step(.0, sin(uT*3.2 + aSeed.x*6.283));
          float lit = smoothstep(1.5, 1.8, uAge + aSeed.y*.3);
          size = .075;
          alpha = (.35 + .65*blink) * lit * (.55 + uNight*.45);
          col = aSeed.z > .5 ? uOwner*1.4 + .2 : vec3(1.,.18,.1);
        }
        vC = vec4(col, alpha); vK = aKind;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float sc = length(modelMatrix[0].xyz);
        gl_PointSize = max(size * sc * uPx * .5 * projectionMatrix[1][1] / gl_Position.w, 1.);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vC; varying float vK;
      void main(){
        float d = length(gl_PointCoord - .5) * 2.;
        if (d > 1.) discard;
        float a = vK < .5 ? pow(1.-d, 1.6) : (vK < 1.5 ? pow(1.-d, 1.2) : pow(1.-d, 2.) + step(d,.28));
        gl_FragColor = vec4(vC.rgb, vC.a * a);
        ${TAIL}
      }`,
  });
  return {mat, u};
}
