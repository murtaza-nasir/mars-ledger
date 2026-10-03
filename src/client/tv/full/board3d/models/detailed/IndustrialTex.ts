// Textures and the molten-metal shader for the Detailed Industrial Center (procedural only).
import * as THREE from 'three';
import {hash, timeU} from '../MineKit';

let tx: {facade: THREE.CanvasTexture; emissive: THREE.CanvasTexture; grunge: THREE.CanvasTexture} | null = null;
export function industrialTextures() {
  if (tx) return tx;
  const mk = (draw: (g: CanvasRenderingContext2D, W: number) => void, srgb = true) => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    draw(c.getContext('2d')!, 256);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  };
  // corrugated hall wall: ribs, a band of windows, seams, a sooty skirt
  const facade = mk((g, W) => {
    g.fillStyle = '#cfd2d6'; g.fillRect(0, 0, W, W);
    for (let x = 0; x < W; x += 8) { g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(x, 0, 2, W); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 3, 0, 1.5, W); }
    for (let k = 0; k < 18; k++) { const x = hash(k, 3) * W; const gr = g.createLinearGradient(0, 0, 0, W); gr.addColorStop(0, 'rgba(90,60,30,0.28)'); gr.addColorStop(0.6, 'rgba(90,60,30,0)'); g.fillStyle = gr; g.fillRect(x, 0, 3 + hash(k, 4) * 6, W); }
    const sk = g.createLinearGradient(0, W * 0.72, 0, W); sk.addColorStop(0, 'rgba(30,26,22,0)'); sk.addColorStop(1, 'rgba(30,26,22,0.55)'); g.fillStyle = sk; g.fillRect(0, W * 0.72, W, W * 0.28);
    for (let c = 0; c < 6; c++) {
      g.fillStyle = '#2a3646'; g.fillRect(c * 42 + 5, 54, 32, 46);
      g.fillStyle = 'rgba(170,200,235,0.4)'; g.fillRect(c * 42 + 5, 54, 32, 8);
      g.fillStyle = '#9aa0a8'; g.fillRect(c * 42 + 20, 54, 3, 46);
    }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 126, W, 2); g.fillRect(0, 250, W, 4);
  });
  const emissive = mk((g, W) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    const cols = ['#ffd9a0', '#ffe9c0', '#ffc070', '#bfe4ff'];
    for (let c = 0; c < 6; c++) {
      if (hash(c, 41) < 0.22) continue;
      g.fillStyle = cols[Math.floor(hash(c, 42) * cols.length)]; g.fillRect(c * 42 + 7, 58, 28, 38);
    }
  });
  const grunge = mk((g, W) => {
    g.fillStyle = '#e0e0e0'; g.fillRect(0, 0, W, W);
    for (let k = 0; k < 600; k++) { const l = 110 + hash(k, 31) * 145; g.fillStyle = `rgba(${l},${l},${l},0.2)`; g.fillRect(hash(k, 32) * W, hash(k, 33) * W, 2 + hash(k, 34) * 14, 1 + hash(k, 35) * 5); }
    for (let k = 0; k < 24; k++) { const x = hash(k, 36) * W, gr = g.createLinearGradient(x, 0, x, 120 * hash(k, 37) + 40); gr.addColorStop(0, 'rgba(60,40,24,0.34)'); gr.addColorStop(1, 'rgba(60,40,24,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + hash(k, 38) * 4, 180); }
    g.strokeStyle = 'rgba(0,0,0,0.34)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, W - 2);
    g.fillStyle = 'rgba(0,0,0,0.38)'; for (const [x, y] of [[10, 10], [W - 10, 10], [10, W - 10], [W - 10, W - 10]]) { g.beginPath(); g.arc(x, y, 2.2, 0, 6.3); g.fill(); }
  });
  tx = {facade, emissive, grunge};
  return tx;
}

const MOLTEN_FRAG = `
varying vec3 vP;
uniform float uTime; uniform float uNight; uniform vec3 uScroll;
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  vec3 q = vP * 16.0 + uScroll * uTime;
  float v = n3(q) * 0.55 + n3(q * 2.1 + 3.0) * 0.3 + n3(q * 4.3) * 0.15;
  float crust = smoothstep(0.58, 0.82, v);
  vec3 hot = mix(vec3(1.0, 0.16, 0.015), vec3(1.0, 0.42, 0.07), smoothstep(0.3, 0.95, v));
  vec3 c = mix(hot, vec3(0.2, 0.03, 0.01), crust * 0.75) * (1.0 + 0.3 * uNight);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const MOLTEN_VERT = `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export function moltenMaterial(scroll: [number, number, number]) {
  const uNight = {value: 0};
  const mat = new THREE.ShaderMaterial({vertexShader: MOLTEN_VERT, fragmentShader: MOLTEN_FRAG, uniforms: {uTime: timeU, uNight, uScroll: {value: new THREE.Vector3(...scroll)}}});
  return {mat, uNight};
}
