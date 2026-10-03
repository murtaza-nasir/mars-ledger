// Lava Flows (Detailed): one points layer for everything that floats: sparks thrown from the crater on arcs, embers
// lifting off the rivers, lava bombs during the eruption, the ash plume (dark, lit from below) and the monitoring post's
// beacons. Premultiplied blending: sparks and embers add light (alpha 0), ash covers (alpha > 0), so one draw call does both.
import * as THREE from 'three';
import {CRATER_Y} from './LavaGround';

const TAIL = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';
export type LavaBeacon = [number, number, number, number];

export function lavaPointsGeometry(n: {sparks: number; embers: number; ash: number; bombs: number}, beacons: LavaBeacon[], rnd: () => number) {
  const total = n.sparks + n.embers + n.ash + n.bombs + beacons.length;
  const pos = new Float32Array(total * 3), seed = new Float32Array(total * 4), kind = new Float32Array(total);
  let i = 0;
  const put = (k: number, x: number, y: number, z: number, s: number[]) => { pos.set([x, y, z], i * 3); seed.set(s, i * 4); kind[i] = k; i++; };
  for (let s = 0; s < n.sparks; s++) put(0, 0, CRATER_Y, 0, [rnd(), rnd(), rnd(), rnd()]);
  for (let s = 0; s < n.embers; s++) { const a = rnd() * 6.283, r = 0.22 + Math.sqrt(rnd()) * 0.6; put(1, Math.cos(a) * r, 0.03, Math.sin(a) * r, [rnd(), rnd(), rnd(), rnd()]); }
  for (let s = 0; s < n.ash; s++) put(3, 0, CRATER_Y, 0, [rnd(), rnd(), rnd(), rnd()]);
  for (let s = 0; s < n.bombs; s++) put(4, 0, CRATER_Y, 0, [rnd(), rnd(), rnd(), rnd()]);
  for (const b of beacons) put(2, b[0], b[1], b[2], [b[3], rnd(), b[3], rnd()]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 2.4);
  return g;
}

