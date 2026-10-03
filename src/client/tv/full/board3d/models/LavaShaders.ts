// Lava Flows: shaders and geometry (unit-radius space; the model group is scaled by the hex radius).
import * as THREE from 'three';

export const GROUND_R = 0.86;
const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
vec2 h22(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ return vn(p)*.55 + vn(p*2.03+7.1)*.3 + vn(p*4.1+3.3)*.15; }
vec3 vor(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8., d2=8., id=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 o=h22(i+g); vec2 r=g+o-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=h21(i+g);} else if(d<d2) d2=d; }
  return vec3(sqrt(d1), sqrt(d2), id); }
vec3 heat(float x){ return mix(mix(vec3(.12,.01,.0), vec3(.9,.14,.02), smoothstep(0.,.4,x)), mix(vec3(1.,.5,.07), vec3(1.,.92,.62), smoothstep(.72,1.,x)), smoothstep(.35,.8,x)); }
`;
const TAIL = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

/** a polar grid over the hex's inscribed disc: dense enough for plate relief and the cone */
export function lavaGroundGeometry(rings = 30, sectors = 72): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  pos.push(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = GROUND_R * Math.pow(i / rings, 0.9);
    for (let s = 0; s < sectors; s++) { const a = (s / sectors) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let s = 0; s < sectors; s++) idx.push(0, 1 + ((s + 1) % sectors), 1 + s);
  for (let i = 1; i < rings; i++) for (let s = 0; s < sectors; s++) {
    const a = 1 + (i - 1) * sectors + s, b = 1 + (i - 1) * sectors + ((s + 1) % sectors), c = a + sectors, d = b + sectors;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 1.1);
  return g;
}

export function lavaGroundMaterial() {
  const u = {uT: {value: 0}, uFront: {value: 2}, uOpen: {value: 1}, uRise: {value: 1}, uFlash: {value: 0}, uNight: {value: 0}, uEmis: {value: 1}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      uniform float uRise; varying vec3 vP;
      ${NOISE}
      void main(){
        vec2 xz = position.xz; float r = length(xz);
        vec2 q = xz*4.6; q += (vec2(fbm(xz*3.), fbm(xz*3.+9.))-.5)*.5;
        vec3 v = vor(q); float edge = v.y - v.x;
        float plate = smoothstep(.0,.3,edge)*.05 + (v.z-.5)*.012 + fbm(xz*7.)*.01;
        float fade = 1. - smoothstep(.7,.86,r);
        float cone = .52*pow(max(1. - r/.38,0.),1.25) - .09*(1.-smoothstep(.0,.075,r))*step(r,.4);
        float h = .012 + plate*fade + cone*uRise*(1.0);
        vec3 p = vec3(xz.x, h, xz.y);
        vP = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT, uFront, uOpen, uFlash, uNight, uEmis, uRise; varying vec3 vP;
      ${NOISE}
      void main(){
        vec2 xz = vP.xz; float r = length(xz); float ang = atan(xz.y, xz.x);
        vec2 q = xz*4.6; q += (vec2(fbm(xz*3.), fbm(xz*3.+9.))-.5)*.5;
        vec3 v = vor(q); float edge = v.y - v.x;
        // the front the lava has reached, ragged so it runs in fingers along the channels
        float rf = uFront * (.7 + .6*fbm(vec2(ang*2.2 + 1., 1.7)));
        float reveal = 1. - smoothstep(rf - .08, rf, r);
        float front = smoothstep(rf - .16, rf - .02, r) * (1. - smoothstep(rf - .02, rf, r));
        // broad rivers radiating from the cone
        float warp = fbm(vec2(r*3.5, ang*1.5))*2.2;
        float ch = smoothstep(.62,.9, fbm(vec2(ang*2.6 + warp, r*1.8 - uT*.05)));
        float rim = 1. - smoothstep(.62,.82, r);
        float w = (.035 + .05*uOpen) + ch*.17*uOpen*rim;
        float crack = (1. - smoothstep(w, w + .09, edge)) * reveal * rim;
        // flow: bright pulses sliding outward along the channels
        float flow = fbm(vec2(r*5.5 - uT*.55, ang*3.2) + v.z*3.);
        float heatv = clamp(.35 + .75*flow + .35*(1. - edge/max(w,.001))*step(edge,w) + ch*.2, 0., 1.2);
        vec3 lava = heat(heatv*.92) * (.75 + .45*flow);
        // finer cooling cracks and the red glow bleeding into the crust
        vec3 v2 = vor(xz*13. + vec2(5.,2.));
        float c2 = (1. - smoothstep(.0,.07, v2.y - v2.x)) * reveal * rim * (.25 + .5*fbm(xz*9. + uT*.12));
        float bleed = exp(-edge*6.) * reveal * rim;
        // lighting by screen derivatives: faceted basalt
        vec3 n = normalize(cross(dFdx(vP), dFdy(vP))); n *= sign(n.y + 1e-4);
        float lit = .4 + .6*max(dot(n, normalize(vec3(.4,.85,.3))), 0.);
        float sun = 1. - uNight*.8;
        vec3 basalt = mix(vec3(.045,.04,.045), vec3(.19,.13,.11), fbm(xz*17.)) * (.55 + .8*v.z*.3 + smoothstep(.0,.3,edge)*.6);
        vec3 col = basalt * lit * (.35 + .65*sun);
        col += vec3(.55,.09,.015) * bleed * .55 * (.8 + flow);
        col += vec3(.9,.25,.05) * c2;
        col = mix(col, lava, clamp(crack,0.,1.));
        // the cone: streaks of lava running down the flanks, a churning crater
        float cz = (1. - smoothstep(.2,.38, r)) * uRise;
        float streak = smoothstep(.55,.85, fbm(vec2(ang*7. + warp*.5, r*5. - uT*.5 + 4.)));
        col = mix(col, heat(.4 + .5*flow)*1.1, streak*cz*(.2 + r*1.8)*reveal);
        float cr = 1. - smoothstep(.04,.095, r);
        vec3 cc = heat(.7 + .3*fbm(xz*22. + vec2(uT*.7, -uT*.5))) * 1.4;
        col = mix(col, cc, cr*uRise);
        col += vec3(1.,.7,.35) * front * .9;
        col += vec3(1.,.82,.55) * uFlash * (.4 + .6*reveal);
        // glow scales with the night; the ground edge goes to ash
        col = mix(col, col*(.5 + .5*uEmis), crack*0.);
        col *= 1. + (uEmis - 1.)*(crack + cr*uRise + streak*cz)*1.0;
        col = mix(col, vec3(.04,.03,.03)*(.4+.6*sun), smoothstep(.72,.86,r));
        gl_FragColor = vec4(col, 1.);
        ${TAIL}
      }`,
  });
  return {mat, u};
}

