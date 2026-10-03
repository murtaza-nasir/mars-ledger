// Textures and shaders for the Detailed Commercial District (procedural only): the glass facade and its lit windows,
// the abstract glyph / hologram atlas, the fountain water, the hologram material and the glass reflection patch.
import * as THREE from 'three';
import {hash, timeU} from '../MineKit';

export const WINK = 13; // facade tiles per unit
type Tex = {facade: THREE.CanvasTexture; emissive: THREE.CanvasTexture; atlas: THREE.CanvasTexture; grunge: THREE.CanvasTexture};
let texs: Tex | null = null;
export function commercialTextures(): Tex {
  if (texs) return texs;
  const mk = (size: number, draw: (g: CanvasRenderingContext2D, w: number) => void, repeat: boolean, srgb = true) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d')!, size);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const CELL = 64, N = 4;
  const facade = mk(256, (g) => {
    g.fillStyle = '#b9c1d2'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const x = c * CELL + 6, y = r * CELL + 5, w = CELL - 12, h = CELL - 14;
      const gr = g.createLinearGradient(x, y, x + w, y + h);
      const lt = hash(r * 7 + c, 11) > 0.8;
      gr.addColorStop(0, lt ? '#3c5a8a' : '#1c2c4c'); gr.addColorStop(0.55, '#0e1830'); gr.addColorStop(1, lt ? '#243c66' : '#101c34');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(190,220,255,0.28)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.55, y); g.lineTo(x, y + h * 0.7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + w / 2 - 1, y, 2, h);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + h, w, 3);
    }
    g.fillStyle = 'rgba(255,255,255,0.35)'; for (let r = 0; r < N; r++) g.fillRect(0, r * CELL + CELL - 5, 256, 1.5);
  }, true);
  const warm = ['#ffd9a0', '#ffe9c0', '#9fd8ff', '#ffb0e0', '#b8ffd8', '#ffc070'];
  const emissive = mk(256, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < N; r++) {
      const floorOn = hash(r, 50) > 0.3, hue = Math.floor(hash(r, 51) * warm.length);
      for (let c = 0; c < N; c++) {
        const h = hash(r * 11 + c, 77);
        if (h < (floorOn ? 0.18 : 0.88)) continue;
        const k = 0.45 + 0.55 * hash(r * 3 + c * 5, 80);
        const col = new THREE.Color(warm[hash(r * 7 + c, 78) > 0.75 ? Math.floor(hash(r * 7 + c, 78) * warm.length) % warm.length : hue]).multiplyScalar(k);
        g.fillStyle = '#' + col.getHexString();
        const x = c * CELL + 7, w = CELL - 14, y0 = r * CELL + 6, hh = CELL - 16;
        const blind = hash(r * 5 + c, 79) > 0.7 ? 0.45 : 1;
        g.fillRect(x, y0 + hh * (1 - blind), w, hh * blind);
      }
    }
  }, true);
  const atlas = mk(512, (g) => {
    g.clearRect(0, 0, 512, 512); g.lineCap = 'round'; g.lineJoin = 'round';
    for (let row = 0; row < 4; row++) {
      g.save(); g.shadowColor = '#fff'; g.shadowBlur = 8; g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 6;
      let x = 20;
      for (let k = 0; k < 8; k++) {
        const kind = Math.floor(hash(row * 9 + k, 5) * 8), cy = row * 64 + 32;
        g.beginPath();
        if (kind === 0) g.arc(x + 14, cy, 12, 0, 6.283);
        else if (kind === 1) { g.moveTo(x, cy + 14); g.lineTo(x + 14, cy - 14); g.lineTo(x + 28, cy + 14); g.closePath(); }
        else if (kind === 2) { g.rect(x, cy - 14, 8, 28); g.rect(x + 16, cy - 14, 8, 28); }
        else if (kind === 3) { g.moveTo(x, cy); g.lineTo(x + 14, cy - 14); g.lineTo(x + 28, cy); g.lineTo(x + 14, cy + 14); g.closePath(); }
        else if (kind === 4) { g.moveTo(x, cy + 10); g.lineTo(x + 9, cy - 10); g.lineTo(x + 18, cy + 10); g.lineTo(x + 28, cy - 10); }
        else if (kind === 5) { g.arc(x + 6, cy, 4, 0, 6.283); g.arc(x + 22, cy, 4, 0, 6.283); }
        else if (kind === 6) { for (let q = 0; q < 6; q++) { const a = q / 6 * 6.283; g.moveTo(x + 14, cy); g.lineTo(x + 14 + Math.cos(a) * 14, cy + Math.sin(a) * 14); } }
        else { g.arc(x + 14, cy, 13, 0, 6.283); g.moveTo(x + 14 + 7, cy); g.arc(x + 14, cy, 7, 0, 6.283); }
        if (kind === 2 || kind === 5) g.fill(); else g.stroke();
        x += 58;
      }
      g.restore();
    }
    for (let row = 4; row < 8; row++) for (let pn = 0; pn < 4; pn++) {
      const y0 = row * 64, x0 = pn * 128;
      const grad = g.createLinearGradient(0, y0, 0, y0 + 64); grad.addColorStop(0, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(255,255,255,0.12)');
      g.fillStyle = grad; g.fillRect(x0 + 3, y0 + 3, 122, 58);
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3; g.strokeRect(x0 + 4, y0 + 4, 120, 56);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      const style = (row + pn) % 3;
      if (style === 0) { for (let k = 0; k < 5; k++) { const hh = 8 + hash(row * 13 + k + pn * 3, 9) * 30; g.fillRect(x0 + 12 + k * 11, y0 + 54 - hh, 7, hh); } }
      else if (style === 1) { for (let k = 0; k < 4; k++) for (let q = 0; q < 4; q++) if (hash(row + k * 3 + q * 5 + pn, 21) > 0.4) g.fillRect(x0 + 12 + k * 12, y0 + 10 + q * 11, 9, 8); }
      else { g.lineWidth = 3; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x0 + 30 + k * 4, y0 + 32, 8 + k * 7, 0, 5.5); g.stroke(); } }
      g.lineWidth = 4; g.beginPath(); g.arc(x0 + 90, y0 + 22, 11, 0, 3.5 + hash(row + pn, 4) * 2.4); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.moveTo(x0 + 70, y0 + 52); for (let k = 0; k < 4; k++) g.lineTo(x0 + 70 + k * 15, y0 + 34 + hash(row * 5 + k + pn, 3) * 18); g.stroke();
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.5)'; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x0 + 8, y0 + 10 + k * 10); g.lineTo(x0 + 120, y0 + 10 + k * 10); g.stroke(); }
    }
  }, false, false);
  const grunge = mk(256, (g, W) => {
    g.fillStyle = '#e4e4ea'; g.fillRect(0, 0, W, W);
    for (let k = 0; k < 500; k++) { const l = 130 + hash(k, 31) * 125; g.fillStyle = `rgba(${l},${l},${l + 6},0.18)`; g.fillRect(hash(k, 32) * W, hash(k, 33) * W, 2 + hash(k, 34) * 14, 1 + hash(k, 35) * 5); }
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, W - 2);
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, W / 2); g.lineTo(W, W / 2); g.moveTo(W / 2, 0); g.lineTo(W / 2, W); g.stroke();
  }, true);
  texs = {facade, emissive, atlas, grunge};
  return texs;
}

