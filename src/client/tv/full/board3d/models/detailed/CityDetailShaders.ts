// Shaders of the Detailed City and Capital (see CityDetailKit.ts). Procedural only: window grids of four facade
// styles, panel seams, grime and dust, solar cells, asphalt, plaza stone, neon, glass with fresnel; a motion shader
// for the small moving parts (rotation, ping-pong, loops, the shuttle's lift cycle); sprites for every light.
const HASH = `float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float p){ return fract(sin(p * 91.3458) * 47453.5453); }`;

// ---- the body: every building, tube, road, pad and plaza in one geometry ------------------------------------------
// aAnim = (baseY, delay, seed, W) with W: >0 and <5 window density; >=5 owner accent; 0 plain panels;
//   -1 self-lit; -2 solar; -3 asphalt; -4 plaza stone; -5 neon sign; -6 foliage.
// aSty  = (cell width, cell height, facade type 0 punched 1 ribbon 2 curtain 3 balcony, unused)
export const BODY_VS_PARS = `uniform float uAge; attribute vec4 aAnim; attribute vec4 aSty;
varying vec3 vOP; varying vec3 vON; varying vec4 vAn; varying vec4 vSt; varying float vK;`;
export const BODY_VS = `#include <begin_vertex>
vOP = position; vON = normal; vAn = aAnim; vSt = aSty;
if (aAnim.y < -0.5) {
  float st = clamp(uAge / 0.34, 0.0, 1.0);
  float drop = 1.0 - st * st;
  transformed.y += drop * 1.1; vK = 1.0;
} else {
  float t = clamp((uAge - aAnim.y) / 0.62, 0.0, 1.0), u = t - 1.0;
  float k = t <= 0.0 ? 0.0 : 1.0 + 2.3 * u * u * u + 1.3 * u * u;
  transformed.y = aAnim.x + (position.y - aAnim.x) * k; vK = t;
}`;
export const BODY_FS_PARS = `uniform float uAge; uniform float uNight; uniform float uTime; uniform float uMove; uniform vec3 uOwner; uniform float uLight;
varying vec3 vOP; varying vec3 vON; varying vec4 vAn; varying vec4 vSt; varying float vK;
${HASH}
float rect(vec2 f, vec2 aa, vec4 r) {
  vec2 a = smoothstep(r.xz - aa, r.xz + aa, f), b = 1.0 - smoothstep(r.yw - aa, r.yw + aa, f);
  return a.x * b.x * a.y * b.y;
}
float seam(float x, float a) { float d = min(fract(x), 1.0 - fract(x)); return 1.0 - smoothstep(0.0, max(a * 1.4, 0.03), d); }`;
export const BODY_FS_COLOR = `#include <color_fragment>
if (vK <= 0.0) discard;
float wm = 0.0, wLit = 0.0, reveal = 0.0, band = 0.0, accent = 0.0, selfLit = 0.0;
float rough = -1.0, metal = -1.0, glintK = 0.0;
vec3 wcol = vec3(0.0);
{
  float wave = uAge - (uLight + vOP.y * 0.42 + hash(vec2(vAn.z, 3.7)) * 0.3);
  reveal = smoothstep(0.0, 0.25, wave); band = exp(-wave * wave * 24.0);
}
float W = vAn.w;
bool wall = abs(vON.y) < 0.5;
vec3 base = diffuseColor.rgb;
float lowDust = exp(-max(vOP.y - 0.03, 0.0) * 9.0);
if (W >= 5.0) {
  accent = 1.0; base = uOwner; rough = 0.4; metal = 0.3;
} else if (W > 0.0) {
  if (wall && vOP.y > 0.06) {
    vec2 tg = normalize(vec2(-vON.z, vON.x));
    float u = dot(vOP.xz, tg), v = vOP.y;
    vec2 q = vec2(u / vSt.x, v / vSt.y);
    vec2 cell = floor(q), f = fract(q);
    vec2 aa = fwidth(q) * 1.1 + 1e-4;
    float ty = vSt.z;
    vec4 r = ty < 0.5 ? vec4(0.24, 0.76, 0.26, 0.74) : ty < 1.5 ? vec4(0.02, 0.98, 0.28, 0.72) : ty < 2.5 ? vec4(0.05, 0.95, 0.04, 0.96) : vec4(0.2, 0.8, 0.26, 0.84);
    wm = rect(f, aa, r);
    float far = smoothstep(0.45, 1.1, max(aa.x, aa.y));
    wm = mix(wm, 0.55, far);
    float h = hash(cell + vAn.z * 17.0), h2 = hash(cell * 1.7 + 3.1 + vAn.z), h3 = hash(cell * 2.3 + 9.7 + vAn.z);
    float row = hash(vec2(cell.y, vAn.z * 3.0));
    wLit = step(h, vAn.w * (0.45 + 0.95 * row));
    wcol = mix(vec3(1.0, 0.66, 0.32), vec3(0.74, 0.9, 1.0), step(0.8, h2));
    wcol = mix(wcol, vec3(1.0, 0.45, 0.6), step(0.97, h3) * 0.8);
    wcol *= 0.55 + 0.45 * hash(cell * 3.7 + vAn.z * 5.0);
    if (h3 > 0.96) wLit *= 0.35 + 0.65 * step(0.0, sin(uTime * (4.0 + h3 * 30.0) + h3 * 60.0) * uMove + (1.0 - uMove));
    // seams between wall panels, a balcony ledge line, vertical streaks of grime
    vec2 pf = vec2(u / 0.17, v / 0.13);
    vec2 pa = fwidth(pf);
    float sm = max(seam(pf.x, pa.x), seam(pf.y, pa.y)) * (1.0 - far) * (ty > 1.5 && ty < 2.5 ? 0.0 : 1.0);
    float ledge = ty > 2.5 ? step(f.y, 0.12) * (1.0 - far) : 0.0;
    float streak = hash(vec2(floor(u * 38.0), vAn.z)) * (0.5 + 0.5 * sin(v * 23.0 + h * 6.0));
    base *= 1.0 - 0.2 * sm * (1.0 - wm) - 0.32 * ledge - 0.12 * streak * (1.0 - wm);
    base = mix(base, vec3(0.62, 0.38, 0.26), 0.3 * lowDust);
    vec3 glassCol = mix(vec3(0.07, 0.12, 0.2), vec3(0.16, 0.3, 0.44), h2 * (ty > 1.5 && ty < 2.5 ? 0.45 : 0.5));
    diffuseColor.rgb = mix(base, glassCol, wm * 0.93);
    rough = mix(0.62, 0.1, wm); metal = mix(0.1, 0.7, wm);
    glintK = wm;
  } else if (vON.y > 0.5) {
    vec2 rp = vOP.xz / 0.06;
    vec2 ra = fwidth(rp);
    float g = max(seam(rp.x, ra.x), seam(rp.y, ra.y));
    float spk = hash(floor(vOP.xz * 70.0) + vAn.z);
    base *= 0.82 - 0.16 * g + 0.08 * spk;
    diffuseColor.rgb = base; rough = 0.8; metal = 0.15;
  } else diffuseColor.rgb = base;
} else if (W > -0.5) {
  // plain panelled shell
  vec2 tg = normalize(vec2(-vON.z, vON.x));
  float u = dot(vOP.xz, tg), v = vOP.y;
  vec2 pf = vec2(u / 0.1, v / 0.08); vec2 pa = fwidth(pf);
  float sm = wall ? max(seam(pf.x, pa.x), seam(pf.y, pa.y)) : max(seam(vOP.x / 0.07, pa.x), seam(vOP.z / 0.07, pa.y));
  diffuseColor.rgb = base * (1.0 - 0.2 * sm) ;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.38, 0.26), 0.28 * lowDust);
  rough = 0.55; metal = 0.35;
} else if (W > -1.5) {
  selfLit = 1.0;
} else if (W > -2.5) {
  // solar array: dark blue cells with silver seams
  vec2 sp = vOP.xz / 0.016; vec2 sa = fwidth(sp);
  float g = max(seam(sp.x, sa.x), seam(sp.y, sa.y));
  diffuseColor.rgb = mix(vec3(0.03, 0.06, 0.15), vec3(0.62, 0.68, 0.74), g * 0.8);
  rough = 0.3; metal = 0.65; glintK = 1.0 - g;
} else if (W > -3.5) {
  // asphalt and pad: speckle, worn
  float spk = hash(floor(vOP.xz * 160.0)) * 0.12;
  diffuseColor.rgb = base * (0.9 + spk);
  if (vSt.z > 0.5 && vON.y > 0.5) {
    vec2 gp = vOP.xz / 0.11; vec2 ga = fwidth(gp);
    float g = max(seam(gp.x, ga.x), seam(gp.y, ga.y));
    float tv = hash(floor(gp));
    diffuseColor.rgb = base * (0.85 + 0.3 * tv) * (1.0 - 0.28 * g);
  }
  rough = 0.9; metal = 0.0;
} else if (W > -4.5) {
  // plaza stone: square slabs, radial inlay lines
  vec2 sp = vOP.xz / 0.045; vec2 sa = fwidth(sp);
  float g = max(seam(sp.x, sa.x), seam(sp.y, sa.y));
  float spk = hash(floor(sp)) * 0.1;
  float ang = atan(vOP.x, vOP.z) * 8.0 / 6.2831853;
  float ia = fwidth(ang);
  float inlay = seam(ang, ia) * step(0.1, length(vOP.xz));
  diffuseColor.rgb = base * (0.94 + spk - 0.16 * g);
  diffuseColor.rgb = mix(diffuseColor.rgb, uOwner * 0.9, inlay * 0.55);
  accent = inlay * 0.6;
  rough = 0.7; metal = 0.1;
} else if (W > -5.5) {
  selfLit = 2.0;
} else {
  // foliage: tonal variation per spot
  float v = hash(floor(vOP.xz * 90.0 + vOP.y * 40.0));
  diffuseColor.rgb = base * (0.82 + 0.3 * v);
  rough = 0.95; metal = 0.0;
}`;
export const BODY_FS_ROUGH = `#include <roughnessmap_fragment>
if (rough >= 0.0) roughnessFactor = rough;`;
export const BODY_FS_METAL = `#include <metalnessmap_fragment>
if (metal >= 0.0) metalnessFactor = metal;`;
export const BODY_FS_EMIT = `#include <emissivemap_fragment>
{
  vec3 vd = normalize(vViewPosition);
  float fr = pow(1.0 - abs(dot(normal, vd)), 2.6);
  vec3 sky = mix(vec3(0.55, 0.33, 0.26), vec3(0.86, 0.66, 0.55), fr);
  totalEmissiveRadiance += wm * sky * (0.06 + 0.42 * fr) * (1.0 - uNight * 0.92) * reveal;
  totalEmissiveRadiance += glintK * vec3(0.9, 0.8, 0.7) * pow(max(0.0, sin(vOP.x * 7.0 + vOP.y * 3.0 - uTime * 0.5 * uMove)), 160.0) * 0.3 * (1.0 - uNight);
}
totalEmissiveRadiance += wm * wcol * wLit * (uNight * 1.35 * reveal + 0.06 * reveal);
totalEmissiveRadiance += wm * (1.0 - wLit) * vec3(0.03, 0.06, 0.12) * uNight * reveal;
totalEmissiveRadiance += wm * vec3(1.0, 0.92, 0.75) * band * (0.4 + wLit * 1.7);
if (accent > 0.5) totalEmissiveRadiance += uOwner * (0.5 + uNight * 1.4 + band * 1.5) * (W >= 5.0 ? 1.0 : 0.5);
if (selfLit > 0.5) {
  float fl = selfLit > 1.5 ? (0.6 + 0.4 * step(0.0, sin(uTime * (3.0 + vAn.z * 1.3) + vAn.z * 20.0) * uMove + (1.0 - uMove))) * (0.7 + 0.3 * sin(uTime * 11.0 * uMove + vAn.z)) : 1.0;
  totalEmissiveRadiance += diffuseColor.rgb * (0.12 + uNight * (selfLit > 1.5 ? 1.5 : 0.9)) * reveal * fl;
}`;

