// Materials for the Detailed living tiles: the vegetation material (layered wind, staged growth, leaf speckle, bark,
// moss-streaked rock, dappled light, dew by day, bioluminescence by night) and the ground material (moss, litter,
// flowers, a painted stream and pond with ripples / caustics / glints / lily pads, hex rim in the owner's colour).
import * as THREE from 'three';
import {NOISE, type Fx} from '../FoliageKit';

function fxUniforms(sh: {uniforms: Record<string, THREE.IUniform>}, fx: Fx) {
  sh.uniforms.uT = fx.uT; sh.uniforms.uAge = fx.uAge; sh.uniforms.uNight = fx.uNight; sh.uniforms.uR = fx.uR; sh.uniforms.uSway = fx.uSway;
}

/** shared dapple pattern, used by leaves, bark and the ground so the light falls the same on all three */
const DAPPLE = /* glsl */`
float dapple(vec2 q, float t){ float a = fbm(q*5.5 + vec2(t*.035, -t*.02)); float b = fbm(q*11. + vec2(-t*.05, t*.03) + 4.); return smoothstep(.34,.72, a*.65 + b*.45); }
`;

export type VegOpts = {owner: THREE.ColorRepresentation; bio?: THREE.ColorRepresentation; tint?: number; key: string};
export function vegMaterial(fx: Fx, o: VegOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.84, metalness: 0, vertexColors: true, side: THREE.DoubleSide});
  const own = new THREE.Color(o.owner), bio = new THREE.Color(o.bio ?? '#46ffc0');
  m.onBeforeCompile = (sh) => {
    fxUniforms(sh, fx);
    sh.uniforms.uOwner = {value: own}; sh.uniforms.uBio = {value: bio}; sh.uniforms.uTint = {value: o.tint ?? 0};
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aO; attribute vec3 aC; attribute vec4 aI;
        uniform float uT, uAge, uNight, uR, uSway;
        varying vec4 vI; varying vec3 vL; varying float vHH, vNy;
        ${NOISE}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float kind = aI.x, ph = aI.y, H = max(aI.z, 1e-3), dl = aI.w;
        float dd = length(aO.xz)/uR;
        float start = .08 + dd*.7 + dl*.28;
        float gx = clamp((uAge - start)/.95, 0., 1.);
        float gk = max(easeBack(gx), .0001);
        float kw = gk > 1. ? 1. + (gk-1.)*.35 : gk;
        bool leafy = (kind > .5 && kind < 1.5) || (kind > 2.5 && kind < 4.5);
        if (leafy) {
          float lx = clamp((uAge - start - .6)/.7, 0., 1.);
          float lk = max(easeBack(lx), .0001);
          vec3 cg = aO + (aC - aO)*vec3(kw, gk, kw);
          transformed = cg + (position - aC)*lk;
        } else {
          transformed = aO + (position - aO)*vec3(kw, gk, kw);
        }
        float hh = clamp((position.y - aO.y)/H, 0., 1.);
        vec3 W = vec3(0.);
        float g1 = sin(uT*.9 + aO.x*5. + aO.z*3.) + .5*sin(uT*2.1 + aO.x*11. - aO.z*7. + ph*6.28);
        if (kind < 1.5 || kind > 2.5) {
          // layer 1: the whole trunk leans with the gust
          W.x += g1*.026*H*hh*hh; W.z += cos(uT*1.3 + ph*6.28 + aO.x*4.)*.016*H*hh*hh;
          // layer 2: limbs and crowns swing on their own phase
          float away = clamp(length(position.xz - aO.xz)/H*3., 0., 1.);
          W += vec3(sin(uT*2.2 + ph*6.28 + position.y*9.), .35*sin(uT*3.1 + ph*3.), cos(uT*1.9 + ph*5. + position.x*9.))*.011*H*away*hh;
          // layer 3: leaf flutter
          if (leafy) W += vec3(sin(position.x*67./H*.4 + uT*5.3 + ph*9.), cos(position.z*61./H*.4 + uT*4.7), sin(position.y*73./H*.4 + uT*6.1))*.0065*H;
          if (kind > 6.5 && kind < 7.5 || kind > 8.5) W.x += sin(uT*2.4 + aO.x*10. + ph*6.28 + hh*3.)*.1*H*hh*hh;
        }
        transformed += W*uSway;
        vI = aI; vL = position; vHH = hh; vNy = normal.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uNight, uR, uTint; uniform vec3 uOwner, uBio;
        varying vec4 vI; varying vec3 vL; varying float vHH, vNy;
        ${NOISE}${DAPPLE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float kd = vI.x;
        vec2 lq = vL.xz/uR;
        float dap = dapple(lq, uT);
        float hz = hash21(floor(vL.xz/uR*160.) + floor(vL.y/uR*160.)*7.3);
        if (kd > .5 && kd < 1.5) {
          vec3 cl = floor(vL/uR*vec3(150.,130.,150.));
          float h = hash21(cl.xz + cl.y*17.3 + vI.y*91.);
          diffuseColor.rgb *= .78 + .42*h;
          if (h > .975 && vColor.g > vColor.b*.8) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.62,.42,.1)*(.6+h), .22);
          diffuseColor.rgb *= mix(.5, 1.15, smoothstep(0., .75, vHH));
          diffuseColor.rgb *= mix(1., mix(.62, 1.3, dap), (1.-uNight*.8)*smoothstep(.1,.6,vHH));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb.gbr*.9 + vec3(.0,.05,.06), uTint);
        } else if (kd < .5) {
          float st = vn(vec2((vL.x + vL.z)*vec2(1.).x/uR*310., vL.y/uR*38.));
          float st2 = vn(vec2((vL.z - vL.x)/uR*260., vL.y/uR*70.));
          diffuseColor.rgb *= .55 + .65*st*(.6+.5*st2);
          diffuseColor.rgb *= mix(1., mix(.55, 1.2, dap), (1.-uNight*.8)*.8);
        } else if (kd < 2.5) {
          float n1 = fbm(vL.xz/uR*40. + vL.y/uR*25.), n2 = vn(vL.xz/uR*180. + vL.y/uR*90.);
          float band = vn(vec2(vL.y/uR*55. + n1*1.3, 3.));
          diffuseColor.rgb *= .6 + .5*n1 + .25*n2;
          diffuseColor.rgb *= .85 + .3*band;
          float mo = smoothstep(.2, .6, vNy + (n1-.5)*.7 + (n2-.5)*.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.55,.95,.35) + vec3(.01,.05,.0), mo*.35);
          diffuseColor.rgb *= mix(1., mix(.62, 1.25, dap), (1.-uNight*.8)*.8);
        } else if (kd > 8.5) {
          diffuseColor.rgb = uOwner*(.75 + .35*hz);
        } else if (kd > 6.5 && kd < 7.5) {
          diffuseColor.rgb *= mix(.65, 1.15, hz);
          diffuseColor.rgb *= mix(1., mix(.65, 1.3, dap), (1.-uNight*.8)*.8);
        }
        if (kd < 7.5 && kd > -.5 && !(kd > 2.5 && kd < 6.5)) {
          float lum = dot(diffuseColor.rgb, vec3(.3,.55,.15));
          // night: a moonlit teal-green (like Classic's luminous night forest), not a grey silhouette
          vec3 moon = mix(diffuseColor.rgb, vec3(lum)*vec3(.5,1.,.85), .35);
          diffuseColor.rgb = mix(diffuseColor.rgb, moon*1.05, uNight);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float k2 = vI.x, nt = uNight;
          if (k2 < 3. ) { float fr = pow(1. - abs(dot(normalize(normal), normalize(vViewPosition))), 3.); totalEmissiveRadiance += vec3(.2,.36,.55)*fr*nt*.4*(.4 + vHH); }
          if (k2 > .5 && k2 < 1.5) {
            vec3 cl2 = floor(vL/uR*vec3(70.,64.,70.)); float hc = hash21(cl2.xz + cl2.y*13.1 + vI.y*57.);
            vec3 fc = fract(vL/uR*vec3(70.,64.,70.)) - .5; float spot = smoothstep(.5,.1,length(fc));
            float blink = .5 + .5*sin(uT*(1.3 + hc*2.) + hc*80.);
            float dew = step(.99, hc)*spot*pow(blink, 3.)*(1.-nt)*smoothstep(.2,.7,vHH);
            float teal = smoothstep(-.02, .12, vColor.b - vColor.r*.95);
            float bioSpot = step(.985, hash21(cl2.xz*1.7 + cl2.y*9.1 + 5.))*spot*(.35 + .65*pow(.5 + .5*sin(uT*1.2 + hc*70.), 2.));
            totalEmissiveRadiance += vColor.rgb*(.1*(1. - nt) + .015*nt)*(.35 + vHH);
            totalEmissiveRadiance += vec3(1., .97, .85)*dew*1.5;
            totalEmissiveRadiance += uBio*(bioSpot*1.1 + teal*(.06 + .03*sin(uT*.8 + vI.y*20.))*smoothstep(.3,.9,vHH))*nt;
          } else if (k2 > 2.5 && k2 < 3.5) {
            totalEmissiveRadiance += vColor.rgb*(.12 + .5*nt);
          } else if (k2 > 3.5 && k2 < 4.5) {
            float pulse = .6 + .4*sin(uT*1.1 + vI.y*30.);
            totalEmissiveRadiance += vColor.rgb*(.08 + 1.2*nt*pulse);
          } else if (k2 > 4.5 && k2 < 5.5) {
            totalEmissiveRadiance += uOwner*(1.4 + 1.6*nt)*(.88 + .12*sin(uT*2.4));
          } else if (k2 > 5.5 && k2 < 6.5) {
            float rune = step(.6, vn(vec2(vL.y/uR*46., (vL.x+vL.z)/uR*9.))) * step(.55, vn(vec2(vL.y/uR*21. + 5., (vL.x - vL.z)/uR*14.)));
            totalEmissiveRadiance += uOwner*rune*(.25 + 1.8*nt)*(.8 + .2*sin(uT*1.6 + vL.y*40.));
          } else if (k2 > 8.5) {
            totalEmissiveRadiance += uOwner*(.3 + .7*nt);
          } else if (k2 > 7.5) {
            totalEmissiveRadiance += vColor.rgb*.05;
          }
        }`);
  };
  m.customProgramCacheKey = () => 'vegD1';
  void o.key;
  return m;
}

// ---- the ground ---------------------------------------------------------------------------------------------------
export type Water = {pond: [number, number, number, number]; path: Array<[number, number]>; width: number};
export type GroundOpts = {
  c1: THREE.ColorRepresentation; c2: THREE.ColorRepresentation; c3: THREE.ColorRepresentation;
  owner: THREE.ColorRepresentation; bio?: THREE.ColorRepresentation; water?: Water; waterColor?: THREE.ColorRepresentation;
  flowers?: THREE.ColorRepresentation[]; seed: number; spread?: boolean; rise?: boolean; rimAt?: number; rim?: number; litter?: number;
  pads?: boolean; moss?: number; key: string;
};
/** distance (in R units, negative inside) to the pond and stream: mirrors the shader, so trees stay out of the water */
export function waterDist(w: Water | undefined, x: number, z: number): number {
  if (!w) return 9;
  const [cx, cz, rx, rz] = w.pond;
  const de = (Math.hypot((x - cx) / rx, (z - cz) / rz) - 1) * Math.min(rx, rz);
  let ds = 1e3;
  for (let i = 0; i + 1 < w.path.length; i++) {
    const [ax, az] = w.path[i], [bx, bz] = w.path[i + 1];
    const pax = x - ax, paz = z - az, bax = bx - ax, baz = bz - az;
    const h = Math.max(0, Math.min(1, (pax * bax + paz * baz) / (bax * bax + baz * baz)));
    ds = Math.min(ds, Math.hypot(pax - bax * h, paz - baz * h));
  }
  return Math.min(de, ds - w.width);
}

export function groundMaterial(fx: Fx, o: GroundOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.93, metalness: 0});
  const C = (c: THREE.ColorRepresentation) => new THREE.Color(c);
  const path: THREE.Vector2[] = [];
  const wpath = o.water?.path ?? [[0, 0], [0, 0]];
  for (let i = 0; i < 6; i++) { const p = wpath[Math.min(i, wpath.length - 1)]; path.push(new THREE.Vector2(p[0], p[1])); }
  const fl = o.flowers ?? ['#fff0a0', '#ffb0d8', '#ffffff'];
  const flags = [o.spread ? 'S' : '', o.rise ? 'R' : '', o.water ? 'W' : '', o.pads ? 'P' : ''].join('');
  m.onBeforeCompile = (sh) => {
    fxUniforms(sh, fx);
    Object.assign(sh.uniforms, {
      uC1: {value: C(o.c1)}, uC2: {value: C(o.c2)}, uC3: {value: C(o.c3)}, uOwner: {value: C(o.owner)}, uBio: {value: C(o.bio ?? '#46ffc0')},
      uPath: {value: path}, uPond: {value: new THREE.Vector4(...(o.water?.pond ?? [9, 9, 0.01, 0.01]))}, uPW: {value: o.water?.width ?? 0.01},
      uWC: {value: C(o.waterColor ?? '#2a9bb0')}, uF0: {value: C(fl[0])}, uF1: {value: C(fl[1 % fl.length])}, uF2: {value: C(fl[2 % fl.length])},
      uSeed: {value: o.seed}, uRimAt: {value: o.rimAt ?? 0.866}, uRim: {value: o.rim ?? 0.9}, uLit: {value: o.litter ?? 0.5}, uMoss: {value: o.moss ?? 1},
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aK;
        uniform float uT, uAge, uR;
        varying vec2 vP; varying float vK, vY;
        ${NOISE}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vP = position.xz; vK = aK; vY = position.y;
        ${o.spread ? 'float sp = clamp(uAge/.8, 0., 1.); sp = 1. - pow(1. - sp, 3.); transformed.xz *= sp;' : ''}
        ${o.rise ? 'float rz = clamp((uAge - position.y/uR*.5)/.7, 0., 1.); transformed.y *= max(easeBack(rz), 0.);' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uAge, uNight, uR, uSeed, uRimAt, uRim, uLit, uMoss;
        uniform vec3 uC1, uC2, uC3, uOwner, uBio, uWC, uF0, uF1, uF2;
        uniform vec2 uPath[6]; uniform vec4 uPond; uniform float uPW;
        varying vec2 vP; varying float vK, vY;
        float gWater = 0., gGlint = 0., gRing = 0., gBank = 0.;
        ${NOISE}${DAPPLE}
        float wdist(vec2 q){
          vec2 e = (q - uPond.xy)/uPond.zw;
          float de = (length(e) - 1.)*min(uPond.z, uPond.w);
          float ds = 1e3;
          for (int i = 0; i < 5; i++) { vec2 a = uPath[i], b = uPath[i+1]; vec2 pa = q - a, ba = b - a; float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-5), 0., 1.); ds = min(ds, length(pa - ba*h)); }
          float dsw = ds - uPW*(.85 + .3*sin(q.x*9. + q.y*7.));
          float k = .035; float h2 = clamp(.5 + .5*(dsw - de)/k, 0., 1.);
          return mix(dsw, de, h2) - k*h2*(1. - h2);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q = vP/uR;
        vec3 gc;
        if (vK > .5) {
          float n1 = fbm(vec2(q.x*9., vY/uR*6.) + uSeed), n2 = fbm(q*30. + vY/uR*20.);
          float band = floor(vY/uR*95. + n1*2.2);
          float bh = hash21(vec2(band, 3.7));
          gc = mix(vec3(.38,.31,.24), vec3(.5,.43,.34), bh)*(.72 + .55*n2);
          gc = mix(gc, vec3(.2,.34,.14)*(.8+.4*n2), smoothstep(.55,.8,n1)*.5);
        } else {
          float n1 = fbm(q*4. + uSeed), n2 = fbm(q*15. + uSeed*2.), n3 = fbm(q*58.);
          gc = mix(uC1, uC2, smoothstep(.25,.75,n1)); gc = mix(gc, uC3, smoothstep(.52,.85,n2)*.72*uMoss);
          gc *= .78 + .44*n3;
          float lit = smoothstep(.6, .72, fbm(q*6.5 + 11. + uSeed))*uLit;
          gc = mix(gc, vec3(.3,.19,.1)*(.65 + .7*n3), lit*.7);
          // grass tufts catch the light
          float tf = step(.9, vn(q*140.))*smoothstep(.35,.65,n2);
          gc += vec3(.05,.1,.02)*tf;
          // flowers: three scales, three colours
          vec2 fq = q*46.; vec2 fi = floor(fq); float fh = hash21(fi + uSeed);
          float fd = length(fract(fq) - .5 - (vec2(hash21(fi+3.), hash21(fi+7.)) - .5)*.4);
          float fl = step(.955, fh)*smoothstep(.2,.1,fd);
          float fk = fract(fh*29.);
          vec3 fcol = fk < .34 ? uF0 : (fk < .67 ? uF1 : uF2);
          gc = mix(gc, fcol, fl*(1. - smoothstep(.3,.5,lit)));
          // pebbles in the litter
          vec2 pq = q*90.; float ph2 = hash21(floor(pq)); float pb = step(.93, ph2)*smoothstep(.34,.2,length(fract(pq)-.5))*lit;
          gc = mix(gc, vec3(.45,.42,.38)*(.7+.5*ph2), pb);
          // dapple
          gc *= mix(1., mix(.58, 1.28, dapple(q, uT)), 1. - uNight*.8);
          ${o.water ? `
          float wd = wdist(q);
          float bank = smoothstep(.055, .0, wd)*step(0., wd);
          gc = mix(gc, gc*vec3(.45,.4,.33), bank*.8);
          gBank = bank;
          if (wd < 0.) {
            gWater = 1.;
            float depth = clamp(-wd/.1, 0., 1.);
            vec3 shal = uWC*1.05 + vec3(.03,.07,.04), deep = uWC*.3;
            vec3 wc = mix(shal, deep, smoothstep(0.,1.,depth));
            vec2 fq2 = q*18. + vec2(uT*.22, -uT*.16);
            float rip = fbm(fq2);
            wc *= .82 + .36*rip;
            float ca = pow(max(0., sin(q.x*64. + fbm(q*9. + uT*.15)*6.)*sin(q.y*64. + fbm(q*9. - uT*.12 + 3.)*6.)), 6.);
            wc += vec3(.3,.7,.55)*ca*(1.-depth)*.3*(1. - uNight*.6);
            ${o.pads ? `
            vec2 lq = q*21.; vec2 li = floor(lq); float lh = hash21(li + 9.);
            vec2 lc = fract(lq) - .5; float ld = length(lc);
            float pad = step(.8, lh)*step(ld, .3 + .06*sin(uT*.5 + lh*30.))*step(-wd, .3)*step(.012, -wd);
            float notch = step(.18, abs(atan(lc.y, lc.x) - lh*6.));
            pad *= notch;
            wc = mix(wc, vec3(.12,.4,.14)*(.75 + .5*hash21(li)), pad);
            float lf = step(.92, lh)*step(ld, .1)*pad;
            wc = mix(wc, vec3(1.,.55,.75), lf);` : ''}
            // shore foam
            float foam = smoothstep(-.012, 0., wd)*.4*(.5 + .5*sin(uT*1.4 + q.x*40. + q.y*30.));
            wc = mix(wc, vec3(.85,.95,.9), foam);
            // rings: a drop lands somewhere on the pond every few seconds
            float rg = 0.;
            for (int i = 0; i < 3; i++) {
              float fi2 = float(i);
              float tt = uT*.28 + fi2*.37; float cyc = floor(tt), ph = fract(tt);
              vec2 cc = uPond.xy + (vec2(hash21(vec2(cyc, fi2)), hash21(vec2(fi2, cyc + 9.))) - .5)*uPond.zw*1.3;
              float d = length(q - cc);
              rg += exp(-pow((d - ph*.1)*70., 2.))*(1. - ph);
            }
            gRing = rg;
            gGlint = pow(max(0., sin(q.x*83. + rip*6. + uT*2.1)*sin(q.y*91. - uT*1.7 + rip*5.)), 14.);
            gc = wc;
          }` : ''}
        }
        diffuseColor.rgb *= gc;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .12, gWater);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 bq = vP/uR*95.; float b0 = vn(bq), bx = vn(bq + vec2(.7,0.)), bz = vn(bq + vec2(0.,.7));
          vec3 bw = vec3(b0 - bx, 0., b0 - bz)*(vK > .5 ? .5 : .32)*(1. - gWater);
          bw += gWater*vec3(sin(vP.x/uR*130. + uT*1.6), 0., cos(vP.y/uR*120. - uT*1.3))*.06;
          normal = normalize(normal + (viewMatrix*vec4(bw, 0.)).xyz);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 q2 = vP/uR;
          vec2 cb = fract(q2*34.) - .5; float bf = step(.955, hash21(floor(q2*34.) + 3.))*smoothstep(.34,.1,length(cb))*(.5 + .5*sin(uT*1.4 + hash21(floor(q2*34.))*40.));
          totalEmissiveRadiance += uBio*bf*uNight*.8*(1. - gWater)*step(vK, .5);
          float vein = fbm(q2*7. + uSeed*.3); float vg = smoothstep(.035, 0., abs(vein - .5));
          vg += .6*smoothstep(.03, 0., abs(fbm(q2*13. + 5.) - .5));
          totalEmissiveRadiance += uBio*vg*uNight*(.09 + .05*sin(uT*.9 + vein*30.))*(1. - gWater)*step(vK, .5)*(1. - smoothstep(.62, .85, hexD(q2)*1.0)*0.);
          float dw = step(.988, hash21(floor(q2*70.) + floor(uT*2.)*.37))*smoothstep(.4,.1,length(fract(q2*70.) - .5));
          totalEmissiveRadiance += vec3(1.,.97,.85)*dw*(1. - uNight)*.4*(1.-gWater)*step(vK,.5);
          totalEmissiveRadiance += vec3(1.,.97,.85)*gGlint*.7*(1. - uNight*.75)*gWater;
          totalEmissiveRadiance += (uBio*.8 + vec3(.1,.5,.7))*gWater*uNight*(.18 + .5*pow(.5 + .5*sin(length(q2 - uPond.xy)*30. - uT*1.5), 4.));
          totalEmissiveRadiance += vec3(.7,.95,1.)*gRing*.22*gWater;
          float hd = hexD(q2); float rim = smoothstep(uRimAt - .045, uRimAt - .01, hd)*(1. - smoothstep(uRimAt - .01, uRimAt, hd));
          totalEmissiveRadiance += uOwner*rim*uRim*(.35 + .3*uNight)*(.85 + .15*sin(uT*2.1))*step(vK, .5);
          float rr = (uAge - .1); float rg2 = exp(-pow((length(q2) - rr)*14., 2.))*(1. - smoothstep(1., 1.7, uAge));
          totalEmissiveRadiance += vec3(.4,1.,.5)*rg2*.3*step(vK,.5);
        }`);
  };
  m.customProgramCacheKey = () => 'grdD1' + flags;
  void o.key;
  return m;
}

export function addKAttr(g: THREE.BufferGeometry, k = 0): THREE.BufferGeometry {
  const n = g.getAttribute('position').count, a = new Float32Array(n).fill(k);
  g.setAttribute('aK', new THREE.BufferAttribute(a, 1));
  return g;
}
