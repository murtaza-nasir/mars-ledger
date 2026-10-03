// Natural Preserve parts: moss-streaked rock outcrops, a standing-stone beacon with a ring of menhirs, and a soft beam.
import * as THREE from 'three';
import {mergeGeometries, mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {NOISE, tint, type Fx} from './FoliageKit';

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const m = mergeVertices(g.index ? g : g.clone(), 1e-4);
  m.computeVertexNormals();
  return m.toNonIndexed();
}
const mossy = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color) => {
  void x; void z; void nx; void nz;
  const up = Math.max(0, Math.min(1, (ny - 0.35) * 2.2));
  c.lerp(new THREE.Color('#4c7a2e'), up * 0.85).multiplyScalar(0.7 + Math.min(1, y * 3) * 0.4);
};

export const ROCK_SPOTS: Array<[number, number, number, number]> = [
  [-0.6, 0.4, 0.15, 1.5], [-0.48, 0.5, 0.09, 1.0], [0.55, 0.38, 0.14, 1.3], [0.45, 0.48, 0.08, 0.9], [0.04, 0.72, 0.12, 1.6], [-0.52, -0.4, 0.12, 1.3], [0.62, -0.2, 0.1, 1.0],
];

/** Rock outcrops, the beacon stone and a ring of menhirs, merged into one geometry with vertex colours. */
export function outcropGeo(R: number, rnd: () => number, beaconH: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rock = (x: number, z: number, r: number, sy: number, tone: string) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const k = 1 + (Math.sin(vx * 9 + vz * 7) * Math.cos(vy * 8 - vx * 5) * 0.28);
      p.setXYZ(i, vx * k, Math.max(vy * k * sy, -r * 0.2), vz * k);
    }
    g.translate(x, r * 0.25, z);
    parts.push(tint(clean(g), tone, mossy));
  };
  // outcrops hug the rim, leaving the middle clear
  const spots = ROCK_SPOTS;
  spots.forEach(([x, z, r, sy], i) => rock(x * R, z * R, r * R, sy, i % 2 ? '#8c8478' : '#74695e'));
  // the beacon stone: a tapered four-sided obelisk on a stepped base, topped by a small pyramid
  const base = new THREE.CylinderGeometry(R * 0.14, R * 0.16, R * 0.05, 6, 1); base.translate(0, R * 0.025, 0);
  parts.push(tint(clean(base), '#6f675c', mossy));
  const ob = new THREE.CylinderGeometry(R * 0.035, R * 0.07, beaconH, 4, 1); ob.rotateY(Math.PI / 4); ob.translate(0, R * 0.05 + beaconH / 2, 0);
  parts.push(tint(clean(ob), '#a9b3ac', (x, y, z, nx, ny, nz, c) => { void x; void z; void nx; void nz; void ny; c.multiplyScalar(0.55 + Math.min(1, y / (beaconH + R * 0.05)) * 0.7); }));
  const tip = new THREE.ConeGeometry(R * 0.035, R * 0.08, 4); tip.rotateY(Math.PI / 4); tip.translate(0, R * 0.05 + beaconH + R * 0.04, 0);
  parts.push(tint(clean(tip), '#d8d2c0'));
  // a ring of small menhirs round the clearing
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.3, r = R * 0.33;
    const m = new THREE.CylinderGeometry(R * 0.016, R * 0.03, R * (0.1 + rnd() * 0.07), 4, 1); m.rotateY(rnd() * 3); m.rotateZ((rnd() - 0.5) * 0.25);
    m.translate(Math.cos(a) * r, R * 0.06, Math.sin(a) * r);
    parts.push(tint(clean(m), '#8a8276', mossy));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** A soft beam of light rising from the beacon: bands drift upward, edges fade, a flash when it ignites. */
export function beamMaterial(fx: Fx, color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: {uT: fx.uT, uAge: fx.uAge, uNight: fx.uNight, uCol: {value: new THREE.Color(color)}},
    vertexShader: `${NOISE}
      uniform float uAge; varying vec3 vN, vV; varying float vY;
      void main(){
        float g = clamp((uAge-1.25)/.6, 0., 1.);
        vec3 p = position; p.y *= max(easeBack(g), .0001); vY = position.y;
        vec4 mv = modelViewMatrix*vec4(p,1.); vN = normalize(normalMatrix*normal); vV = -mv.xyz;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform float uT, uAge, uNight; uniform vec3 uCol; varying vec3 vN, vV; varying float vY;
      void main(){
        float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float bands = .65 + .35*sin(vY*14. - uT*1.4);
        float pop = exp(-pow((uAge-1.6)*5., 2.));
        float a = f * pow(1.-vY, 1.4) * bands * (.2 + .4*uNight + pop*.6) * (.9 + .1*sin(uT*2.1));
        a *= smoothstep(1.2, 1.5, uAge);
        gl_FragColor = vec4(mix(uCol, vec3(.8,1.,.9), .35)*a*1.6, 1.);
      }`,
  });
}