// ---- scaffolds: posts and braces that rise, then fall away --------------------------------------------------------
// aAnim = (baseY, appear, fall, seed)
export const SCAF_VS = `uniform float uAge; attribute vec4 aAnim; varying float vGone;
${HASH}`;
export const SCAF_VS_BODY = `#include <begin_vertex>
vGone = 0.0;
{
  float t = clamp((uAge - aAnim.y) / 0.42, 0.0, 1.0);
  float k = t <= 0.0 ? 0.0 : 1.0 - pow(1.0 - t, 3.0);
  transformed.y = aAnim.x + (position.y - aAnim.x) * k;
  float dt = max(uAge - aAnim.z, 0.0);
  float hh = hash1(aAnim.w), hh2 = hash1(aAnim.w + 7.0);
  transformed.y -= 3.2 * dt * dt;
  transformed.x += (hh - 0.5) * dt * 0.5; transformed.z += (hh2 - 0.5) * dt * 0.5;
  if (t <= 0.0 || dt > 0.0 && transformed.y < 0.0) vGone = 1.0;
  if (dt > 0.8) vGone = 1.0;
}`;
// ---- movers: rotation, ping-pong, loops, hover, the shuttle ---------------------------------------------------------
export const MOVER_VS_PARS = `uniform float uAge; uniform float uTime; uniform float uMove;
attribute vec3 aPiv; attribute vec4 aMv; attribute vec4 aDl; attribute float aE;
varying float vK; varying float vE; varying vec3 vOP;
${HASH}
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
float pp(float t) { return 0.5 - 0.5 * cos(t); }
float liftY(float p, float amp) {
  if (p < 0.5) return 0.0;
  if (p < 0.78) { float x = (p - 0.5) / 0.28; return amp * x * x * x; }
  if (p < 0.86) return -1.0;
  float e = 1.0 - (p - 0.86) / 0.14; return amp * e * e;
}
void motion(out float ang, out vec3 off, out float sc, out vec3 rc) {
  float kind = aMv.x, sp = aMv.y, ph = aMv.z, am = aMv.w;
  ang = 0.0; off = vec3(0.0); sc = 1.0; rc = aPiv;
  float t = uTime * sp + ph;
  if (kind < 0.5) { }
  else if (kind < 1.5) ang = t;
  else if (kind < 2.5) off = aDl.xyz * pp(t);
  else if (kind < 3.5) { float s = fract(t); off = aDl.xyz * s; sc = smoothstep(0.0, 0.06, s) * smoothstep(1.0, 0.94, s); }
  else if (kind < 4.5) off.y = am * sin(t);
  else if (kind < 5.5) { ang = am * pp(t); rc = vec3(0.0); }
  else if (kind < 6.5) {
    float p = uMove > 0.5 ? fract(uTime / sp + ph) : 0.1;
    float y = liftY(p, am);
    if (y < 0.0) sc = 0.0; else off.y = y;
  }
  else { float s = fract(t); ang = am * s; rc = vec3(0.0); if (am < 6.0) sc = smoothstep(0.0, 0.04, s) * smoothstep(1.0, 0.96, s); }
  float a = clamp((uAge - aDl.w) / 0.5, 0.0, 1.0);
  float ea = a <= 0.0 ? 0.0 : 1.0 - pow(1.0 - a, 3.0);
  sc *= ea; off.y += (1.0 - ea) * 0.35;
  vK = a;
}`;
export const MOVER_VS_NORMAL = `float mAng; vec3 mOff; float mSc; vec3 mRc;
motion(mAng, mOff, mSc, mRc);
vec3 objectNormal = rotY(vec3(normal), mAng);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`;
export const MOVER_VS_BEGIN = `vec3 transformed = aPiv + (position - aPiv) * max(mSc, 0.0001);
transformed = mRc + rotY(transformed - mRc, mAng) + mOff;
vOP = position; vE = aE;`;
export const MOVER_FS_PARS = `uniform float uNight; uniform float uTime; uniform float uMove; uniform vec3 uOwner; varying float vK; varying float vE; varying vec3 vOP;`;
export const MOVER_FS_COLOR = `#include <color_fragment>
if (vK <= 0.0) discard;
if (vE > 1.5) diffuseColor.rgb = uOwner;`;
export const MOVER_FS_EMIT = `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vE * (0.15 + uNight * 1.5);`;

