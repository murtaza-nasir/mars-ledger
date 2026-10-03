// Mohole (Detailed): the bore itself (a ray-cast fake of a kilometre-deep shaft with coloured strata, ladders, service
// platforms and a churning molten floor) and the points layer (shaft steam, embers, vent steam, beacons).
import * as THREE from 'three';

export const SHAFT_R = 0.36;
export const SHAFT_Y = 0.032;
const TAIL = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';
export const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ return vn(p)*.55 + vn(p*2.03+7.1)*.3 + vn(p*4.1+3.3)*.15; }
`;

export function shaftMaterial(lite: boolean) {
  const u = {uT: {value: 0}, uBore: {value: 1}, uOpen: {value: 1}, uFlash: {value: 0}, uGlow: {value: 1}, uOwner: {value: new THREE.Color('#ffffff')}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    defines: lite ? {LITE: 1} : {},
    vertexShader: /* glsl */ `
      varying vec3 vL; varying vec3 vCam;
      void main(){ vL = position; vCam = (inverse(modelMatrix) * vec4(cameraPosition,1.)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uT, uBore, uOpen, uFlash, uGlow; uniform vec3 uOwner;
      varying vec3 vL; varying vec3 vCam;
      ${NOISE}
      vec3 heat(float x){
        return mix(mix(vec3(.05,.01,.01), vec3(.85,.16,.03), smoothstep(0.,.45,x)), mix(vec3(1.,.5,.08), vec3(1.,.93,.7), smoothstep(.75,1.,x)), smoothstep(.4,.8,x)); }
      vec3 stratum(float id){
        float k = fract(sin(id*12.9898)*43758.5453);
        vec3 a = vec3(.30,.16,.10), b = vec3(.46,.27,.14), c = vec3(.22,.20,.21), d = vec3(.40,.17,.11), e = vec3(.52,.40,.24);
        return k < .2 ? a : k < .4 ? b : k < .6 ? c : k < .8 ? d : e; }
      void main(){
        float rs = ${SHAFT_R.toFixed(3)};
        float rr = length(vL.xz);
        float open = rs * uOpen;
        if (rr > open) discard;
        vec3 O = vec3(vL.x, 0., vL.z);
        vec3 d = normalize(vL - vCam);
        float D = 1.25 * max(uBore, .05);
        vec2 oxz = O.xz, dxz = d.xz;
        float a = max(dot(dxz,dxz), 1e-5), b = dot(oxz,dxz), c = dot(oxz,oxz) - rs*rs;
        float tw = (-b + sqrt(max(b*b - a*c, 0.))) / a;
        float tf = D / max(-d.y, 1e-4);
        bool floorHit = tf < tw;
        float t = min(tw, tf);
        vec3 H = O + d*t;
        float depth = clamp(-H.y / D, 0., 1.);
        float ang = atan(H.z, H.x);
        float arc = ang * rs;
        // strata: bands of different rock, warped, with fine bedding lines and chipped relief
        float warp = fbm(vec2(ang*2.3, H.y*2.)) * .12;
        float yb = -H.y*7. + warp*7.;
        vec3 col = stratum(floor(yb)) * (.75 + .5*fbm(vec2(ang*9., H.y*30.)));
        col *= .8 + .35*smoothstep(.3,.5, abs(fract(yb)-.5));
        float relief = fbm(vec2(ang*14., H.y*26.));
        col *= .55 + .9*relief;
        // magma veins climbing the wall
        float vein = fbm(vec2(ang*5. + 3., H.y*3.6 - uT*.22));
        float veins = smoothstep(.55,.8,vein);
        float g = pow(depth, 1.4);
        vec3 hot = heat(g*.85 + veins*.35*depth + .1*relief*depth);
        vec3 lit = col * (.22 + 2.6*g*(.4+relief));
        lit += hot * (.35 + 2.3*g) * (.4 + veins*1.1);
#ifndef LITE
        // ladders on three faces: rails and rungs, lit by the heat below
        for (int k = 0; k < 3; k++) {
          float la = float(k)*2.0944 + .6;
          float da = (ang - la); da = atan(sin(da), cos(da));
          float x = da*rs;
          float rail = smoothstep(.0055,.0035, abs(abs(x) - .018));
          float rung = step(abs(x), .018) * smoothstep(.2,.1, abs(fract(H.y*34.)-.5)) ;
          float ladder = max(rail, rung) * step(depth, .93);
          lit = mix(lit, vec3(.62,.6,.58)*(.3 + 2.2*g) + hot*.4*g, ladder*.9);
        }
        // service platforms: steel rings with a row of lamps
        float pl = abs(fract(-H.y*2.1) - .0) ;
        float ring = smoothstep(.028,.012, fract(-H.y*2.1)) * step(.25, -H.y*2.1);
        float lamps = ring * smoothstep(.55,.9, sin(ang*26.));
        lit = mix(lit, vec3(.34,.33,.34)*(.5+2.*g), ring*.85);
        lit += vec3(1.,.86,.55)*lamps*1.4 + uOwner*ring*smoothstep(.93,1., sin(ang*3.+uT*.5))*1.5;
        // owner-coloured guide lights sliding down the wall
        float lane = smoothstep(.95,1., sin(ang*8.));
        float run = smoothstep(.0,.15, fract(depth*2. - uT*.55)) * (1.-smoothstep(.15,.45, fract(depth*2. - uT*.55)));
        lit += uOwner * lane * run * (.5 + .9*depth) * 1.2;
#endif
        col = lit;
        if (floorHit) {
          vec2 q = H.xz*3.4;
          float sw = fbm(q + vec2(uT*.12, -uT*.1) + fbm(q*1.7 - uT*.15)*1.2);
          float crust = smoothstep(.5,.62, fbm(q*2.4 - uT*.05));
          col = mix(heat(.7 + sw*.5)*(1.8 + 1.2*sw), vec3(.12,.03,.01), crust*.8);
        }
        // haze climbing out of the bore, then the dark collar at the lip
        col += vec3(1.,.4,.1) * .12 * g * (1. - rr/rs*.4);
        col *= mix(.12, 1., smoothstep(0., .1, depth));
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

// ---- points: shaft steam, rising embers, vent steam and beacons (one draw call) ---------------------------------
export type Pt = [number, number, number];
export function pointsGeometry(lights: Array<[number, number, number, number]>, vents: Pt[], steam: number, embers: number, ventSteam: number, rnd: () => number) {
  const n = steam + embers + lights.length + vents.length * ventSteam;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), kind = new Float32Array(n);
  let i = 0;
  for (let s = 0; s < steam; s++, i++) { pos.set([0, SHAFT_Y, 0], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); kind[i] = 0; }
  for (let s = 0; s < embers; s++, i++) { pos.set([0, SHAFT_Y, 0], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); kind[i] = 1; }
  for (const l of lights) { pos.set([l[0], l[1], l[2]], i * 3); seed.set([rnd(), rnd(), l[3], rnd()], i * 4); kind[i] = 2; i++; }
  for (const v of vents) for (let s = 0; s < ventSteam; s++, i++) { pos.set(v, i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); kind[i] = 3; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 2.2);
  return g;
}
export function pointsMaterial() {
  const u = {uT: {value: 0}, uAge: {value: 99}, uNight: {value: 0}, uPx: {value: 1000}, uOwner: {value: new THREE.Color('#ffffff')}, uSteam: {value: 1}, uLights: {value: 1}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uT, uAge, uNight, uPx, uSteam, uLights; uniform vec3 uOwner; attribute vec4 aSeed; attribute float aKind;
      varying vec4 vC; varying float vK;
      void main(){
        vec3 p = position; float size = 0.; vec3 col = vec3(1.); float alpha = 0.;
        float blast = uAge > .5 ? exp(-(uAge-.5)*1.3) : 0.;
        float on = smoothstep(.4, .5, uAge);
        if (aKind < .5) {
          float T = 3.6 + aSeed.x*3.4;
          float ph = fract(uT/T + aSeed.y);
          float ang = aSeed.w*6.283 + ph*(1.2+aSeed.x);
          float r0 = aSeed.z*.26;
          float rise = ph*(1.05 + blast*1.6);
          p = vec3(cos(ang)*(r0+ph*.22), .03 + rise, sin(ang)*(r0+ph*.22));
          p.x += ph*ph*.45; p.z -= ph*.12;
          size = (.1 + ph*.34) * (1. + blast*.7);
          float life = sin(3.1416*ph);
          alpha = life*life*(.28 + blast*.35) * on * uSteam;
          col = mix(vec3(1.,.5,.18), mix(vec3(.82,.8,.8), vec3(1.,.72,.5), uNight*.7), smoothstep(.0,.55,ph));
        } else if (aKind < 1.5) {
          float T = 1.6 + aSeed.x*2.2;
          float ph = fract(uT/T + aSeed.y);
          float ang = aSeed.w*6.283 + ph*3.;
          float r = aSeed.z*.28*(1.+ph*.8);
          p = vec3(cos(ang)*r + ph*ph*.3, .03 + ph*(.8+aSeed.x*.8)*(1.+blast*1.2), sin(ang)*r);
          size = .016 + .011*aSeed.z;
          alpha = (1.-ph)*(.6+.4*sin(uT*14.+aSeed.w*30.)) * on * (.5 + uNight*.5 + .4);
          col = mix(vec3(1.,.85,.4), vec3(1.,.35,.06), ph);
        } else if (aKind < 2.5) {
          float blink = step(.0, sin(uT*3.2 + aSeed.x*6.283));
          float lit = uLights;
          size = .075;
          alpha = (.35 + .65*blink) * lit * (.55 + uNight*.45);
          col = aSeed.z > .5 ? uOwner*1.4 + .2 : vec3(1.,.18,.1);
        } else { // vent steam: a white puff drifting off a pipe stack
          float T = 2.6 + aSeed.x*2.;
          float ph = fract(uT/T + aSeed.y);
          p.y += ph*.34; p.x += ph*ph*.22 + sin(uT*.7+aSeed.w*9.)*.02*ph; p.z += (aSeed.z-.5)*.1*ph;
          size = .05 + ph*.15;
          float life = sin(3.1416*ph);
          alpha = life*.36*smoothstep(1.0,1.5,uAge)*uSteam;
          col = mix(vec3(.9,.9,.92), vec3(1.,.66,.44), uNight*.6);
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
        float a = (vK < .5 || vK > 2.5) ? pow(1.-d, 1.6) : (vK < 1.5 ? pow(1.-d, 1.2) : pow(1.-d, 2.) + step(d,.28));
        gl_FragColor = vec4(vC.rgb, vC.a * a);
        ${TAIL}
      }`,
  });
  return {mat, u};
}
