// The Detailed City / Capital component: builds the plan for (id, capital, detail) and draws it.
//   full: base, body, movers, scaffold, domes, glow = 6 draw calls; lite: the same without the scaffold = 5.
// Each instance owns six small materials that share compiled programs and read one uniform set per frame.
import {createElement, useEffect, useMemo} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {world} from '../../tiles3d';
import type {ModelProps} from '../contract';
import {cityDetailPlan} from './CityDetailPlan';
import * as S from './CityDetailShaders';

const SLAB = 0.03;
let basePlane: THREE.PlaneGeometry | null = null;
const getBase = () => {
  if (!basePlane) { basePlane = new THREE.PlaneGeometry(2.2, 2.2); basePlane.rotateX(-Math.PI / 2); basePlane.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2); }
  return basePlane;
};

export function CityDetailModel(p: ModelProps & {grand: boolean}) {
  const {id, grand, color, radius, top, night, age} = p;
  const lite = p.detail === 'lite';
  const plan = useMemo(() => cityDetailPlan(id, grand, lite), [id, grand, lite]);
  const hex = (color && color !== 'neutral' ? PLAYER_HEX[color] : null) ?? '#d8e2e8';
  const inst = useMemo(() => {
    const U = {
      uAge: {value: 999}, uNight: {value: 0}, uTime: {value: 0}, uMove: {value: 1}, uR: {value: 1}, uLight: {value: plan.light},
      uOwner: {value: new THREE.Color(hex)}, uBlob: {value: plan.blobs.map((b) => new THREE.Vector4(b[0], b[1], b[2], b[3]))},
    };
    type UK = keyof typeof U;
    const pick = (keys: UK[]) => Object.fromEntries(keys.map((kk) => [kk, U[kk]]));
    const bodyMat = new THREE.MeshStandardMaterial({vertexColors: true, metalness: 0.25, roughness: 0.55});
    bodyMat.customProgramCacheKey = () => 'cityDetailBody';
    bodyMat.onBeforeCompile = (sh) => {
      for (const kk of ['uAge', 'uNight', 'uTime', 'uMove', 'uOwner', 'uLight'] as UK[]) sh.uniforms[kk] = U[kk];
      sh.vertexShader = S.BODY_VS_PARS + '\n' + sh.vertexShader.replace('#include <begin_vertex>', S.BODY_VS);
      sh.fragmentShader = S.BODY_FS_PARS + '\n' + sh.fragmentShader.replace('#include <color_fragment>', S.BODY_FS_COLOR)
        .replace('#include <roughnessmap_fragment>', S.BODY_FS_ROUGH).replace('#include <metalnessmap_fragment>', S.BODY_FS_METAL)
        .replace('#include <emissivemap_fragment>', S.BODY_FS_EMIT);
    };
    const movMat = new THREE.MeshStandardMaterial({vertexColors: true, metalness: 0.3, roughness: 0.5});
    movMat.customProgramCacheKey = () => 'cityDetailMov';
    movMat.onBeforeCompile = (sh) => {
      for (const kk of ['uAge', 'uNight', 'uTime', 'uMove', 'uOwner'] as UK[]) sh.uniforms[kk] = U[kk];
      sh.vertexShader = S.MOVER_VS_PARS + '\n' + sh.vertexShader.replace('#include <beginnormal_vertex>', S.MOVER_VS_NORMAL).replace('#include <begin_vertex>', S.MOVER_VS_BEGIN);
      sh.fragmentShader = S.MOVER_FS_PARS + '\n' + sh.fragmentShader.replace('#include <color_fragment>', S.MOVER_FS_COLOR).replace('#include <emissivemap_fragment>', S.MOVER_FS_EMIT);
    };
    const scafMat = new THREE.MeshStandardMaterial({vertexColors: true, metalness: 0.4, roughness: 0.6});
    scafMat.customProgramCacheKey = () => 'cityDetailScaf';
    scafMat.onBeforeCompile = (sh) => {
      sh.uniforms.uAge = U.uAge;
      sh.vertexShader = S.SCAF_VS + '\n' + sh.vertexShader.replace('#include <begin_vertex>', S.SCAF_VS_BODY);
      sh.fragmentShader = 'varying float vGone;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (vGone > 0.5) discard;');
    };
    const domeMat = new THREE.ShaderMaterial({uniforms: pick(['uAge', 'uNight', 'uTime', 'uMove', 'uLight']), vertexShader: S.DOME_VS, fragmentShader: S.DOME_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide});
    const glowMat = new THREE.ShaderMaterial({uniforms: pick(['uAge', 'uNight', 'uTime', 'uMove', 'uR', 'uOwner', 'uLight']), vertexShader: S.GLOW_VS, fragmentShader: S.GLOW_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
    const baseMat = new THREE.ShaderMaterial({uniforms: pick(['uAge', 'uNight', 'uTime', 'uMove', 'uOwner', 'uBlob', 'uLight']), vertexShader: S.BASE_VS, fragmentShader: S.BASE_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
    return {U, bodyMat, movMat, scafMat, domeMat, glowMat, baseMat};
  }, [plan, hex]);
  useEffect(() => () => { inst.bodyMat.dispose(); inst.movMat.dispose(); inst.scafMat.dispose(); inst.domeMat.dispose(); inst.glowMat.dispose(); inst.baseMat.dispose(); }, [inst]);

  useFrame(() => {
    const U = inst.U;
    U.uAge.value = world.reduced ? 999 : age();
    U.uNight.value = night;
    U.uMove.value = world.reduced ? 0 : 1;
    U.uTime.value = world.reduced ? 3.3 : world.t;
    U.uR.value = radius;
  });

  const kids = [
    createElement('mesh', {key: 'base', geometry: getBase(), material: inst.baseMat, position: [0, SLAB + 0.004, 0], renderOrder: 1, frustumCulled: false}),
    createElement('mesh', {key: 'body', geometry: plan.body, material: inst.bodyMat, frustumCulled: false}),
    createElement('mesh', {key: 'mov', geometry: plan.mov, material: inst.movMat, frustumCulled: false}),
    createElement('mesh', {key: 'dome', geometry: plan.dome, material: inst.domeMat, renderOrder: 2, frustumCulled: false}),
    createElement('mesh', {key: 'glow', geometry: plan.glow, material: inst.glowMat, renderOrder: 3, frustumCulled: false}),
  ];
  if (plan.scaf) kids.push(createElement('mesh', {key: 'scaf', geometry: plan.scaf, material: inst.scafMat, frustumCulled: false}));
  return createElement('group', {position: [0, top, 0], scale: radius, userData: {model: grand ? 'detailed/Capital' : 'detailed/City', set: 'detailed', detail: lite ? 'lite' : 'full'}}, ...kids);
}

/** triangle counts of a plan, for the report */
export function cityDetailStats(id: string, grand: boolean, lite: boolean) { return cityDetailPlan(id, grand, lite).tris; }
export function cityDetailSeconds(grand: boolean) { return grand ? 5.4 : 4.7; }