/** glass reflection + a drifting light sweep, added to a standard material's emissive (a sky gradient, a sun glint, neon smears at night) */
export function glassPatch(uNight: {value: number}) {
  const uRefl = {value: 1};
  const extra = (s: {uniforms: Record<string, {value: unknown}>; vertexShader: string; fragmentShader: string}) => {
    s.uniforms.uNight = uNight; s.uniforms.uRefl = uRefl;
    s.fragmentShader = `uniform float uNight; uniform float uRefl; uniform float uTime; varying vec3 vLocal;\n` + s.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 vd = normalize(vViewPosition);
        vec3 rv = reflect(-vd, normalize(normal));
        vec3 rw = normalize((vec4(rv, 0.0) * viewMatrix).xyz);
        float fr = pow(1.0 - clamp(dot(normalize(normal), vd), 0.0, 1.0), 2.5);
        vec3 dayTop = vec3(0.35, 0.3, 0.62), dayLow = vec3(0.9, 0.55, 0.36);
        vec3 nightTop = vec3(0.02, 0.03, 0.09), nightLow = vec3(0.1, 0.05, 0.12);
        vec3 sky = mix(mix(dayLow, dayTop, smoothstep(-0.1, 0.8, rw.y)), mix(nightLow, nightTop, smoothstep(-0.1, 0.8, rw.y)), uNight);
        float neon = uNight * smoothstep(0.5, 1.0, sin(rw.x * 7.0 + rw.z * 3.0 + vLocal.y * 2.0)) * 0.6;
        vec3 smear = mix(vec3(1.0, 0.2, 0.7), vec3(0.2, 0.9, 1.0), 0.5 + 0.5 * sin(rw.z * 5.0));
        float sun = pow(max(dot(rw, normalize(vec3(0.5, 0.4, 0.75))), 0.0), 40.0) * (1.0 - uNight);
        float sw = smoothstep(0.0, 0.1, 1.0 - abs(fract((vLocal.x + vLocal.z) * 0.9 + vLocal.y * 0.35 - uTime * 0.05) - 0.5) * 2.0) * 0.12;
        totalEmissiveRadiance += (sky * (0.34 + 1.0 * fr) + smear * neon * fr + vec3(1.0, 0.9, 0.8) * (sun * 0.9 + sw * (1.0 - 0.6 * uNight))) * uRefl * diffuseColor.rgb * 1.5;
      }`);
    s.uniforms.uTime = timeU;
  };
  return {extra, uRefl};
}

const HOLO_VERT = `
attribute float aGrp; attribute vec3 color;
varying vec2 vUv; varying vec3 vCol; varying float vGrp; varying float vFres;
uniform float uTime;
void main(){
  vUv = uv; vCol = color; vGrp = aGrp;
  vec3 p = position;
  p.y += step(7.5, aGrp) * 0.012 * sin(uTime * 1.3 + aGrp * 2.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFres = 1.0;
  gl_Position = projectionMatrix * mv;
}`;
const HOLO_FRAG = `
uniform sampler2D map; uniform float uOn[16]; uniform float uTime;
varying vec2 vUv; varying vec3 vCol; varying float vGrp;
void main(){
  vec4 t = texture2D(map, vUv);
  float holo = step(7.5, vGrp);
  float on = uOn[int(vGrp + 0.5)];
  float scan = 0.72 + 0.28 * sin(vUv.y * 900.0 - uTime * 6.0 + vGrp);
  float sh = mix(0.9 + 0.1 * sin(uTime * 23.0 + vGrp * 5.0), scan, holo);
  float glitch = holo * step(0.985, fract(sin(floor(uTime * 8.0) + vGrp * 13.0) * 4375.5)) * 0.8;
  vec3 c = vCol * t.rgb * on * sh * (1.0 + holo * 0.5 + glitch);
  float a = t.a * on;
  if (a < 0.01) discard;
  gl_FragColor = vec4(c * a, a);
}`;
export function holoMaterial(atlas: THREE.Texture) {
  const on = new Float32Array(16);
  const mat = new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, uniforms: {map: {value: atlas}, uOn: {value: on}, uTime: timeU},
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  mat.customProgramCacheKey = () => 'com-holo';
  return {mat, on};
}

const GLOBE_FRAG = `
uniform float uTime; uniform float uOn; uniform vec3 uCol;
varying vec3 vN; varying vec3 vP; varying vec2 vUv;
void main(){
  float lat = abs(fract(vUv.y * 12.0) - 0.5);
  float lon = abs(fract(vUv.x * 18.0 + uTime * 0.05) - 0.5);
  float line = smoothstep(0.06, 0.0, lat) + smoothstep(0.05, 0.0, lon);
  float fres = pow(1.0 - abs(vN.z), 2.0);
  float sweep = smoothstep(0.0, 0.2, 1.0 - abs(fract(vUv.y * 1.0 - uTime * 0.3) - 0.5) * 2.0);
  float a = clamp(line * 0.7 + fres * 0.5 + sweep * 0.3, 0.0, 1.0) * uOn;
  vec3 c = mix(uCol, vec3(1.0), sweep * 0.5);
  gl_FragColor = vec4(c * a, a);
}`;
export function globeMaterial() {
  const uOn = {value: 0}, uCol = {value: new THREE.Color(0x6ae8ff)};
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vN; varying vec3 vP; varying vec2 vUv; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: GLOBE_FRAG, uniforms: {uTime: timeU, uOn, uCol}, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  return {mat, uOn, uCol};
}

const WATER_FRAG = `
uniform float uTime; uniform float uNight; uniform vec3 uRing;
varying vec3 vP;
void main(){
  float r = length(vP.xz);
  float w = sin(r * 70.0 - uTime * 3.0) * 0.5 + 0.5;
  float c1 = sin(vP.x * 60.0 + uTime * 1.3) * sin(vP.z * 55.0 - uTime * 1.1);
  float caust = smoothstep(0.55, 0.95, abs(c1));
  vec3 base = mix(vec3(0.08, 0.45, 0.6), vec3(0.04, 0.12, 0.3), uNight);
  vec3 col = base + vec3(0.2, 0.55, 0.65) * caust * (0.5 + 0.5 * uNight) + vec3(0.1, 0.25, 0.3) * w * 0.4 + uRing * smoothstep(0.85, 1.0, r / 0.11) * 0.8;
  gl_FragColor = vec4(col * (1.0 + 0.6 * uNight), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function waterMaterial() {
  const uNight = {value: 0}, uRing = {value: new THREE.Color(0xffffff)};
  const mat = new THREE.ShaderMaterial({vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: WATER_FRAG, uniforms: {uTime: timeU, uNight, uRing}});
  return {mat, uNight, uRing};
}