// ---- ground halo + flash dome (additive) -----------------------------------------------------------------------------
export function lavaHaloMaterial() {
  const u = {uGlow: {value: 0.3}, uFlash: {value: 0}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `uniform float uGlow, uFlash; varying vec2 vP;
      void main(){ float r = length(vP); float a = exp(-r*r*2.6) * (1. - smoothstep(.95,1.35,r));
        vec3 c = vec3(1.,.32,.05)*a*uGlow*1.5 + vec3(1.,.75,.45)*uFlash*a*1.2; gl_FragColor = vec4(c,1.);
        ${TAIL}
      }`,
  });
  return {mat, u};
}
export function lavaHaloGeometry() { const g = new THREE.CircleGeometry(1.35, 36); g.rotateX(-Math.PI / 2); g.translate(0, 0.01, 0); return g; }

export function lavaDomeMaterial() {
  const u = {uA: {value: 0}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */ `uniform float uA; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float f = 1. - abs(dot(normalize(vN), normalize(vV))); float a = (pow(f,1.5)*.9 + .1)*uA*(1.-vY*.5);
        gl_FragColor = vec4(vec3(1.,.55,.18)*a*1.6, 1.);
        ${TAIL}
      }`,
  });
  return {mat, u};
}
export function lavaDomeGeometry() { return new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2); }

// ---- points ---------------------------------------------------------------------------------------------------------
export const CRATER_Y = 0.46;
const PT_COMMON = /* glsl */ `
  uniform float uT, uAge, uNight, uPx; uniform vec3 uOwner; attribute vec4 aSeed; attribute float aKind; varying vec4 vC; varying float vK;
  float blastOf(float age){ return age > .35 ? exp(-(age-.35)*1.1) : 0.; }`;
const PT_FRAG = (soft: string) => /* glsl */ `varying vec4 vC; varying float vK;
  void main(){ float d = length(gl_PointCoord - .5)*2.; if (d > 1.) discard; float a = ${soft};
    gl_FragColor = vec4(vC.rgb, vC.a*a);
    ${TAIL}
  }`;
const PT_SIZE = 'vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv; float sc = length(modelMatrix[0].xyz); gl_PointSize = max(size*sc*uPx*.5*projectionMatrix[1][1]/gl_Position.w, 1.);';

