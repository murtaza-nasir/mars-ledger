// Ocean tile: a hexagonal body of Martian sea. One shared surface ShaderMaterial (layered travelling waves, depth
// colour, sky fresnel, glints, shoreline foam, bubbles, ice floes, night plankton), a fountain jet and spray points
// that only exist while the build-in plays. World-space waves make adjacent oceans one continuous sea.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {JET_FRAG, JET_VERT, SPRAY_FRAG, SPRAY_VERT, SURFACE_FRAG, SURFACE_VERT} from './OceanShaders';

export const meta: ModelMeta = {name: 'Ocean', tileTypes: [1], kind: 'ocean', buildSeconds: 2.2};

const RINGS = 18;
const SPRAY_N = 84;

/** A hexagonal disc of unit circumradius (pointy-top) on a triangular lattice: 6 * RINGS^2 triangles. */
function hexLattice(n: number): THREE.BufferGeometry {
  const s = 1 / n, id = new Map<number, number>(), pos: number[] = [], idx: number[] = [];
  const key = (q: number, r: number) => (q + 64) * 256 + (r + 64);
  const ok = (q: number, r: number) => Math.abs(q) <= n && Math.abs(r) <= n && Math.abs(q + r) <= n;
  for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) {
    if (!ok(q, r)) continue;
    id.set(key(q, r), pos.length / 3);
    pos.push((q * Math.cos(Math.PI / 6)) * s, 0, -(q * Math.sin(Math.PI / 6) + r) * s);
  }
  for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) {
    if (ok(q, r) && ok(q + 1, r) && ok(q, r + 1)) idx.push(id.get(key(q, r))!, id.get(key(q, r + 1))!, id.get(key(q + 1, r))!);
    if (ok(q + 1, r) && ok(q, r + 1) && ok(q + 1, r + 1)) idx.push(id.get(key(q + 1, r))!, id.get(key(q, r + 1))!, id.get(key(q + 1, r + 1))!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function jetGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 20, 14, true);
  g.translate(0, 0.5, 0);
  return g;
}

function sprayGeometry(): THREE.BufferGeometry {
  const r = seeded('ocean-spray', 1), a = new Float32Array(SPRAY_N * 4), p = new Float32Array(SPRAY_N * 3);
  for (let i = 0; i < a.length; i++) a[i] = r();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(a, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 1.5);
  return g;
}

// Shared by every ocean: the uniforms hold whichever instance is about to draw (set in onBeforeRender).
const U = {
  uTime: {value: 0}, uNight: {value: 0}, uAge: {value: 99}, uR: {value: 0.475},
  uSeed: {value: new THREE.Vector3()}, uFloe: {value: 0}, uScale: {value: 800},
};
type Shared = {surface: THREE.ShaderMaterial; jet: THREE.ShaderMaterial; spray: THREE.ShaderMaterial; hex: THREE.BufferGeometry; jetG: THREE.BufferGeometry; sprayG: THREE.BufferGeometry};
let shared: Shared | null = null;
function getShared(): Shared {
  if (shared) return shared;
  const mk = (vertexShader: string, fragmentShader: string, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
    new THREE.ShaderMaterial({uniforms: U, vertexShader, fragmentShader, ...extra});
  shared = {
    surface: mk(SURFACE_VERT, SURFACE_FRAG, {side: THREE.DoubleSide}),
    jet: mk(JET_VERT, JET_FRAG, {transparent: true, depthWrite: false, side: THREE.DoubleSide}),
    spray: mk(SPRAY_VERT, SPRAY_FRAG, {transparent: true, depthWrite: false}),
    hex: hexLattice(RINGS), jetG: jetGeometry(), sprayG: sprayGeometry(),
  };
  return shared;
}

export default function Ocean({id, radius: R, top, night, age}: ModelProps) {
  const sh = useMemo(getShared, []);
  const {size, viewport, camera} = useThree();
  const inst = useMemo(() => {
    const r = seeded(id, 77);
    return {seed: new THREE.Vector3(r(), r(), r()), floe: r() < 0.4 ? 0.34 + r() * 0.66 : 0, age: 99};
  }, [id]);
  const jet = useRef<THREE.Mesh>(null), spray = useRef<THREE.Points>(null), surf = useRef<THREE.Mesh>(null);

  // before each draw, load this sea's own values into the shared uniforms
  useEffect(() => {
    const set = (m: THREE.Mesh | THREE.Points | null, mat: THREE.ShaderMaterial) => {
      if (!m) return;
      m.onBeforeRender = () => {
        U.uAge.value = inst.age; U.uR.value = R; U.uSeed.value.copy(inst.seed); U.uFloe.value = inst.floe;
        U.uTime.value = world.t; U.uNight.value = world.night;
        mat.uniformsNeedUpdate = true;
      };
    };
    set(surf.current, sh.surface); set(jet.current, sh.jet); set(spray.current, sh.spray);
  }, [inst, R, sh]);

  useFrame(() => {
    const a = world.reduced ? 99 : Math.min(age(), 99);
    inst.age = a;
    if (jet.current) jet.current.visible = a < 1.9;
    if (spray.current) spray.current.visible = a < 3.1;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 40;
    U.uScale.value = size.height * viewport.dpr / (2 * Math.tan((fov * Math.PI) / 360));
  });
  void night;
  return (
    <group position={[0, top, 0]}>
      <mesh ref={surf} geometry={sh.hex} material={sh.surface} frustumCulled={false} renderOrder={2} />
      <mesh ref={jet} geometry={sh.jetG} material={sh.jet} visible={false} frustumCulled={false} renderOrder={4} />
      <points ref={spray} geometry={sh.sprayG} material={sh.spray} visible={false} frustumCulled={false} renderOrder={5} />
    </group>
  );
}
