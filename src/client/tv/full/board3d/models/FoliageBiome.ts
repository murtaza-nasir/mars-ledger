// Ecological Zone parts: stepped terraces with nests and boulders, a shimmering lake, a glass biome dome, and a herd.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {NOISE, hexGround, tint, type Fx} from './FoliageKit';

/** Heights of the two terraces (in units of R). */
export const TER_A = 0.05, TER_B = 0.11, RAD_A = 0.92, RAD_B = 0.6;

export function terraceGeo(R: number, rnd: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const flat = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
  const tier = (r: number, y0: number, y1: number) => {
    const wall = new THREE.CylinderGeometry(r, r * 1.025, y1 - y0, 6, 1, true); wall.translate(0, (y0 + y1) / 2, 0);
    parts.push(tint(flat(wall), '#a08f78', (_x, y, _z, _nx, _ny, _nz, c) => { c.multiplyScalar(0.55 + 0.6 * ((y - y0) / (y1 - y0))); }));
    const top = hexGround(r, 3); top.translate(0, y1, 0);
    parts.push(tint(flat(top), '#3f8f38', (x, _y, z, _a, _b, _c, c) => { const d = Math.hypot(x, z) / r; c.lerp(new THREE.Color('#78b84a'), Math.max(0, d - 0.5) * 0.8); }));
  };
  tier(RAD_A * R, 0, TER_A * R);
  tier(RAD_B * R, TER_A * R, TER_B * R);
  // nests on the outer terrace: a twig ring and three pale eggs
  const nestAt: Array<[number, number]> = [[-0.62, -0.28], [0.58, -0.36], [-0.5, 0.52]];
  nestAt.forEach(([nx, nz]) => {
    const ring = new THREE.TorusGeometry(R * 0.05, R * 0.014, 4, 9); ring.rotateX(Math.PI / 2); ring.translate(nx * R, TER_A * R + R * 0.008, nz * R);
    parts.push(tint(flat(ring), '#6b4a2a'));
    for (let i = 0; i < 3; i++) {
      const e = new THREE.SphereGeometry(R * 0.017, 5, 4); e.scale(1, 1.25, 1);
      const a = i * 2.1 + rnd();
      e.translate(nx * R + Math.cos(a) * R * 0.018, TER_A * R + R * 0.018, nz * R + Math.sin(a) * R * 0.018);
      parts.push(tint(flat(e), '#efe6cf'));
    }
  });
  // two boulders
  ([[0.72, 0.1, 0.07], [-0.2, -0.76, 0.06]] as const).forEach(([bx, bz, br]) => {
    const b = new THREE.IcosahedronGeometry(R * br, 0); b.scale(1.2, 0.7, 1); b.translate(bx * R, TER_A * R + R * br * 0.4, bz * R);
    parts.push(tint(flat(b), '#8d8478'));
  });
  parts.forEach((p) => { for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'color'].includes(k)) p.deleteAttribute(k); });
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** A small deer-like animal, one unit long, facing +z, feet on y = 0 (about 90 triangles). */
let _animal: THREE.BufferGeometry | null = null;
export function animalGeo(): THREE.BufferGeometry {
  if (_animal) return _animal;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); parts.push(g.index ? g.toNonIndexed() : g); };
  const body = new THREE.SphereGeometry(0.5, 7, 5); body.scale(0.42, 0.42, 1); body.translate(0, 0.5, 0); add(body);
  const neck = new THREE.CylinderGeometry(0.09, 0.14, 0.5, 5, 1, true); neck.rotateX(0.5); neck.translate(0, 0.78, 0.46); add(neck);
  const head = new THREE.SphereGeometry(0.15, 6, 4); head.scale(0.9, 0.9, 1.4); head.translate(0, 1.0, 0.6); add(head);
  for (const [lx, lz] of [[-0.12, 0.3], [0.12, 0.3], [-0.12, -0.3], [0.12, -0.3]]) {
    const l = new THREE.CylinderGeometry(0.035, 0.03, 0.4, 4, 1, true); l.translate(lx, 0.2, lz); add(l);
  }
  const tail = new THREE.ConeGeometry(0.06, 0.18, 4); tail.rotateX(-2.2); tail.translate(0, 0.6, -0.52); add(tail);
  _animal = mergeGeometries(parts, false)!;
  _animal.computeVertexNormals();
  return _animal;
}

