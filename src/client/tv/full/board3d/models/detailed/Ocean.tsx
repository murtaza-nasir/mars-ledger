// Detailed Ocean: a living sea. A translucent multi-octave water surface over a sand floor with caustics, kelp beds that
// sway, fish that glint, a bobbing buoy with a blinking lantern, a research raft, ice floes in cold seas and gulls
// overhead; breakers, foam and spray at a pebbled, wet-sheened shore. Night brings a moon path, bioluminescent plankton
// and the lantern. The build-in: five vents gush, the sea floods outward and settles, then the buoy, raft, kelp, fish and
// gulls arrive. World xz drives the swell, so neighbouring oceans stay one continuous sea.
// full: 11 draw calls (12 in a cold sea, +1 while building), lite: 5 (6 in a cold sea, +1 while building).
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo} from 'react';
import * as THREE from 'three';
import {world} from '../../tiles3d';
import {PLAYER_HEX} from '../../../../../ui/Icons';
import type {ModelMeta, ModelProps} from '../contract';
import {blinkAt, getKit, getMats, swellAt, U, WY} from './OceanKit';

export const meta: ModelMeta = {set: 'detailed', name: 'Ocean', tileTypes: [1], kind: 'ocean', buildSeconds: 3.8};

const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const backOut = (x: number) => { x = Math.max(0, Math.min(1, x)); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

let windowMat: THREE.MeshBasicMaterial | null = null;

export default function Ocean({id, radius: R, top, color, age, detail, oceanEdges}: ModelProps) {
  const lite = detail === 'lite';
  const accent = (color && PLAYER_HEX[color]) || '#d8503c';
  const {size, viewport, camera} = useThree();
  const M = useMemo(getMats, []);
  // which edges border another ocean (no beach there). The lab has no neighbours, so ?edges=101000 stands in for them.
  const edgeKey = useMemo(() => {
    let e: readonly boolean[] | undefined = oceanEdges;
    if (!e && typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('edges');
      if (q && /^[01]{6}$/.test(q)) e = [...q].map((c) => c === '1');
    }
    return [0, 1, 2, 3, 4, 5].map((i) => (e && e[i] ? '1' : '0')).join('');
  }, [oceanEdges]);
  const open = useMemo(() => [...edgeKey].map((c) => (c === '1' ? 1 : 0)), [edgeKey]);
  const kit = useMemo(() => getKit(id, accent, open), [id, accent, open]);
  windowMat ??= new THREE.MeshBasicMaterial({color: '#9cc8dd', toneMapped: false});

  const rig = useMemo(() => {
    const inst = {
      age: 99, t: 0,
      fl: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
      bird: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1)],
      buoy: new THREE.Vector4(kit.buoy.x, WY, kit.buoy.z, 1), raft: new THREE.Vector3(kit.raft.x, kit.raft.z, 1),
    };
    const root = new THREE.Group();
    const mk = <T extends THREE.Object3D>(o: T, order = 0): T => { o.frustumCulled = false; o.renderOrder = order; root.add(o); return o; };
    const water = mk(new THREE.Mesh(lite ? M.waterLiteGeo : M.waterFullGeo, lite ? M.waterLite : M.waterFull), 3);
    const shoreG = lite ? kit.shoreLite : kit.shoreFull;
    const shore = shoreG ? mk(new THREE.Mesh(shoreG, M.shore), 0) : null;
    const motes = mk(new THREE.Points(lite ? kit.motesLite : kit.motesFull, M.mote), 6);
    const jet = mk(new THREE.Mesh(kit.vents, M.jet), 5); jet.visible = false;
    const synced: THREE.Object3D[] = [water, motes, jet];
    if (shore) synced.push(shore);
    let buoyG: THREE.Group | null = null, raftG: THREE.Group | null = null, floeG: THREE.Group | null = null, lens: THREE.Mesh | null = null;
    let birds: THREE.Mesh | null = null, lensMat: THREE.MeshBasicMaterial | null = null;
    if (lite) {
      synced.push(mk(new THREE.Mesh(kit.propsLite, M.props), 0), mk(new THREE.Mesh(kit.windowsLite, windowMat!), 0));
      if (kit.floes.length) { const fm = mk(new THREE.Mesh(kit.floeAll, M.ice), 0); fm.position.y = WY - 0.0035; synced.push(fm); }
    } else {
      synced.push(mk(new THREE.Mesh(M.seabedGeo, M.seabed), -1), mk(new THREE.Mesh(kit.kelp, M.kelp), 0), mk(new THREE.Mesh(kit.fish, M.fish), 0));
      birds = mk(new THREE.Mesh(kit.birdsGeo, M.bird), 0); synced.push(birds);
      buoyG = new THREE.Group(); { const bm = new THREE.Mesh(kit.buoyG, M.props); bm.scale.setScalar(1.25); buoyG.add(bm); }
      lensMat = new THREE.MeshBasicMaterial({color: '#ff6a30', toneMapped: false});
      lens = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 8, 6), lensMat); lens.position.y = 0.11; buoyG.add(lens);
      root.add(buoyG);
      raftG = new THREE.Group(); raftG.add(new THREE.Mesh(kit.raftG, M.props), new THREE.Mesh(kit.windowsG, windowMat!)); root.add(raftG);
      if (kit.floes.length) { floeG = new THREE.Group(); floeG.add(new THREE.Mesh(kit.floeAll, M.ice)); root.add(floeG); }
      for (const g of [buoyG, raftG, floeG]) g?.traverse((o) => { o.frustumCulled = false; if ((o as THREE.Mesh).isMesh) synced.push(o); });
    }
    const set = (o: THREE.Object3D) => {
      o.onBeforeRender = (_r, _s, _c, _g, mat) => {
        U.uAge.value = inst.age; U.uR.value = R; U.uSeed.value.copy(kit.seed); U.uTime.value = inst.t; U.uNight.value = world.night;
        for (let i = 0; i < 3; i++) { U.uFl.value[i].copy(inst.fl[i]); U.uBird.value[i].copy(inst.bird[i]); }
        for (let i = 0; i < 6; i++) U.uPatch.value[i].copy(kit.patches[i]);
        for (let i = 0; i < 6; i++) U.uOpen.value[i] = open[i];
        U.uBuoy.value.copy(inst.buoy); U.uRaft.value.copy(inst.raft);
        (mat as THREE.ShaderMaterial).uniformsNeedUpdate = true;
      };
    };
    synced.forEach(set);
    return {inst, root, jet, buoyG, raftG, floeG, lens, lensMat, birds, water};
  }, [kit, lite, M, R, open]);

  useEffect(() => () => { rig.lensMat?.dispose(); rig.lens?.geometry.dispose(); }, [rig]);

  const tmp = useMemo(() => ({v: new THREE.Vector3(), out: [0, 0, 0]}), []);
  useFrame(() => {
    const {inst} = rig;
    const a = world.reduced ? 99 : Math.min(age(), 99);
    const t = world.reduced ? 0 : world.t;
    inst.age = a; inst.t = t;
    { const n = world.night, k = 0.5 + n * 1.1; windowMat!.color.setRGB((0.55 + 0.45 * n) * k, (0.75 - 0.05 * n) * k, (0.85 - 0.5 * n) * k); }
    rig.jet.visible = a < 2.8;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 40;
    U.uScale.value = size.height * viewport.dpr / (2 * Math.tan((fov * Math.PI) / 360));
    rig.root.updateWorldMatrix(true, false);
    tmp.v.setFromMatrixPosition(rig.root.matrixWorld);
    const wx = tmp.v.x, wz = tmp.v.z, out = tmp.out;
    // the buoy and raft ride the same swell the shader draws
    const sBuoy = backOut((a - 1.9) / 0.55), sRaft = backOut((a - 2.3) / 0.6);
    swellAt(wx + kit.buoy.x, wz + kit.buoy.z, t, out);
    const by = out[0];
    inst.buoy.set(kit.buoy.x, WY + by, kit.buoy.z, Math.max(sBuoy, 0));
    swellAt(wx + kit.raft.x, wz + kit.raft.z, t, out);
    const ry = out[0], rgx = out[1], rgz = out[2];
    inst.raft.set(kit.raft.x, kit.raft.z, Math.max(sRaft, 0));
    if (rig.buoyG) {
      swellAt(wx + kit.buoy.x, wz + kit.buoy.z, t, out);
      const g = rig.buoyG, s = Math.max(sBuoy, 0.0001);
      g.visible = a > 1.85; g.scale.setScalar(s);
      g.position.set(kit.buoy.x, WY + by - (a < 2.5 ? (1 - Math.min(1, (a - 1.9) / 0.4)) * 0.05 : 0), kit.buoy.z);
      g.rotation.set(out[2] * 2.0 + Math.sin(t * 0.9 + kit.buoy.ph * 6) * 0.05, 0, -out[1] * 2.0 + Math.cos(t * 0.7 + kit.buoy.ph * 6) * 0.05);
      const lf = blinkAt(t, kit.seed.z), night = world.night;
      const k = (0.1 + lf * 2.2) * (0.35 + 0.65 * Math.max(night, 0.25));
      rig.lensMat!.color.setRGB(1.0 * k, 0.34 * k, 0.14 * k);
    }
    if (rig.raftG) {
      const g = rig.raftG, s = Math.max(sRaft, 0.0001);
      g.visible = a > 2.25; g.scale.setScalar(s * 1.3);
      g.position.set(kit.raft.x, WY + ry - 0.0005, kit.raft.z);
      g.rotation.set(rgz * 1.6, kit.raft.rot + Math.sin(t * 0.2) * 0.12, -rgx * 1.6);
    }
    // floes drift in a slow turn
    const fs = ss(2.6, 3.4, a), th = lite ? 0 : Math.sin(t * 0.06) * 0.07;
    const cs = Math.cos(th), sn = Math.sin(th);
    for (let i = 0; i < 3; i++) {
      const f = kit.floes[i];
      if (f) inst.fl[i].set((f.x * cs + f.z * sn) * 1.0, (-f.x * sn + f.z * cs) * 1.0, f.r * fs); else inst.fl[i].set(0, 0, 0);
    }
    if (rig.floeG) { rig.floeG.visible = fs > 0.01; rig.floeG.rotation.y = th; rig.floeG.scale.setScalar(Math.max(fs, 0.001)); rig.floeG.position.y = WY - 0.0035 + Math.sin(t * 0.9) * 0.0007; }
    // gulls circle overhead once the sea has settled
    if (rig.birds) {
      const A0 = kit.birdsGeo.attributes.aB0 as THREE.BufferAttribute, A1 = kit.birdsGeo.attributes.aB1 as THREE.BufferAttribute;
      const bs = ss(3.0, 3.7, a);
      for (let i = 0; i < 3; i++) {
        const b = kit.birds[i], th2 = b.ph + b.w * t, sg = Math.sign(b.w);
        const rho = b.rho * (0.4 + 0.6 * bs);
        const x = b.cx + rho * Math.cos(th2), z = b.cz + rho * Math.sin(th2);
        const y = WY + b.h * (0.5 + 0.5 * bs) + 0.02 * Math.sin(t * 0.5 + b.hp);
        A0.setXYZ(i, x, y, z); A0.setW(i, Math.atan2(-sg * Math.sin(th2), sg * Math.cos(th2)));
        A1.setXY(i, 0.04 * bs, b.ph * 3);
        inst.bird[i].set(x, z, bs > 0.05 ? y - WY : -1);
      }
      A0.needsUpdate = true; A1.needsUpdate = true;
    } else for (let i = 0; i < 3; i++) inst.bird[i].set(0, 0, -1);
  });
  void top;
  return <group position={[0, top, 0]}><primitive object={rig.root} /></group>;
}
