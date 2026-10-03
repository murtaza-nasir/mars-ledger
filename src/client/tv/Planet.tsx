// Mars as the table terraforms it. Oceans fill the lowlands by real elevation (MOLA),
// green spreads along the shorelines with oxygen, polar ice retreats with temperature,
// and the atmosphere rim shifts from dust to blue.
import {Canvas, useFrame, useLoader} from '@react-three/fiber';
import {useMemo, useRef} from 'react';
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform sampler2D colorMap;
uniform sampler2D heightMap;
uniform float sea;       // 0..1 of the lowland range that is under water
uniform float green;     // 0..1
uniform float warmth;    // 0..1
uniform float time;
uniform vec3 lightDir;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  vec3 base = texture2D(colorMap, vUv).rgb;
  float h = texture2D(heightMap, vUv).r;
  float lat = abs(vUv.y - 0.5) * 2.0;

  // water: the northern lowlands and Hellas fill first because they are lowest
  float level = mix(0.0, 0.34, sea);
  float wet = smoothstep(level + 0.004, level - 0.004, h) * step(0.001, sea);
  float depth = clamp((level - h) / 0.2, 0.0, 1.0);
  vec3 water = mix(vec3(0.16, 0.45, 0.62), vec3(0.03, 0.12, 0.28), depth);

  // life: a band above the shoreline that widens with oxygen, broken up by noise
  float n = noise(vUv * vec2(180.0, 90.0)) * 0.6 + noise(vUv * vec2(40.0, 20.0)) * 0.4;
  float band = smoothstep(level + 0.02 + 0.22 * green, level, h) * smoothstep(0.95, 0.55, lat);
  float life = clamp(band * green * 1.6 - (1.0 - n) * 0.45, 0.0, 1.0);
  vec3 land = mix(base * vec3(1.05, 0.95, 0.9), vec3(0.22, 0.42, 0.18) * (0.7 + n * 0.5), life);

  // ice caps retreat as it warms
  float cap = mix(0.80, 0.965, warmth);
  float ice = smoothstep(cap, cap + 0.03, lat + (n - 0.5) * 0.04);
  land = mix(land, vec3(0.93, 0.95, 0.97), ice);

  vec3 col = mix(land, water, wet);

  float diff = clamp(dot(normalize(vNormal), normalize(lightDir)), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-normalize(lightDir), normalize(vNormal)), vView), 0.0, 1.0), 40.0) * wet * 0.6;
  vec3 lit = col * (0.08 + diff * 1.05) + spec;

  // atmosphere rim: dust orange to breathable blue
  float rim = pow(1.0 - clamp(dot(normalize(vNormal), vView), 0.0, 1.0), 2.4);
  vec3 air = mix(vec3(0.95, 0.52, 0.30), vec3(0.45, 0.72, 1.0), clamp(green * 0.8 + sea * 0.4, 0.0, 1.0));
  lit += air * rim * (0.35 + 0.5 * diff);

  gl_FragColor = vec4(lit, 1.0);
}`;

function Globe({sea, green, warmth, rate = 1.2, spin = 0.035}: {sea: number; green: number; warmth: number; rate?: number; spin?: number}) {
  const [colorMap, heightMap] = useLoader(THREE.TextureLoader, ['/assets/mars-color.jpg', '/assets/mars-elevation.png']);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  const mesh = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({
    colorMap: {value: colorMap}, heightMap: {value: heightMap}, sea: {value: sea}, green: {value: green}, warmth: {value: warmth},
    time: {value: 0}, lightDir: {value: new THREE.Vector3(-1, 0.4, 0.9).normalize()},
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [colorMap, heightMap]);
  useFrame((_, dt) => {
    if (mesh.current) mesh.current.rotation.y += dt * spin;
    // ease the parameters so every raise visibly washes across the planet
    const k = 1 - Math.exp(-dt * rate);
    uniforms.sea.value += (sea - uniforms.sea.value) * k;
    uniforms.green.value += (green - uniforms.green.value) * k;
    uniforms.warmth.value += (warmth - uniforms.warmth.value) * k;
    uniforms.time.value += dt;
  });
  return (
    <mesh ref={mesh} rotation={[0.42, 0, 0.1]}>
      <sphereGeometry args={[1, 128, 96]} />
      <shaderMaterial vertexShader={vert} fragmentShader={frag} uniforms={uniforms} />
    </mesh>
  );
}

/** rate: how fast the planet eases to new parameters (per second); spin: radians per second. */
export function Planet(props: {sea: number; green: number; warmth: number; rate?: number; spin?: number}) {
  return (
    <Canvas camera={{position: [0, 0, 3.3], fov: 40}} dpr={[1, 2]} gl={{antialias: true, alpha: true}} style={{background: 'transparent'}}>
      <Globe {...props} />
    </Canvas>
  );
}
