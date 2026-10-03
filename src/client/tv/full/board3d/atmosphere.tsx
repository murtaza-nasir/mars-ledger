// The air over the 3D board: the fog a placement dives down through, the mist that lies between the
// tiles while the camera is down there, height and distance haze, sun shafts by day and beacon shafts from the
// cities at night, and a depth-of-field blur on what lies far behind the focused tile. At the resting view all of it
// is gone, so the board reads exactly as before.
//
// The camera rig (Board3D) writes `fogState` every frame: how fast the camera travels (`amount`), how far down it is
// (`dive`, 0 at rest … 1 at a placement close-up), the sky's night and the sun. Everything here reads from it.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import type {SpaceModel} from '../../../../shared/full';
import {tileKind} from '../../../../shared/full';
import type {Board3} from './geometry3d';
import {prismHeight} from './geometry3d';
import {modelsVersion} from './tiles3d';
import {primePrograms} from './primer';

export const fogState = {
  /** fog from the camera's travel (0 at rest, 1 at full speed) */
  amount: 0,
  /** how far down in the world the camera is: 0 at the resting view, 1 at a placement close-up */
  dive: 0,
  /** the camera's height (world units) and the resting camera's */
  camY: 20, restY: 20,
  night: 0,
  /** the haze colour: dust-peach by day, violet at night */
  tint: new THREE.Color('#C49A82'),
  /** where the sun shines from (unit vector toward it) and its colour */
  sun: new THREE.Vector3(-0.3, 0.85, 0.45).normalize(), sunColor: new THREE.Color('#FFE8D6'),
  /** distance from the camera to what it looks at (the depth of field focuses there) */
  focus: 20,
  /** the "Fog effects" options switch and reduced motion (no drift) */
  enabled: true, still: false,
  /** the camera is being flown (experimental): layers fade where it skims along them */
  flying: false,
};

// ---- height haze ---------------------------------------------------------------------------------------------
// three's fog is by distance only; this makes it lie low: full strength at the plate, thinning with height. Patched
// once into the shared shader chunks (every lit material on the board uses the scene fog). The world height comes
// from the view-space position, so it works in every built-in shader (meshes, instances, points, sprites).
let patched = false;
export function patchHeightFog() {
  if (patched) return;
  patched = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = C.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogHeight;');
  C.fog_vertex = C.fog_vertex.replace('vFogDepth = - mvPosition.z;',
    'vFogDepth = - mvPosition.z;\n\tvFogHeight = ( transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) ).y;');
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogHeight;');
  C.fog_fragment = C.fog_fragment.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    '// The haze lies low (full at the plate, about half at a tall tower\'s top)\n\tfogFactor *= mix( 0.35, 1.0, exp( - max( vFogHeight, 0.0 ) * 1.4 ) );\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );');
}

// ---- textures --------------------------------------------------------------------------------------------------
/** Tileable cloud noise (a few octaves of wrapped value noise), read twice at different scales in the fog shader. */
const NOISE = (() => {
  let t: THREE.DataTexture | null = null;
  return () => {
    if (t) return t;
    const N = 128, data = new Uint8Array(N * N * 4);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const oct = (g: number) => { const v = Array.from({length: g * g}, rnd); return (x: number, y: number) => {
      const fx = (x / N) * g, fy = (y / N) * g, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (i: number, j: number) => v[((j % g) + g) % g * g + ((i % g) + g) % g];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    }; };
    const octs = [oct(4), oct(8), oct(16), oct(32)], w = [0.5, 0.27, 0.15, 0.08];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      octs.forEach((o, i) => { v += o(x, y) * w[i]; });
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255); data[i + 3] = 255;
    }
    t = new THREE.DataTexture(data, N, N);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
})();

