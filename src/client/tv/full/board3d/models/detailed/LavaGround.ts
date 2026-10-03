// Lava Flows (Detailed): the volcanic hex field. One displaced mesh over the whole hex footprint, shaded procedurally:
// a steep cone with a crater pool and gullies, five braided lava rivers that split, rejoin and crust over (drifting skin
// plates with incandescent cracks), levees along the channels, cooled basalt with glowing fissures, ash on the heights.
// Heights are shared with JS (coneHeight) so props sit on the cone.
import * as THREE from 'three';

export const RC = 0.42;       // cone base radius
export const HC = 0.5;       // cone height before the crater
export const RK = 0.09;       // crater radius
export const CRATER_BOWL = 0.06;
export function coneHeight(r: number): number {
  const k = Math.max(0, 1 - Math.max(r, RK) / RC);
  const bowl = CRATER_BOWL * (1 - Math.min(1, r / RK)) ** 1.5;
  return HC * Math.pow(k, 1.3) - bowl;
}
export const CRATER_Y = coneHeight(RK) + 0.004;

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
// hex footprint (pointy-top, circumradius 1): 0 at the centre, 1 at the edge
float hexN(vec2 p){ vec2 q = abs(p); return max(q.x, dot(q, vec2(.5,.866))) / .866; }
// the river network: five braided channels from the cone. core < 1 inside a channel; f is the lateral phase.
float rivers(vec2 xz, out float f, out float cell){
  float r = length(xz), a = atan(xz.y, xz.x);
  float warp = (fbm(vec2(r*2.6, a*1.3)) - .5)*1.1 + (fbm(vec2(r*7., a*3.) + 4.) - .5)*.24;
  float ph = a*.79577 + warp*.62;
  cell = floor(ph + .5); f = ph - cell;
  float sp = smoothstep(.3,.8,r)*(.1 + .04*sin(cell*7.1)) + .01;
  float wob = .03*sin(r*17. + cell*3.) + .018*sin(r*41. + cell);
  float d1 = abs(f - sp - wob), d2 = abs(f + sp + wob*.8);
  float near = 1. - smoothstep(.3,.56,r);
  float d = mix(min(d1, d2), abs(f), near);
  float wid = mix(.1,.068, smoothstep(.3,.85,r)) * (1. + near*.7);
  // a short tributary lobe between two rivers
  float ph2 = a*.47746 + warp*.5 + .5; float f2 = ph2 - floor(ph2 + .5);
  float d3 = abs(f2) * step(.5, r) * 1.0 + (1. - step(.5, r))*9.;
  float wid3 = .03 * smoothstep(.5,.62,r);
  float c1 = d / wid, c3 = d3 / max(wid3, .001);
  return min(c1, c3 + .15);
}
`;
const TAIL = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

/** a polar grid over the hex footprint (corners at 30 + 60k degrees, so a sector line meets every corner) */
export function lavaGroundGeometry(rings: number, sectors: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  pos.push(0, 0, 0);
  const hexR = (a: number) => { const m = ((((a - Math.PI / 6) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6; return 0.866 / Math.cos(m); };
  for (let i = 1; i <= rings; i++) {
    const f = Math.pow(i / rings, 0.82);
    for (let s = 0; s < sectors; s++) { const a = (s / sectors) * Math.PI * 2; const r = f * hexR(a) * 0.975; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let s = 0; s < sectors; s++) idx.push(0, 1 + ((s + 1) % sectors), 1 + s);
  for (let i = 1; i < rings; i++) for (let s = 0; s < sectors; s++) {
    const a = 1 + (i - 1) * sectors + s, b = 1 + (i - 1) * sectors + ((s + 1) % sectors), c = a + sectors, d = b + sectors;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.25, 0), 1.1);
  return g;
}

export function lavaGroundMaterial(lite: boolean) {
  const u = {uT: {value: 0}, uFront: {value: 2}, uOpen: {value: 1}, uRise: {value: 1}, uFlash: {value: 0}, uNight: {value: 0}, uEmis: {value: 1}, uBurst: {value: 0}};
  const CONE = `
    float coneH(float r){ float k = max(1. - max(r, ${RK.toFixed(3)})/${RC.toFixed(3)}, 0.); float bowl = ${CRATER_BOWL.toFixed(3)}*pow(1. - min(1., r/${RK.toFixed(3)}), 1.5);
      return ${HC.toFixed(3)}*pow(k, 1.3) - bowl; }`;
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    defines: lite ? {LITE: 1} : {},
    vertexShader: /* glsl */ `
      uniform float uRise, uOpen; varying vec3 vP;
      ${NOISE}
      ${CONE}
      void main(){
        vec2 xz = position.xz; float r = length(xz);
        float edge = hexN(xz);
        vec2 q = xz*4.2; q += (vec2(fbm(xz*3.), fbm(xz*3.+9.)) - .5)*.5;
        vec3 v = vor(q);
        float plate = smoothstep(.0,.3, v.y - v.x)*.028 + (v.z - .5)*.008 + fbm(xz*7.)*.012;
        float f, cell; float core = rivers(xz, f, cell);
        float chan = (1. - smoothstep(.55, 1.1, core)) * uOpen;
        float levee = exp(-pow((core - 1.35)*2.2, 2.)) * .014 * uOpen;
        float fade = 1. - smoothstep(.8,1.0, edge);
        float coneMask = 1. - smoothstep(${(RC * 0.92).toFixed(3)}, ${(RC * 1.18).toFixed(3)}, r);
        float gul = (fbm(vec2(atan(xz.y,xz.x)*7., r*4.)) - .5) * .05 * coneMask * smoothstep(.1,.2,r);
        float h = .012 + (plate - chan*.03 + levee) * fade*(1. - coneMask*.8) + (coneH(r) + gul) * uRise;
        h = max(h, .004);
        vec3 p = vec3(xz.x, h, xz.y);
        vP = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT, uFront, uOpen, uFlash, uNight, uEmis, uRise, uBurst; varying vec3 vP;
      ${NOISE}
      void main(){
        vec2 xz = vP.xz; float r = length(xz); float ang = atan(xz.y, xz.x); float edge = hexN(xz);
        vec2 q = xz*4.2; q += (vec2(fbm(xz*3.), fbm(xz*3.+9.)) - .5)*.5;
        vec3 v = vor(q); float pe = v.y - v.x;
        // the front the lava has reached: ragged, fingering along the channels
        float rf = uFront * (.7 + .6*fbm(vec2(ang*2.2 + 1., 1.7)));
        float reveal = 1. - smoothstep(rf - .08, rf, r);
        float front = smoothstep(rf - .18, rf - .02, r) * (1. - smoothstep(rf - .02, rf, r));
        float f, cell; float core = rivers(xz, f, cell);
        float inCh = (1. - smoothstep(.92, 1.08, core)) * reveal * uOpen;
        float nearCh = (1. - smoothstep(1.0, 2.6, core)) * reveal;
        // crust: skin plates drift outward along the flow, gaps show the melt
        float spd = .16 + .1*h21(vec2(cell, 3.));
        vec2 sq = vec2(r*11. - uT*spd*3., f*(22. + r*10.) + cell*5.);
        sq += (vec2(fbm(sq*.7), fbm(sq*.7 + 5.)) - .5)*1.1;
        vec3 sv = vor(sq); float sedge = sv.y - sv.x;
        float cold = smoothstep(.15,.9, r) * .6 + .3 + .25*fbm(xz*6. + 2.);
        float skin = smoothstep(.05,.22, sedge) * clamp(cold + .1, 0., 1.);       // 1 on a plate, 0 in a crack
        float flow = fbm(vec2(r*5.5 - uT*.55, ang*3.2) + sv.z*3.);
        float hotv = clamp(.45 + .6*flow + (1. - smoothstep(0.,.5,core))*.3 + (1. - smoothstep(.3,.6,r))*.35, 0., 1.2);
        vec3 melt = heat(min(hotv, .8)*.84) * (.8 + .4*flow);
        vec3 plateC = mix(vec3(.05,.035,.035), vec3(.2,.07,.03), fbm(xz*30.)) + vec3(.5,.1,.02)*pow(1. - sedge, 3.)*.35*(.4 + flow);
        vec3 lava = mix(melt, plateC, skin);
        // the basalt: lit by facets plus a fine bump, dusted with ash, cut by glowing fissures
        vec3 dxp = dFdx(vP), dyp = dFdy(vP);
        vec3 n = normalize(cross(dxp, dyp)); n *= sign(n.y + 1e-4);
        float b0 = fbm(xz*60.);
        n = normalize(n + .5*vec3(fbm(xz*60. + vec2(.02,0.)) - b0, 0., fbm(xz*60. + vec2(0.,.02)) - b0)*6.);
        float lit = .35 + .65*max(dot(n, normalize(vec3(.4,.85,.3))), 0.);
        float sun = 1. - uNight*.8;
        float ash = smoothstep(.1,.5, vP.y) * (1. - smoothstep(.3,.6, vP.y)) * .5;
        vec3 basalt = mix(vec3(.02,.018,.022), vec3(.09,.062,.056), fbm(xz*17.)) * (.55 + .8*v.z*.3 + smoothstep(.0,.3,pe)*.6);
        basalt = mix(basalt, vec3(.2,.18,.18)*(.6 + .6*fbm(xz*24.)), ash*uRise);
        // ropy streaks along the flow near the channels
        float rope = smoothstep(.45,.9, sin(f*90. + fbm(vec2(r*10., f*4.))*6.))*nearCh*.25;
        basalt *= 1. + rope*.6;
        vec3 col = basalt * lit * (.3 + .7*sun);
        col += vec3(.5,.1,.03) * exp(-r*2.2) * (.25 + .75*max(dot(n, normalize(vec3(-xz.x, .35, -xz.y))),0.)) * reveal * .5;
        // glowing fissures: Voronoi walls on the cooling ground, hotter near the rivers and the cone
        vec3 v2 = vor(xz*12. + vec2(5.,2.));
        float fis = (1. - smoothstep(.0,.075, v2.y - v2.x)) * reveal * (.2 + .9*nearCh + .6*(1. - smoothstep(.3,.55,r)));
        vec3 v3 = vor(xz*27. + vec2(1.,8.));
        float fis2 = (1. - smoothstep(.0,.06, v3.y - v3.x)) * reveal * nearCh * (.3 + .5*fbm(xz*9. + uT*.1));
        col += vec3(.9,.13,.03)*fis*.5*(.7 + .6*fbm(xz*7. - uT*.08));
        col += vec3(.95,.25,.04)*fis2*.4;
        col += vec3(.55,.08,.012) * exp(-core*1.4) * reveal * .5 * (.7 + flow);   // heat bleeding into the banks
        col = mix(col, lava*(1.0 + .35*uNight), clamp(inCh, 0., 1.));
        // the cone: lava running down gullies, spatter, and the crater pool
        float cz = (1. - smoothstep(${(RC * 0.6).toFixed(3)}, ${RC.toFixed(3)}, r)) * uRise;
        float streak = smoothstep(.55,.82, fbm(vec2(ang*9. + fbm(vec2(r*6., ang))*2., r*6. - uT*.45 + 4.)));
        float stk = streak * cz * smoothstep(.08,.2,r) * (.15 + r*1.8) * reveal;
        col = mix(col, heat(.38 + .36*flow)*(.95 + .4*uNight), clamp(stk, 0., 1.));
        float spat = smoothstep(.62,.8, fbm(xz*34. + 7.)) * (1. - smoothstep(.1,.2, r)) * smoothstep(.07,.1,r);
        col += vec3(1.,.4,.08) * spat * uRise * 1.2;
        float cr = 1. - smoothstep(${(RK * 0.78).toFixed(3)}, ${RK.toFixed(3)}, r);
        vec3 pool = heat(.56 + .22*fbm(xz*20. + vec2(uT*.7, -uT*.5)) + .08*sin(uT*2. + r*30.)) * (1.25 + .5*uNight);
        float crust2 = smoothstep(.62,.74, fbm(xz*45. - uT*.1))*.6;
        col = mix(col, mix(pool, plateC, crust2), cr*uRise);
        col += vec3(1.,.55,.12) * smoothstep(${(RK * 0.95).toFixed(3)}, ${(RK * 1.2).toFixed(3)}, r) * (1. - smoothstep(${(RK * 1.2).toFixed(3)}, ${(RK * 1.7).toFixed(3)}, r)) * uRise * .5;
        col += vec3(1.,.7,.35) * front * .9;
        col += vec3(1.,.82,.55) * uFlash * (.4 + .6*reveal);
        col += vec3(1.,.5,.15) * uBurst * (1. - smoothstep(.0,.7, r)) * .6;
        // glow scales with the night; the footprint's edge cools to ash
        col *= 1. + (uEmis - 1.)*(inCh + cr*uRise + stk + fis*.5);
        col = mix(col, vec3(.045,.035,.035)*(.4 + .6*sun), smoothstep(.84,1., edge));
        gl_FragColor = vec4(col, 1.);
        ${TAIL}
      }`,
  });
  return {mat, u};
}