/** A lake: an ellipse with moving ripples, sun glints, a foam rim and a night glow. */
export function lakeMaterial(fx: Fx, tintHex = '#1f8fa8'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uTint: {value: new THREE.Color(tintHex)}},
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `${NOISE}
      uniform float uT, uAge, uNight; uniform vec3 uTint; varying vec2 vP;
      void main(){
        float r = length(vP);
        float edge = 1.-smoothstep(.9,1.,r);
        float w = fbm(vP*3.+vec2(uT*.07,-uT*.05))*.9 + .3*sin(r*22.-uT*1.8) + .25*sin(vP.x*14.+uT*1.3+vP.y*9.);
        vec3 deep = uTint*.35, shallow = uTint*1.25 + vec3(.1,.18,.12);
        vec3 c = mix(shallow, deep, smoothstep(.35,.95,r) * .8 + .1*w);
        float gl = pow(max(0., sin(vP.x*47.+w*6.+uT*2.3) * sin(vP.y*53.-uT*1.9+w*5.)), 14.);
        c += vec3(1.,.97,.85)*gl*1.4*(1.-uNight*.7);
        float foam = smoothstep(.8,.93,r)*(1.-smoothstep(.95,1.,r));
        c = mix(c, vec3(.85,.97,.9), foam*.55);
        float day = mix(1., .38, uNight);
        c = c*day + vec3(.1,.9,.75)*uNight*(.18 + .5*pow(.5+.5*sin(r*16.-uT*1.5+w*3.), 5.)) * (1.-r*.6);
        float grow = clamp((uAge-.5)/.9, 0., 1.);
        gl_FragColor = vec4(c, edge*.92*grow);
      }`,
  });
}

/** A glass biome dome: fresnel sheen, a lattice of ribs, a travelling glint band and a pop flash when it appears. */
export function domeMaterial(fx: Fx, glass: THREE.ColorRepresentation = '#a8f0ff'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uGlass: {value: new THREE.Color(glass)}},
    vertexShader: `${NOISE}
      uniform float uAge; varying vec3 vN, vV, vU;
      void main(){
        float g = clamp((uAge-.85)/.9, 0., 1.); float k = max(easeBack(g), .0001);
        vec3 p = position; p *= k; vU = normalize(position);
        vec4 mv = modelViewMatrix*vec4(p,1.);
        vN = normalize(normalMatrix*normal); vV = -mv.xyz;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform float uT, uAge, uNight; uniform vec3 uGlass; varying vec3 vN, vV, vU;
      float ln(float x, float w){ x = abs(fract(x)-.5)*2.; return smoothstep(1.-w, 1., x); }
      void main(){
        float f = pow(1.-abs(dot(normalize(vN), normalize(vV))), 2.2);
        float az = atan(vU.x, vU.z)/6.2832, pol = acos(clamp(vU.y,0.,1.))/1.5708;
        float ribs = ln(az*12.+.5, .08/(.25+pol)) * smoothstep(.0,.08,pol);
        float rings = ln(pol*4., .07);
        float lat = max(ribs, rings);
        float sweep = pow(.5+.5*sin(vU.y*6. + az*18.85 - uT*1.3), 10.);
        float pop = exp(-pow((uAge-1.7)*5., 2.));
        float a = .035 + .6*f + .55*lat*(.35+.65*f) + .5*sweep*(.25+f) + pop*.22*(.3+f) + uNight*.1*f;
        a *= smoothstep(.85, 1.2, uAge);
        vec3 c = uGlass*(1.+uNight*.4) + vec3(.2,.35,.3)*pop;
        gl_FragColor = vec4(c*a*(.75 + .25*(1.-uNight)), 1.);
      }`,
  });
}