/** Where the low mist gathers: a soft map over the plate, densest over cities, then forests and oceans. */
function useMistMap(geo: Board3, spaces: Map<string, SpaceModel>): THREE.CanvasTexture | null {
  const key = geo.cells.map((c) => spaces.get(c.id)?.tileType ?? '-').join(',');
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }, []);
  useEffect(() => {
    if (!tex) return;
    const c = tex.image as HTMLCanvasElement, g = c.getContext('2d')!, R = geo.discR;
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'lighter';
    for (const cell of geo.cells) {
      const k = tileKind(spaces.get(cell.id)?.tileType);
      const s = k === 'city' ? 0.75 : k === 'greenery' ? 0.5 : k === 'ocean' ? 0.4 : k === 'special' ? 0.3 : 0;
      if (!s) continue;
      const x = (cell.x / (2 * R) + 0.5) * 128, y = (cell.z / (2 * R) + 0.5) * 128, r = (0.95 / (2 * R)) * 128 * 1.3;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(255,255,255,${s})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    g.globalCompositeOperation = 'source-over';
    tex.needsUpdate = true;
  }, [tex, key, geo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

// ---- fog layers ------------------------------------------------------------------------------------------------
const FOG_VS = `varying vec3 vWorld; varying float vDist;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`;
const FOG_FS = `uniform sampler2D uNoise; uniform sampler2D uMist; uniform float uTime; uniform float uAlpha; uniform vec3 uColor;
uniform float uScale; uniform vec2 uWind; uniform float uUseMist; uniform float uR; uniform float uNear; uniform float uLo; uniform float uHi; uniform float uFocus;
varying vec3 vWorld; varying float vDist;
void main() {
  vec2 p = vWorld.xz * uScale;
  float n = texture2D(uNoise, p + uWind * uTime).r * 0.62 + texture2D(uNoise, p * 2.7 - uWind * uTime * 1.6 + 0.37).r * 0.38;
  float d = smoothstep(uLo, uHi, n);
  float mist = mix(1.0, texture2D(uMist, vWorld.xz / (2.0 * uR) + 0.5).r, uUseMist);
  // fade out right in front of the lens (no flat sheet slapped on the screen) and beyond the plate's rim
  // thin near the camera and denser with distance, so a frame mid-dive shows saturated models through wisps rather
  // than an even veil (decks reach full strength four times further out than mist)
  float near = smoothstep(uNear * 0.35, uNear * mix(4.0, 1.0, uUseMist), vDist);
  float edge = 1.0 - smoothstep(uR * 0.85, uR * 1.5, length(vWorld.xz));
  // low mist gathers behind the focused tile, not over it: clear near the camera's subject, thicker with distance
  float behind = mix(1.0, smoothstep(uFocus * 0.75, uFocus * 1.9, vDist), uUseMist);
  gl_FragColor = vec4(uColor, d * mist * near * edge * behind * uAlpha);
}`;

type Layer = {y: number; scale: number; wind: [number, number]; lo: number; hi: number; mist: boolean; size: number; strength: number};
/** Cloud decks the camera passes down through (heights as fractions of the resting camera's height) … */
const DECKS: Layer[] = [
  {y: 0.16, scale: 0.05, wind: [0.006, 0.002], lo: 0.5, hi: 0.82, mist: false, size: 4, strength: 0.75},
  {y: 0.3, scale: 0.04, wind: [-0.004, 0.005], lo: 0.5, hi: 0.84, mist: false, size: 5, strength: 0.7},
  {y: 0.47, scale: 0.032, wind: [0.005, -0.003], lo: 0.48, hi: 0.85, mist: false, size: 6, strength: 0.62},
  {y: 0.66, scale: 0.026, wind: [-0.003, -0.004], lo: 0.46, hi: 0.86, mist: false, size: 7, strength: 0.55},
];
/** … and mist lying between the tiles (heights in world units), shown only while the camera is down. */
const MIST: Layer[] = [
  {y: 0.16, scale: 0.42, wind: [0.012, 0.004], lo: 0.42, hi: 0.8, mist: true, size: 1.25, strength: 0.42},
  {y: 0.32, scale: 0.33, wind: [-0.01, 0.006], lo: 0.45, hi: 0.82, mist: true, size: 1.25, strength: 0.34},
  {y: 0.55, scale: 0.26, wind: [0.008, -0.007], lo: 0.48, hi: 0.85, mist: true, size: 1.25, strength: 0.26},
];

function FogLayer({layer, deck, R, mistMap}: {layer: Layer; deck: boolean; R: number; mistMap: THREE.Texture | null}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {uNoise: {value: NOISE()}, uMist: {value: mistMap}, uTime: {value: 0}, uAlpha: {value: 0}, uColor: {value: new THREE.Color()},
      uScale: {value: layer.scale}, uWind: {value: new THREE.Vector2(...layer.wind)}, uUseMist: {value: layer.mist && mistMap ? 1 : 0}, uR: {value: R},
      uNear: {value: deck ? 2.2 : 0.9}, uLo: {value: layer.lo}, uHi: {value: layer.hi}, uFocus: {value: 4}},
    vertexShader: FOG_VS, fragmentShader: FOG_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }), [layer, deck, R, mistMap]);
  useEffect(() => () => mat.dispose(), [mat]);
  const lit = useMemo(() => new THREE.Color(), []);
  const warm = useRef(3);
  useFrame((st) => {
    const m = mesh.current;
    if (!m) return;
    // the first frames draw the layer at zero strength, so its shader compiles at load rather than mid-dive
    if (warm.current > 0) { warm.current--; m.visible = true; mat.uniforms.uAlpha.value = 0; return; }
    const f = fogState;
    const y = deck ? f.restY * layer.y : layer.y;
    m.position.y = y;
    let a: number;
    if (deck) {
      // a deck shows while the camera travels near it, and lingers overhead (thinner) while the camera is down below
      const near = Math.exp(-Math.abs(f.camY - y) / (f.restY * 0.12));
      a = (f.amount * 0.9 + f.dive * 0.15) * near + f.dive * 0.05 * (f.camY < y ? 1 : 0);
    } else {
      a = f.dive * f.dive;
    }
    // no layer ever reaches more than 0.4 (the near field stays readable through it)
    a = Math.min(0.4, a * layer.strength) * (f.enabled ? 1 : 0);
    // a flown camera can skim along a layer, which would draw it as a hard line across the frame: it fades out there
    if (f.flying) a *= Math.min(1, Math.max(0, (Math.abs(f.camY - y) - 0.03) / 0.12));
    m.visible = a > 0.004;
    if (!m.visible) return;
    const u = mat.uniforms;
    u.uAlpha.value = a;
    u.uFocus.value = f.focus;
    if (!f.still) u.uTime.value = st.clock.elapsedTime;
    // the fog takes the sky's light: brighter where the sun is up, a dim violet at night
    lit.copy(f.tint).lerp(f.sunColor, 0.35 * (1 - f.night)).multiplyScalar(deck ? 1.08 : 1.0);
    u.uColor.value.copy(lit);
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={deck ? 12 : 11} frustumCulled={false} visible={false}>
      <planeGeometry args={[R * 2 * layer.size, R * 2 * layer.size]} />
    </mesh>
  );
}

// ---- light shafts ------------------------------------------------------------------------------------------------
const SHAFT_VS = `varying vec2 vUv; varying float vDist; varying vec3 vWorld;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`;
const SHAFT_FS = `uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform sampler2D uNoise; uniform float uSeed;
varying vec2 vUv; varying float vDist; varying vec3 vWorld;
void main() {
  float across = sin(vUv.x * 3.14159); across *= across;                 // soft sides
  float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float flick = 0.65 + 0.35 * texture2D(uNoise, vec2(vUv.x * 0.6 + uSeed, vUv.y * 0.2 + uTime * 0.02)).r;
  float near = smoothstep(0.6, 2.4, vDist);
  gl_FragColor = vec4(uColor, across * along * flick * near * uAlpha);
}`;
const SHAFT_GEO = (() => { const g = new THREE.PlaneGeometry(1, 1, 1, 1); g.translate(0, 0.5, 0); return g; })();
const BEAM_GEO = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true); g.translate(0, 0.5, 0); return g; })();