/** embers (kind 0 from the crater, kind 1 lifting off the lava fields) and the owner's beacon (kind 2) */
export function lavaEmberGeometry(n1: number, n2: number, beacon: [number, number, number], rnd: () => number) {
  const n = n1 + n2 + 1;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), kind = new Float32Array(n);
  for (let i = 0; i < n1; i++) { pos.set([0, CRATER_Y, 0], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); kind[i] = 0; }
  for (let i = n1; i < n1 + n2; i++) {
    const a = rnd() * 6.283, r = 0.18 + Math.sqrt(rnd()) * 0.58;
    pos.set([Math.cos(a) * r, 0.03, Math.sin(a) * r], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); kind[i] = 1;
  }
  pos.set(beacon, (n - 1) * 3); seed.set([0.3, 0.2, 0.5, 0.1], (n - 1) * 4); kind[n - 1] = 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4)); g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 2);
  return g;
}
export function lavaEmberMaterial() {
  const u = {uT: {value: 0}, uAge: {value: 99}, uNight: {value: 0}, uPx: {value: 1000}, uOwner: {value: new THREE.Color('#ffffff')}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `${PT_COMMON}
      void main(){
        vec3 p = position; float size = 0.; vec3 col = vec3(1.); float alpha = 0.;
        float blast = blastOf(uAge); float on = smoothstep(.25,.35,uAge);
        if (aKind < .5) { // sparks thrown from the crater on arcs
          float T = 1.1 + aSeed.x*1.3; float ph = fract(uT/T + aSeed.y);
          float ang = aSeed.z*6.283; float sp = (.12 + aSeed.w*.34)*(1.+blast*1.6);
          float up = (.7 + aSeed.x*.5)*(1.+blast*.9);
          p = vec3(cos(ang)*sp*ph, ${CRATER_Y.toFixed(2)} + up*ph - 1.3*ph*ph*(1.+blast*.5), sin(ang)*sp*ph);
          size = .016 + .012*aSeed.w; alpha = (1.-ph)*on*(.7+.3*sin(uT*30.+aSeed.x*40.));
          col = mix(vec3(1.,.9,.5), vec3(1.,.28,.04), ph)*(1.2+uNight);
        } else if (aKind < 1.5) { // embers lifting off the lava
          float T = 2.4 + aSeed.x*2.6; float ph = fract(uT/T + aSeed.y);
          p.y = .03 + ph*(.3+aSeed.z*.3); p.x += sin(uT*.8+aSeed.w*20.)*.05*ph; p.z += cos(uT*.7+aSeed.x*20.)*.05*ph;
          size = .012 + .008*aSeed.z; alpha = sin(3.14*ph)*(.5+.5*sin(uT*9.+aSeed.w*40.))*smoothstep(.5,1.2,uAge)*(.6+.6*uNight);
          col = vec3(1.,.5,.12)*(1.1+uNight);
        } else { // owner beacon
          float pulse = .65 + .35*sin(uT*3.);
          size = .13; alpha = pulse*smoothstep(1.3,1.6,uAge)*(.7+.5*uNight); col = uOwner*1.5 + .15;
        }
        vC = vec4(col, alpha); vK = aKind; ${PT_SIZE}
      }`,
    fragmentShader: PT_FRAG('(vK < 1.5 ? pow(1.-d, 1.5) : pow(1.-d, 2.2) + step(d,.25))'),
  });
  return {mat, u};
}

export function lavaSmokeGeometry(n: number, rnd: () => number) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), kind = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set([0, CRATER_Y, 0], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4)); g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2);
  return g;
}
export function lavaSmokeMaterial() {
  const u = {uT: {value: 0}, uAge: {value: 99}, uNight: {value: 0}, uPx: {value: 1000}, uOwner: {value: new THREE.Color('#ffffff')}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `${PT_COMMON}
      void main(){
        float blast = blastOf(uAge); float on = smoothstep(.3,.45,uAge);
        float T = 5. + aSeed.x*4.; float ph = fract(uT/T + aSeed.y);
        float ang = aSeed.w*6.283 + ph*1.4;
        float rise = ph*(.95 + blast*.8);
        vec3 p = vec3(cos(ang)*(.03+ph*.16*aSeed.z), ${CRATER_Y.toFixed(2)} + rise, sin(ang)*(.03+ph*.16*aSeed.z));
        p.x += ph*ph*.5; p.z -= ph*.1;
        float size = (.1 + ph*.42)*(1.+blast*.5);
        float life = sin(3.14*ph);
        float alpha = life*(.5 + blast*.2)*on;
        vec3 col = mix(vec3(.55,.2,.08)*(.6+uNight*1.2), vec3(.2,.19,.2)*(1.-uNight*.5), smoothstep(.0,.35,ph));
        vC = vec4(col, alpha); vK = 3.; ${PT_SIZE}
      }`,
    fragmentShader: PT_FRAG('pow(1.-d, 1.3)'),
  });
  return {mat, u};
}