export function lavaPointsMaterial() {
  const u = {uT: {value: 0}, uAge: {value: 99}, uNight: {value: 0}, uPx: {value: 1000}, uOwner: {value: new THREE.Color('#ffffff')}, uLights: {value: 1}};
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `
      uniform float uT, uAge, uNight, uPx, uLights; uniform vec3 uOwner; attribute vec4 aSeed; attribute float aKind;
      varying vec4 vC; varying float vK; varying float vAdd; varying float vS;
      void main(){
        vec3 p = position; float size = 0.; vec3 col = vec3(1.); float alpha = 0.; float add = 1.;
        float burst = uAge > .55 ? exp(-(uAge-.55)*.9) : 0.;           // the eruption's strength, easing off
        float on = smoothstep(.45,.6,uAge);
        if (aKind < .5) { // sparks on arcs
          float T = 1.0 + aSeed.x*1.3; float ph = fract(uT/T + aSeed.y);
          float ang = aSeed.z*6.283; float sp = (.12 + aSeed.w*.36)*(1.+burst*1.8);
          float up = (.75 + aSeed.x*.55)*(1.+burst*1.0);
          p = vec3(cos(ang)*sp*ph, ${CRATER_Y.toFixed(3)} + up*ph - 1.35*ph*ph*(1.+burst*.5), sin(ang)*sp*ph);
          size = .015 + .011*aSeed.w; alpha = (1.-ph)*on*(.7+.3*sin(uT*30.+aSeed.x*40.)) * (.8 + uNight*.4);
          col = mix(vec3(1.,.9,.5), vec3(1.,.28,.04), ph)*(1.2+uNight);
        } else if (aKind < 1.5) { // embers lifting off the rivers
          float T = 2.4 + aSeed.x*2.6; float ph = fract(uT/T + aSeed.y);
          p.y = .03 + ph*(.3+aSeed.z*.34); p.x += sin(uT*.8+aSeed.w*20.)*.05*ph; p.z += cos(uT*.7+aSeed.x*20.)*.05*ph;
          size = .011 + .008*aSeed.z; alpha = sin(3.14*ph)*(.5+.5*sin(uT*9.+aSeed.w*40.))*smoothstep(1.,1.8,uAge)*(.6+.7*uNight);
          col = vec3(1.,.5,.12)*(1.1+uNight);
        } else if (aKind < 2.5) { // post beacons: red warning and owner
          float blink = step(0., sin(uT*3.4 + aSeed.x*6.283));
          size = .06; alpha = (.35 + .65*blink)*uLights*(.6 + .5*uNight);
          col = aSeed.z > .5 ? uOwner*1.5 + .2 : vec3(1.,.2,.1);
        } else if (aKind < 3.5) { // the ash plume: big, slow, dark, lit orange near the vent
          float T = 6. + aSeed.x*5.; float ph = fract(uT/T + aSeed.y);
          float ang = aSeed.w*6.283 + ph*1.1;
          float rise = ph*(1.05 + burst*1.0);
          p = vec3(cos(ang)*(.02 + ph*.16*aSeed.z), ${CRATER_Y.toFixed(3)} + rise, sin(ang)*(.02 + ph*.16*aSeed.z));
          p.x += ph*ph*.62 + sin(uT*.3 + aSeed.x*9.)*.03*ph; p.z -= ph*.12;
          size = (.12 + ph*.46)*(1.+burst*.6);
          float life = sin(3.14*ph);
          alpha = life*(.62 + burst*.2)*smoothstep(.4,.55,uAge); add = 0.;
          vec3 hotc = vec3(.42,.13,.04)*(.8 + uNight*1.6);
          vec3 cold = vec3(.07,.065,.07)*(1.-uNight*.5);
          col = mix(hotc, cold, smoothstep(.0,.3,ph)) * (alpha > 0. ? 1. : 0.);
        } else { // lava bombs: heavy blobs lobbed high during the eruption
          float T = 2.6 + aSeed.x*1.4; float ph = fract(uT/T + aSeed.y*7.);
          float ang = aSeed.z*6.283; float sp = .35 + aSeed.w*.45;
          p = vec3(cos(ang)*sp*ph, ${CRATER_Y.toFixed(3)} + (1.7 + aSeed.x)*ph - 2.4*ph*ph*(1.7+aSeed.x)*.5, sin(ang)*sp*ph);
          p.y = max(p.y, .02);
          size = .03 + .02*aSeed.y; alpha = step(ph, .98)*burst*smoothstep(.45,.7,uAge);
          col = mix(vec3(1.,.7,.2), vec3(.7,.1,.02), ph)*(1.5 + uNight);
        }
        vC = vec4(col, alpha); vK = aKind; vAdd = add; vS = aSeed.x*37.;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float sc = length(modelMatrix[0].xyz);
        gl_PointSize = max(size * sc * uPx * .5 * projectionMatrix[1][1] / gl_Position.w, 1.);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vC; varying float vK; varying float vAdd; varying float vS;
      float hh(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float nn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hh(i),hh(i+vec2(1,0)),f.x), mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float d = length(gl_PointCoord - .5)*2.; if (d > 1.) discard;
        if (vK > 2.5 && vK < 3.5) d += (nn(gl_PointCoord*5. + vS) - .5)*.7*d;
        if (d > 1.) discard;
        float a = vK < 1.5 ? pow(1.-d, 1.5) : (vK < 2.5 ? pow(1.-d, 2.2) + step(d,.25) : (vK < 3.5 ? pow(1.-d, 1.25) : pow(1.-d, .8)));
        float al = vC.a*a;
        gl_FragColor = vec4(vC.rgb*al, al*(1. - vAdd));
        ${TAIL}
      }`,
  });
  return {mat, u};
}