function shaftMaterial(seed: number, additive = true) {
  return new THREE.ShaderMaterial({uniforms: {uColor: {value: new THREE.Color()}, uAlpha: {value: 0}, uTime: {value: 0}, uNoise: {value: NOISE()}, uSeed: {value: seed}},
    vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false});
}

/** Sun shafts: long soft blades of light slanting down through the fog, along the sun's direction. Each blade turns
 *  about its own axis to face the camera, so it never shows as a flat card. */
function SunShafts({R}: {R: number}) {
  const blades = useMemo(() => {
    let s = 11;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    return Array.from({length: 7}, (_, i) => ({x: (rnd() * 2 - 1) * R * 0.7, z: (rnd() * 2 - 1) * R * 0.6, w: 0.6 + rnd() * 1.1, len: 8 + rnd() * 5, mat: shaftMaterial(i * 0.17)}));
  }, [R]);
  useEffect(() => () => blades.forEach((b) => b.mat.dispose()), [blades]);
  const group = useRef<THREE.Group>(null);
  const warmS = useRef(3);
  const q = useMemo(() => ({up: new THREE.Vector3(), toCam: new THREE.Vector3(), side: new THREE.Vector3(), m: new THREE.Matrix4(), z: new THREE.Vector3()}), []);
  const {camera} = useThree();
  useFrame((st) => {
    const g = group.current;
    if (!g) return;
    const f = fogState;
    const a = (1 - f.night) * (f.dive * 0.75 + f.amount * 0.35) * 0.42 * (f.enabled ? 1 : 0);
    g.visible = a > 0.003 || warmS.current-- > 0;
    if (!g.visible) return;
    q.up.copy(f.sun);
    g.children.forEach((m, i) => {
      const b = blades[i];
      // the blade's long axis points at the sun; it turns about that axis toward the camera
      m.position.set(b.x, 0, b.z);
      q.toCam.copy(camera.position).sub(m.position);
      q.side.crossVectors(q.up, q.toCam).normalize();
      q.z.crossVectors(q.side, q.up).normalize();
      q.m.makeBasis(q.side, q.up, q.z);
      m.quaternion.setFromRotationMatrix(q.m);
      m.scale.set(b.w, b.len, 1);
      const u = b.mat.uniforms;
      u.uAlpha.value = a;
      u.uColor.value.copy(f.sunColor);
      if (!f.still) u.uTime.value = st.clock.elapsedTime;
    });
  });
  return <group ref={group} visible={false}>{blades.map((b, i) => <mesh key={i} geometry={SHAFT_GEO} material={b.mat} renderOrder={13} frustumCulled={false} />)}</group>;
}