// ---- domes: glass with fresnel, a triangulated frame, sheen and an interior glow ------------------------------------
export const DOME_VS = `uniform float uAge; attribute vec2 aUV; attribute vec4 aCtr;
varying vec3 vWP; varying vec3 vN; varying vec2 vUV; varying float vS;
void main() {
  float t = clamp((uAge - aCtr.w) / 0.62, 0.0, 1.0), u = t - 1.0;
  float s = t <= 0.0 ? 0.0 : 1.0 + 2.6 * u * u * u + 1.6 * u * u;
  vec3 c = aCtr.xyz; vec3 p = c + (position - c) * s;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vUV = aUV; vS = t;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const DOME_FS = `uniform float uAge; uniform float uNight; uniform float uTime; uniform float uMove; uniform float uLight;
varying vec3 vWP; varying vec3 vN; varying vec2 vUV; varying float vS;
float lineAt(float x, float w) { float d = abs(fract(x - 0.5) - 0.5); return 1.0 - smoothstep(0.0, w, d); }
void main() {
  if (vS <= 0.0) discard;
  vec3 V = normalize(cameraPosition - vWP); vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float fr = pow(1.0 - abs(dot(N, V)), 2.3);
  vec3 L = normalize(vec3(0.4, 0.8, 0.5));
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 40.0) * (1.0 - uNight * 0.75);
  float streak = pow(max(0.0, sin(dot(vWP.xz, vec2(1.0, 0.6)) * 13.0 + uTime * 0.7 * uMove)), 40.0) * fr;
  vec2 fw = max(fwidth(vUV), vec2(0.0001));
  float lon = lineAt(vUV.x, 1.2 * fw.x);
  float lat = lineAt(vUV.y, 1.2 * fw.y);
  float dia = lineAt(vUV.x + vUV.y, 1.2 * (fw.x + fw.y) * 0.5) * 0.7;
  float line = max(max(lon, lat), dia);
  line *= 1.0 - smoothstep(0.35, 0.8, max(fw.x, fw.y));
  float pane = 0.5 + 0.5 * sin(vUV.x * 6.28 * 0.5) * sin(vUV.y * 3.14);
  vec3 sky = mix(vec3(0.5, 0.78, 0.9), vec3(0.95, 0.72, 0.6), 0.5 * (1.0 - fr));
  vec3 col = vec3(0.3, 0.55, 0.72) * 0.2 + sky * fr * 1.1 + vec3(1.0, 0.8, 0.5) * uNight * (0.2 + 0.2 * (1.0 - fr)) * smoothstep(uLight - 0.2, uLight + 0.6, uAge);
  col += vec3(0.82, 0.96, 1.0) * line * (0.55 + uNight * 0.5) + vec3(1.0) * (spec * 0.9 + streak * 0.6);
  float a = 0.08 + 0.5 * fr + line * 0.55 + spec * 0.6 + streak * 0.4 + uNight * 0.08 + 0.03 * pane;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
  #include <colorspace_fragment>
}`;

// ---- light sprites -----------------------------------------------------------------------------------------------
// kinds: 0 steady, 1 beacon blink, 3 dust puff, 4 line ping-pong, 5 owner, 6 crown, 7 neon flicker, 8 shuttle flame,
//        9 arc ping-pong about the centre, 10 arc loop about the centre, 11 slow shimmer
export const GLOW_VS = `attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aV; attribute vec3 aCol;
uniform float uAge; uniform float uTime; uniform float uMove; uniform float uR; uniform float uNight; uniform vec3 uOwner; uniform float uLight;
varying vec2 vC; varying vec3 vCol; varying float vI; varying float vFlare;
float pp(float t) { return 0.5 - 0.5 * cos(t); }
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
float liftY(float p, float amp) {
  if (p < 0.5) return 0.0;
  if (p < 0.78) { float x = (p - 0.5) / 0.28; return amp * x * x * x; }
  if (p < 0.86) return -1.0;
  float e = 1.0 - (p - 0.86) / 0.14; return amp * e * e;
}
void main() {
  float kind = aP.y; float size = aP.x; float ph = aP.z; float dl = aP.w;
  vec3 pos = position; float I = 1.0; vFlare = 0.0; vec3 col = aCol;
  float on = smoothstep(dl, dl + 0.1, uAge);
  float glint = uAge > dl ? exp(-(uAge - dl) * 5.0) * 2.5 : 0.0;
  float lvl = 0.14 + 0.86 * uNight;
  float tm = uTime * uMove;
  if (kind < 0.5) { I = on * lvl * (1.0 + glint) * (0.9 + 0.1 * sin(tm * 2.0 + ph)); }
  else if (kind < 1.5) {
    float b = mix(1.0, pow(0.5 + 0.5 * sin(uTime * aV.w + ph), 5.0), uMove);
    I = on * (0.55 + 0.45 * uNight) * (0.12 + 0.88 * b) * (1.0 + glint); vFlare = 1.0;
  } else if (kind < 3.5) {
    float k = clamp((uAge - dl) / 1.0, 0.0, 1.0);
    pos += aV.xyz * (1.0 - (1.0 - k) * (1.0 - k));
    I = (uAge > dl ? 1.0 : 0.0) * (1.0 - k) * min(k * 10.0, 1.0) * 0.14; size *= 1.0 + k * 1.4;
  } else if (kind < 4.5) {
    float s = pp(uTime * aV.w + ph);
    pos += aV.xyz * s; I = on * (0.85 + 0.4 * uNight); vFlare = 0.3;
  } else if (kind < 5.5) {
    col = uOwner; I = on * (0.7 + 0.6 * uNight) * (0.9 + 0.1 * sin(tm * 2.0 + ph)) * (1.0 + glint);
  } else if (kind < 6.5) {
    I = on * (0.55 + 0.9 * uNight) * (1.0 + glint * 1.5) * (0.88 + 0.12 * sin(tm * 1.5)); vFlare = 1.0;
  } else if (kind < 7.5) {
    float fl = 0.55 + 0.45 * step(0.0, sin(tm * (2.0 + ph * 0.7) + ph * 40.0)) * (0.75 + 0.25 * sin(tm * 17.0 + ph));
    I = on * (0.4 + 1.1 * uNight) * fl;
  } else if (kind < 8.5) {
    float P = aV.w;
    float p = uMove > 0.5 ? fract(uTime / P + ph) : 0.1;
    float y = liftY(p, aV.x);
    float burn = (p > 0.47 && p < 0.78) || p > 0.86 ? 1.0 : 0.0;
    if (y < 0.0) { burn = 0.0; y = 0.0; }
    pos.y += y;
    I = on * burn * (1.1 + 0.5 * sin(uTime * 60.0)); size *= 1.0 + 0.4 * burn;
  } else if (kind < 9.5) {
    float ang = aV.x * pp(uTime * aV.y + ph);
    pos = rotY(pos, ang); I = on * (0.9 + 0.5 * uNight); vFlare = 0.3;
  } else if (kind < 10.5) {
    float s = fract(uTime * aV.y + ph);
    pos = rotY(pos, aV.x * s); I = on * (0.9 + 0.5 * uNight) * smoothstep(0.0, 0.04, s) * smoothstep(1.0, 0.96, s);
  } else {
    I = on * lvl * (0.7 + 0.3 * sin(tm * 0.8 + ph * 5.0)) * (1.0 + glint);
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float sz = size * uR;
  mv.xy += aCorner * sz; mv.z += sz * 0.5;
  gl_Position = projectionMatrix * mv;
  vC = aCorner; vCol = col; vI = I;
}`;
export const GLOW_FS = `varying vec2 vC; varying vec3 vCol; varying float vI; varying float vFlare;
void main() {
  float d = length(vC); if (d > 1.0) discard;
  float halo = exp(-d * d * 5.0), core = exp(-d * d * 38.0);
  float fl = vFlare * (exp(-abs(vC.x) * 20.0) * exp(-abs(vC.y) * 2.2) + exp(-abs(vC.y) * 20.0) * exp(-abs(vC.x) * 2.2));
  float fade = 1.0 - smoothstep(0.35, 1.0, d);
  vec3 c = (vCol * (halo * 0.6 + fl * 0.85) + vec3(1.0) * core * 0.9) * fade;
  gl_FragColor = vec4(c * vI, 1.0);
  #include <colorspace_fragment>
}`;

// ---- the base: owner ring, stamp flash, shock ring, night light pools --------------------------------------------
export const BASE_VS = `varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export const BASE_FS = `uniform float uAge; uniform float uNight; uniform float uTime; uniform float uMove; uniform vec3 uOwner; uniform vec4 uBlob[6]; uniform float uLight;
varying vec2 vP;
void main() {
  vec2 p = vP; float r = length(p);
  float hd = max(abs(p.y) * 0.8660254 + abs(p.x) * 0.5, abs(p.x));
  float a = atan(p.x, p.y); float an = a / 6.2831853 + 0.5;
  float rev = clamp((uAge - 0.08) / 0.7, 0.0, 1.0);
  float vis = step(an, rev * 1.02);
  float chase = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(a * 3.0 - uTime * 1.4 * uMove), 3.0);
  float ring = 1.0 - smoothstep(0.014, 0.03, abs(hd - 0.83));
  float ticks = 0.5 + 0.5 * step(0.5, fract(a * 24.0 / 6.2831853));
  vec3 col = uOwner * ring * (1.2 + uNight * 1.0) * chase * vis * ticks;
  col += uOwner * 0.3 * exp(-pow((hd - 0.83) * 13.0, 2.0)) * vis * (0.6 + uNight);
  col += uOwner * 0.3 * (1.0 - smoothstep(0.004, 0.012, abs(hd - 0.79))) * vis * (0.5 + uNight);
  col += vec3(1.0, 0.9, 0.7) * exp(-uAge * 5.0) * 0.25 * step(hd, 0.9);
  float wr = (uAge - 0.22) * 2.4;
  col += mix(uOwner, vec3(1.0), 0.5) * exp(-pow((r - wr) * 8.0, 2.0)) * clamp(1.0 - (uAge - 0.22) * 0.9, 0.0, 1.0) * step(0.22, uAge) * 0.9;
  float pool = 0.0;
  for (int i = 0; i < 6; i++) { vec4 b = uBlob[i]; vec2 q = p - b.xy; pool += b.w * exp(-dot(q, q) / (b.z * b.z)); }
  pool += 0.25 * (1.0 - smoothstep(0.2, 0.9, hd));
  col += vec3(1.0, 0.68, 0.38) * pool * uNight * 0.38 * clamp((uAge - (uLight - 0.2)) / 0.6, 0.0, 1.0);
  col *= 1.0 - smoothstep(0.88, 0.95, hd);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