/** Beacon shafts: at night a beam of light rises from each city through the haze. */
function BeaconShafts({geo, spaces}: {geo: Board3; spaces: Map<string, SpaceModel>}) {
  const cities = geo.cells.filter((c) => tileKind(spaces.get(c.id)?.tileType) === 'city');
  const mat = useMemo(() => {
    const m = shaftMaterial(0.5);
    m.side = THREE.FrontSide;
    return m;
  }, []);
  useEffect(() => () => mat.dispose(), [mat]);
  const group = useRef<THREE.Group>(null);
  const warm = useMemo(() => new THREE.Color('#FFD7A0'), []);
  const warmB = useRef(3);
  useFrame((st) => {
    const g = group.current;
    if (!g) return;
    const f = fogState;
    const a = f.night * (0.1 + f.dive * 0.4 + f.amount * 0.2) * (f.enabled ? 1 : 0);
    g.visible = (a > 0.01 || warmB.current-- > 0) && cities.length > 0;
    mat.uniforms.uAlpha.value = a;
    mat.uniforms.uColor.value.copy(warm);
    if (!f.still) mat.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <group ref={group} visible={false}>
      {cities.map((c) => (
        <mesh key={c.id} geometry={BEAM_GEO} material={mat} position={[c.x, prismHeight(spaces.get(c.id) ?? c.space) + 0.6, c.z]}
          scale={[0.07, 6.5, 0.07]} renderOrder={13} frustumCulled={false} />
      ))}
    </group>
  );
}

export function Atmosphere({geo, spaces}: {geo: Board3; spaces: Map<string, SpaceModel>}) {
  const mistMap = useMistMap(geo, spaces);
  if (typeof document === 'undefined') return null;
  return (
    <>
      {MIST.map((l, i) => <FogLayer key={`m${i}`} layer={l} deck={false} R={geo.discR} mistMap={mistMap} />)}
      {DECKS.map((l, i) => <FogLayer key={`d${i}`} layer={l} deck R={geo.discR} mistMap={null} />)}
      <SunShafts R={geo.discR} />
      <BeaconShafts geo={geo} spaces={spaces} />
    </>
  );
}

// ---- depth of field ------------------------------------------------------------------------------------------------
// While the camera is down, the scene is drawn into a target with depth and composited with a blur that grows with
// distance behind the focused tile (nothing in front of it blurs, and sharp foreground never bleeds into the blur).
// At the resting view the scene is drawn straight to the screen as before.
const DOF_FS = `#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform float uFocus; uniform float uMax; uniform vec2 uTexel;
uniform float cameraNear; uniform float cameraFar; uniform float uAlphaW; varying vec2 vUv;
float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
const vec2 TAPS[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195),
  vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
void main() {
  float z = viewZ(vUv);
  float coc = clamp((z - uFocus * 1.15) / (uFocus * 1.6), 0.0, 1.0) * uMax;
  vec4 sum = texture2D(tColor, vUv); float wsum = 1.0;
  if (coc > 0.5) {
    for (int i = 0; i < 12; i++) {
      vec2 uv = vUv + TAPS[i] * coc * uTexel;
      float zs = viewZ(uv);
      float w = smoothstep(uFocus * 1.0, uFocus * 1.25, zs); // only blur with what is also far
      vec4 c = texture2D(tColor, uv);
      // (a flown camera sees open sky, which is transparent here: its taps would darken what they blur into)
      w *= mix(1.0, c.a, uAlphaW);
      sum += c * w; wsum += w;
    }
  }
  gl_FragColor = sum / wsum;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function DepthOfField({enabled, sceneKey, variantKey = '', variants}: {enabled: boolean; sceneKey: string;
  /** changes when the materials' dive states need compiling again (models loaded, the tops got their textures) */
  variantKey?: string;
  /** puts the scene's materials into the other states a dive draws them in (e.g. the painted tops fading, which makes
   *  them transparent: a different shader program); returns a function that restores them */
  variants?: () => () => void}) {
  const {gl, scene, camera, size} = useThree();
  const state = useRef<{rt: THREE.WebGLRenderTarget; quad: THREE.Mesh; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial} | null>(null);
  const frames = useRef(0);
  const compiling = useRef(false);
  const lastKey = useRef('');
  const lastVariant = useRef('');
  const heavy = useRef(false);
  const pending = useRef<number[]>([]);
  useEffect(() => () => {
    const s = state.current;
    if (s) { s.rt.depthTexture?.dispose(); s.rt.dispose(); s.mat.dispose(); (s.quad.geometry as THREE.BufferGeometry).dispose(); }
    state.current = null;
  }, []);
  // priority 1: the board renders itself from here (after every other per-frame update)
  useFrame(() => {
    const f = fogState;
    const amt = enabled && f.enabled ? Math.max(0, Math.min(1, (f.dive - 0.25) / 0.5)) : 0;
    (window as unknown as {__board3dDof?: number}).__board3dDof = amt;
    // the second frame after mount runs the blur path once with no blur: the target is allocated and the composite
    // shader compiled at load, not as a stall on the first dive
    const n = frames.current++;
    const warm = enabled && n === 1;
    // Shader variants a dive draws are compiled in the background (parallel compile) a few frames after a change, so
    // they are ready before the dive instead of stalling it: after a placement (sceneKey), the depth target's variant
    // of everything (no tone mapping, linear colour); after models load or the tops get textures (variantKey), also
    // the screen's and both targets' variants of the materials' dive states (`variants`). Each scene pass costs a few
    // ms of CPU, so the heavy set runs only on those rarer changes, at rest. Then each new program's first use is
    // paid ahead, a little per frame (primePrograms). Before this, the first dive after load stalled 50–80 ms at 4K:
    // a top's transparent variant linked on the draw path, then ~140 programs' first uses in one frame.
    const vkey = `${variantKey}|${modelsVersion()}`;
    if (lastVariant.current !== vkey) { lastVariant.current = vkey; heavy.current = true; pending.current = [3, 20, 60]; }
    const key = sceneKey;
    if (lastKey.current !== key) { lastKey.current = key; if (!pending.current.length) pending.current = [3, 20, 60]; }
    if (pending.current.length && enabled && state.current && !compiling.current) {
      pending.current = pending.current.map((x) => x - 1);
      if (pending.current[0] <= 0) {
        pending.current.shift();
        compiling.current = true;
        const t0 = performance.now();
        const rt = state.current.rt, jobs: Promise<unknown>[] = [];
        const pass = (target: THREE.WebGLRenderTarget | null) => { gl.setRenderTarget(target); jobs.push(gl.compileAsync(scene, camera)); };
        pass(rt);
        if (heavy.current) {
          pass(null);
          if (variants) { const restore = variants(); pass(rt); pass(null); restore(); }
          if (!pending.current.length) heavy.current = false;
        }
        gl.setRenderTarget(null);
        // (test hook: the CPU time of the latest compile passes, ms)
        const w = window as unknown as {__board3dCompileMs?: number[]};
        w.__board3dCompileMs = [...(w.__board3dCompileMs ?? []).slice(-49), Math.round((performance.now() - t0) * 10) / 10];
        Promise.all(jobs).catch(() => undefined).finally(() => { compiling.current = false; });
      }
    }
    // one program per frame, at rest only (a first use can wait ~15–30 ms for its link)
    if (!compiling.current && amt <= 0.01 && f.amount <= 0.01 && f.dive <= 0.01) primePrograms(gl);
    if (amt <= 0.01 && !warm) { gl.setRenderTarget(null); gl.render(scene, camera); return; }
    // at 4K the dive is drawn at three-quarter resolution (the composite scales it up; the blur hides it beyond the
    // focus), which keeps the fog layers' fill rate and the blur affordable on a TV's GPU
    const full = size.height * gl.getPixelRatio(), k = full > 1600 ? 0.75 : 1;
    const w = Math.round(size.width * gl.getPixelRatio() * k), h = Math.round(full * k);
    let s = state.current;
    if (!s || s.rt.width !== w || s.rt.height !== h) {
      if (s) { s.rt.depthTexture?.dispose(); s.rt.dispose(); }
      const rt = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, samples: h > 1600 ? 2 : 4, depthBuffer: true});
      rt.depthTexture = new THREE.DepthTexture(w, h);
      if (!s) {
        const mat = new THREE.ShaderMaterial({uniforms: {tColor: {value: null}, tDepth: {value: null}, uFocus: {value: 10}, uMax: {value: 6}, uTexel: {value: new THREE.Vector2()},
          cameraNear: {value: 0.5}, cameraFar: {value: 120}, uAlphaW: {value: 0}},
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: DOF_FS,
          depthTest: false, depthWrite: false, transparent: true, blending: THREE.NoBlending});
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
        quad.frustumCulled = false;
        s = {rt, quad, mat, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)};
      } else s = {...s, rt};
      state.current = s;
    }
    const pc = camera as THREE.PerspectiveCamera;
    const u = s.mat.uniforms;
    u.tColor.value = s.rt.texture; u.tDepth.value = s.rt.depthTexture;
    u.uFocus.value = f.focus; u.uMax.value = 7 * (h / 1080) * amt;
    u.uTexel.value.set(1 / w, 1 / h); u.cameraNear.value = pc.near; u.cameraFar.value = pc.far; u.uAlphaW.value = f.flying ? 1 : 0;
    gl.setRenderTarget(s.rt);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.render(s.quad, s.cam);
  }, 1);
  return null;
}
