// GLSL for the Detailed Ocean (Ocean.tsx): the water surface (full: translucent over a real sea floor; lite: opaque with
// the floor painted in), the sea floor, kelp, fish, gulls, motes (plankton, shore spray, buoy glow, build-in droplets)
// and the vent jets. World xz drives the swell, so adjacent oceans carry one continuous sea.
// Heights are local to the prism top: floor FLOOR, waterline WY, beach crest SHORE_H.

export const COMMON = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uAge;      // seconds since placed (99 = standing)
uniform float uR;        // hex circumradius
uniform vec3  uSeed;     // per-instance randoms 0..1
uniform float uScale;    // screen px per world unit at distance 1 (for points)
uniform vec3  uFl[3];    // ice floes: local x, z, radius (0 = none)
uniform vec4  uBuoy;     // x, y, z, scale (0 = absent)
uniform vec3  uRaft;     // x, z, scale
uniform vec3  uBird[3];  // x, z, height (negative = absent)
uniform vec3  uPatch[6]; // kelp beds: x, z, radius
uniform float uOpen[6];  // 1 = another ocean borders this edge (no beach there)

#define PI 3.14159265
const float WY = 0.016;
const float FLOOR = 0.001;
const float SHORE_H = 0.022;

float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p){ float n = hash21(p); return vec2(n, hash21(p + n + 17.3)); }
vec3 noised(vec2 x){
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
float sq(float x){ return x * x; }
float ss(float e0, float e1, float x){ float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float easeOut(float x){ x = clamp(x, 0.0, 1.0); return 1.0 - pow(1.0 - x, 3.0); }
vec3 S(float r, float g, float b){ return pow(vec3(r, g, b), vec3(2.2)); }
// hex distance, 1.0 on the rim (pointy-top hex, flat edges face +-x)
float hexN(vec2 p, float R){
  const vec2 n0 = vec2(1.0, 0.0), n1 = vec2(0.5, 0.8660254), n2 = vec2(-0.5, 0.8660254);
  float d = max(abs(dot(p, n0)), max(abs(dot(p, n1)), abs(dot(p, n2))));
  return d / (R * 0.8660254);
}
// distance to the nearest rim edge (world units) and its gradient
vec3 hexEdge(vec2 p, float R){
  const vec2 n0 = vec2(1.0, 0.0), n1 = vec2(0.5, 0.8660254), n2 = vec2(-0.5, 0.8660254);
  float d0 = dot(p, n0), d1 = dot(p, n1), d2 = dot(p, n2);
  vec2 n = n0; float d = d0;
  if (abs(d1) > abs(d)) { n = n1; d = d1; }
  if (abs(d2) > abs(d)) { n = n2; d = d2; }
  return vec3(R * 0.8660254 - abs(d), -sign(d) * n);
}
// ---- the shore field: beaches only on edges with no ocean neighbour; each beach tapers out toward an open edge --------
// edges run clockwise seen from above, starting with the edge between the +z corner and the next one clockwise
const vec2 EN[6] = vec2[6](vec2(-0.5, 0.8660254), vec2(-1.0, 0.0), vec2(-0.5, -0.8660254), vec2(0.5, -0.8660254), vec2(1.0, 0.0), vec2(0.5, 0.8660254));
// returns (shore distance 0 = open sea .. 1 = on a beach edge, beach height above FLOOR); nrm = outward normal of the dominant beach
vec2 shoreField(vec2 L, out vec2 nrm){
  float hd[6];
  for (int i = 0; i < 6; i++) hd[i] = dot(L, EN[i]) / (uR * 0.8660254);
  float sh = 0.0, h = 0.0;
  nrm = vec2(1.0, 0.0);
  for (int i = 0; i < 6; i++) {
    if (uOpen[i] > 0.5) continue;
    int a = (i + 5) % 6, b = (i + 1) % 6;
    float g = 1.0;
    if (uOpen[a] > 0.5) g = min(g, ss(0.0, 0.25, hd[i] - hd[a]));
    if (uOpen[b] > 0.5) g = min(g, ss(0.0, 0.25, hd[i] - hd[b]));
    float v = hd[i] * g;
    if (v > sh) { sh = v; nrm = EN[i]; }
    h = max(h, ss(0.70, 1.0, hd[i]) * g * (SHORE_H - FLOOR));
  }
  return vec2(sh, h);
}
// true on the beach ring's footprint (the closed-edge sector beyond 0.86), where the sea floor is left to the shore mesh
bool inBeachRing(vec2 L){
  float best = -9.0; int bi = 0;
  for (int i = 0; i < 6; i++) { float d = dot(L, EN[i]); if (d > best) { best = d; bi = i; } }
  return uOpen[bi] < 0.5 && best / (uR * 0.8660254) > 0.86;
}

// ---- the swell: travelling sine trains, returns (height, d/dx, d/dz) -------------------------------------
void wv(inout vec3 r, vec2 p, vec2 d, float k, float w, float a){
  d = normalize(d);
  float ph = dot(p, d) * k + w * uTime;
  r.x += a * sin(ph);
  r.yz += d * (a * k * cos(ph));
}
vec3 swell(vec2 p, int n){
  vec2 q = p + 0.010 * vec2(sin(p.y * 23.0 + uTime * 0.35), cos(p.x * 19.0 - uTime * 0.30));
  vec3 r = vec3(0.0);
  wv(r, q, vec2(0.86, 0.51), 26.0, 1.25, 0.0017);
  wv(r, q, vec2(-0.40, 0.92), 37.0, 1.55, 0.0012);
  wv(r, q, vec2(0.12, -0.99), 55.0, 1.9, 0.0007);
  if (n > 3) {
    wv(r, q, vec2(-0.92, -0.38), 84.0, 2.5, 0.00035);
    wv(r, q, vec2(0.55, 0.83), 130.0, 3.1, 0.0002);
  }
  return r;
}
// swells running in toward the shore, growing as they shoal; (height, gx, gz, crest 0..1). sh/nrm come from shoreField.
vec4 shoreSwell(float sh, vec2 nrm){
  float e = uR * 0.8660254 * (1.0 - sh);
  float ph = e * 70.0 + uTime * 2.3;
  float amp = 0.0016 * ss(0.17, 0.02, e) * (0.6 + 1.5 * ss(0.10, 0.01, e));
  float s = sin(ph);
  return vec4(amp * s, -nrm * (amp * 70.0 * cos(ph)), 0.5 + 0.5 * s);
}
// the five vents (the build-in): centre plus four around it
vec2 ventPos(int i){
  if (i == 0) return vec2(0.0);
  float ang = uSeed.x * 6.283 + float(i - 1) * 1.5708 + 0.4 * sin(float(i) * 3.0);
  return vec2(cos(ang), sin(ang)) * uR * 0.5;
}
float ventDelay(int i){ return i == 0 ? 0.0 : 0.10 + 0.12 * float(i); }
// rings running out from every vent and dying away: (height, gx, gz)
vec3 ventRings(vec2 L){
  vec3 o = vec3(0.0);
  float a = uAge;
  if (a > 5.0) return o;
  for (int i = 0; i < 5; i++) {
    float tau = a - ventDelay(i);
    if (tau < 0.0) continue;
    vec2 d = L - ventPos(i);
    float rr = length(d) / uR;
    float k = max(tau - 0.15, 0.0);
    float ph = rr * 24.0 - k * 10.0;
    float amp = (i == 0 ? 0.0016 : 0.001) * exp(-k * 1.15) * ss(0.0, 0.4, tau - rr * 0.5);
    o.x += amp * sin(ph);
    vec2 dir = d / max(length(d), 1e-4);
    o.yz += dir * (amp * cos(ph) * 24.0 / uR);
  }
  return o;
}
float blink(float t, float seed){
  float ph = fract(t / 2.6 + seed);
  return ss(0.0, 0.02, ph) * ss(0.15, 0.11, ph) + ss(0.22, 0.24, ph) * ss(0.36, 0.32, ph);
}
float floodFront(float a){ return a > 3.4 ? 2.0 : easeOut((a - 0.15) / 1.05) * 1.1; }

// ---- optical depth 0 (waterline) .. 1 (deep), with sandbars; open sea is deep, world noise only so neighbours match -----
float odOf(vec2 p, float sh, float beach){
  float n = noised(p * 7.0).x, lo = noised(p * 2.3 + 5.0).x;
  float od = ss(0.90, 0.38, sh) * (0.66 + 0.34 * ss(0.30, 0.62, lo)) + (n - 0.5) * 0.3;
  float depth = WY - (FLOOR + beach);
  return clamp(od, 0.0, 1.0) * ss(0.0, 0.008, depth);
}

vec3 skyCol(vec3 d, vec3 sunD, vec3 moonD){
  float h = clamp(d.y, 0.0, 1.0);
  vec3 dayH = S(0.80, 0.46, 0.34), dayM = S(0.56, 0.50, 0.50), dayZ = S(0.16, 0.30, 0.52);
  vec3 nigH = S(0.10, 0.16, 0.32), nigZ = S(0.012, 0.02, 0.06);
  vec3 day = mix(dayH, dayM, ss(0.0, 0.25, h));
  day = mix(day, dayZ, ss(0.2, 0.9, h));
  vec3 night = mix(nigH, nigZ, ss(0.0, 0.6, h));
  vec3 c = mix(day, night, uNight);
  // wisps of cloud
  float cl = ss(0.52, 0.86, noised(d.xz / (d.y + 0.25) * 1.3 + vec2(uTime * 0.012, 0.0)).x) * ss(0.0, 0.3, d.y);
  c = mix(c, mix(S(0.95, 0.72, 0.62), S(0.12, 0.16, 0.30), uNight), cl * 0.38);
  float s = max(dot(d, sunD), 0.0);
  c += S(1.0, 0.55, 0.25) * (pow(s, 6.0) * 0.10 + pow(s, 90.0) * 0.35 + pow(s, 3000.0) * 12.0) * (1.0 - uNight);
  float m = max(dot(d, moonD), 0.0);
  c += S(0.62, 0.78, 1.0) * (pow(m, 10.0) * 0.18 + pow(m, 500.0) * 6.0) * uNight;
  return c;
}

// ---- the sea floor: sand ripples, pebbles, kelp beds and caustics ---------------------------------------------
float caustic(vec2 p, float t){
  vec2 pp = mod(p * 40.0, 6.2831853) - 250.0;
  vec2 i = pp; float c = 1.0; float inten = 0.0055;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = pp + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(pp.x / (sin(i.x + tt) / inten), pp.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
vec3 seabedLit(vec2 p, vec2 L, float od, vec2 refr, float wet){
  vec2 q = p + refr;
  float T = uTime;
  float nA = noised(q * 13.0).x, nB = noised(q * 61.0 + 3.0).x;
  vec3 sandL = S(0.90, 0.78, 0.52), sandD = S(0.55, 0.45, 0.33);
  vec3 c = mix(sandD, sandL, ss(0.25, 0.8, nA * 0.7 + nB * 0.5));
  c *= 0.88 + 0.12 * sin(dot(q, vec2(0.8, 0.6)) * 190.0 + nA * 9.0);
  vec2 cp = q * 110.0, ci = floor(cp);
  float hh = hash21(ci);
  float peb = step(0.78, hh) * ss(0.30, 0.12, length(fract(cp) - 0.5 + (hash22(ci) - 0.5) * 0.4));
  c = mix(c, S(0.36, 0.33, 0.30) * (0.6 + hh), peb * 0.8);
  float bed = 0.0;
  for (int i = 0; i < 6; i++) bed = max(bed, ss(1.0, 0.25, length(L - uPatch[i].xy) / max(uPatch[i].z, 1e-3)));
  c = mix(c, S(0.07, 0.15, 0.08), bed * 0.8);
  c *= mix(1.25, 1.0, wet);   // dry sand is paler until the flood wets it
  float day = 1.0 - uNight;
  float caus = clamp(caustic(q, T * 0.55 + 23.0), 0.0, 1.5);
  c += S(0.70, 1.0, 0.95) * caus * 0.62 * (1.0 - ss(0.25, 0.95, od) * 0.8) * (day * 0.9 + uNight * 0.18) * wet;
  c *= mix(1.0, 0.10, uNight);
  return c;
}
`;

// ---- the water surface -----------------------------------------------------------------------------------------
export const WATER_VERT = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec2 vLocal;
varying float vCrest;
void main(){
  vec3 p = position;
  p.xz *= uR;
  vec2 L = p.xz;
  vec4 w0 = modelMatrix * vec4(p, 1.0);
  float r = length(L) / uR;
  float a = uAge;
  vec2 nr; vec2 sf = shoreField(L, nr);
  float y = WY + swell(w0.xz, 3).x + shoreSwell(sf.x, nr).x - 0.010 * ss(0.84, 0.93, sf.x);
  float crest = 0.0;
  if (a < 6.0) {
    float rf = floodFront(a);
    // the water rises behind the flood front, then settles after a slosh
    float fill = ss(0.0, 0.8, a - 0.15 - r * 0.9);
    y -= 0.012 * (1.0 - fill);
    float k = max(a - 1.0, 0.0);
    y += 0.0035 * exp(-k * 1.1) * sin(k * 7.0) * step(0.0, a - 1.0) * (1.0 - r * 0.4);
    crest = exp(-sq((r - rf) / 0.12)) * ss(0.0, 0.2, a - 0.1) * (1.0 - ss(1.0, 1.5, a));
    y += crest * 0.006;
    // every vent boils up a mound
    for (int i = 0; i < 5; i++) {
      float tau = a - ventDelay(i);
      float jet = ss(0.0, 0.25, tau) * (1.0 - ss(0.9, 1.6, tau));
      y += jet * (i == 0 ? 0.013 : 0.007) * exp(-sq(length(L - ventPos(i)) / (uR * (i == 0 ? 0.22 : 0.14)))) * (0.7 + 0.3 * sin(tau * 30.0));
    }
    y += ventRings(L).x;
  }
  vCrest = crest;
  p.y = y;
  vLocal = L;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const WATER_FRAG = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec2 vLocal;
varying float vCrest;

void main(){
  float R = uR;
  vec2 L = vLocal;
  float r = length(L) / R;
  float a = uAge;
  float rf = floodFront(a);
  if (r > rf) discard;
  vec2 nr; vec2 sf = shoreField(L, nr);
  float e = R * 0.8660254 * (1.0 - sf.x);
  vec2 p = vWorld.xz;
  float T = uTime;

  // ---- normal: swell trains, shoreward swells, vent rings and two scrolling capillary layers -----------------
  vec3 sw = swell(p, 5);
  vec4 ssw = shoreSwell(sf.x, nr);
  vec3 vr = ventRings(L);
  vec3 n1 = noised(p * 75.0 + vec2(T * 0.55, T * 0.32));
  vec3 n2 = noised(p * 160.0 + vec2(-T * 0.7, T * 0.45) + 7.3);
  vec3 n3 = noised(p * 30.0 + vec2(T * 0.16, -T * 0.21) + 3.1);
  vec2 g = (sw.yz + ssw.yz + vr.yz) * 1.5 + n1.yz * 0.035 + n2.yz * 0.014 + n3.yz * 0.03;
  vec2 radial = L / max(length(L), 1e-4);
  g += radial * (vCrest * 1.4) * -sign(r - rf);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);

  vec3 sunD = normalize(vec3(-0.6, 0.42, -0.62));
  vec3 moonD = normalize(vec3(0.42, 0.50, -0.75));
  vec3 lightD = normalize(mix(sunD, moonD, uNight));
  vec3 lightCol = mix(S(1.0, 0.72, 0.42), S(0.7, 0.85, 1.0), uNight);
  float night = uNight;

  float od = odOf(p, sf.x, sf.y);
  // physical depth above the sea floor and swash line (the beach is the geometry; this only decides foam)
  float level = WY + sw.x + ssw.x;
  float depth = level - (FLOOR + sf.y);
  float wet = ss(0.0, 0.5, a - 0.15 - r * 0.9 + 0.35);

  // ---- body colour -------------------------------------------------------------------------------------------
  vec3 deep = mix(S(0.015, 0.22, 0.42), S(0.003, 0.025, 0.12), night);
  vec3 mid  = mix(S(0.03, 0.48, 0.64), S(0.005, 0.07, 0.26), night);
  vec3 shal = mix(S(0.22, 0.88, 0.76), S(0.01, 0.14, 0.34), night);
  vec3 body = mix(shal, mid, ss(0.0, 0.45, od));
  body = mix(body, deep, ss(0.35, 1.0, od));
  float diff = clamp(dot(N, lightD) * 0.5 + 0.5, 0.0, 1.0);
  body *= 0.5 + 0.9 * diff * mix(1.0, 0.35, night);
  // light scattering through thin wave crests
  float crestK = ss(-0.0005, 0.0035, sw.x + ssw.x);
  body += mix(S(0.12, 0.62, 0.58), S(0.02, 0.15, 0.25), night) * (crestK * 0.28 + pow(1.0 - ndv, 2.0) * 0.3) * (0.4 + 0.6 * (1.0 - od));

  // ---- the floor, seen through the surface (lite paints it in; full draws it as geometry underneath) ------------
  vec2 refr = g * (0.9 * od + 0.1) * 0.5;
  #ifdef LITE
  vec3 floorC = seabedLit(p, L, od, refr, 1.0);
  #endif

  // ---- sky reflection ------------------------------------------------------------------------------------------
  vec3 Rv = reflect(-V, N);
  Rv.y = abs(Rv.y);
  float fres = clamp(0.03 + 0.97 * pow(1.0 - ndv, 3.8), 0.0, 1.0);
  vec3 refl = skyCol(Rv, sunD, moonD);
  refl = mix(refl, vec3(dot(refl, vec3(0.33))) * vec3(0.8, 1.0, 1.15), 0.45 * (1.0 - night));
  vec3 col = mix(body, refl * mix(0.5, 0.8, night), fres);
  float absorb = 1.0 - exp(-od * 2.1);
  float alpha = clamp(0.34 + 0.6 * absorb + fres * 0.5, 0.0, 1.0);

  // ---- sun and moon glints, glitter and the moon path --------------------------------------------------------
  vec3 H = normalize(lightD + V);
  float nh = max(dot(N, H), 0.0);
  col += lightCol * pow(nh, 700.0) * 1.6;
  vec2 gp = p * 420.0, gi = floor(gp);
  float gr = hash21(gi);
  float tw = 0.5 + 0.5 * sin(T * (2.0 + gr * 5.0) + gr * 40.0);
  float facet = ss(0.93, 1.0, gr) * ss(0.35, 1.0, tw) * ss(0.5, 0.2, length(fract(gp) - 0.5));
  col += lightCol * facet * pow(nh, 220.0) * 40.0 * (1.0 - night);
  // a net of light across the whole surface as sun and moon focus through the swell, and a fine ripple shimmer
  float net = clamp(caustic(p * 0.8 + sw.yz * 0.3, T * 0.4 + 7.0), 0.0, 1.0);
  col += lightCol * net * 0.13 * (1.0 - night) * (0.45 + 0.55 * od);
  col += lightCol * (pow(nh, 60.0) * 0.22 + pow(nh, 14.0) * 0.06) * (1.0 - night);
  alpha = max(alpha, clamp(net * 0.3 * (1.0 - night), 0.0, 1.0));
  // the moon path: a broad lane of sparkle under the moon, strongest where the swell tilts facets toward the eye
  float lane = pow(nh, 60.0) * ss(0.25, 0.9, tw);
  float mfacet = ss(0.9, 1.0, hash21(floor(p * 150.0 + 11.0)));
  col += S(0.55, 0.78, 1.0) * (lane * 0.22 + lane * mfacet * 1.8) * night;
  alpha = max(alpha, clamp(lane * night * 0.8, 0.0, 1.0));

  // ---- night: bioluminescent plankton, soft cyan-blue streaks and clouds flowing with the swell --------------------
  if (night > 0.02) {
    vec2 sp = p * 10.0;
    for (int i = 0; i < 3; i++) sp += 0.8 * vec2(sin(sp.y * 1.2 + T * 0.25 + float(i)), sin(sp.x * 1.0 - T * 0.20 + float(i) * 2.0));
    float f1 = pow(1.0 - abs(sin(sp.x * 1.7 + sp.y * 1.1)), 4.0);
    float f2 = pow(1.0 - abs(sin(sp.x * 1.0 - sp.y * 1.5 + 1.3)), 6.0);
    float cloud = ss(0.30, 0.75, noised(p * 6.0 + vec2(T * 0.04, -T * 0.03)).x);
    float haze = ss(0.3, 0.9, noised(p * 3.0 + T * 0.02).x);
    float bio = (f1 * 0.8 + f2 * 0.6) * cloud + haze * 0.10;
    bio *= (0.55 + 0.45 * od) * ss(0.0, 0.02, depth);
    bio *= 0.75 + 0.6 * ss(0.0, 0.6, length(g));
    col += mix(S(0.03, 0.55, 0.85), S(0.1, 0.85, 1.0), f1 * cloud) * bio * night * 1.5;
    alpha = max(alpha, clamp(bio * night * 1.8, 0.0, 1.0));
  }

  // ---- props' wakes and glows: buoy, raft and floes -------------------------------------------------------------
  {
    float sp = exp(-sq((a - 2.15) / 0.3));
    float db = length(L - uBuoy.xz);
    float pr = 0.032 + 0.006 * sin(T * 1.7);
    float ringB = ss(0.007, 0.0, abs(db - pr)) * uBuoy.w * (0.4 + 0.6 * noised(p * 90.0 + T * 0.3).x);
    float collar = ss(0.03, 0.012, db) * uBuoy.w;
    float lf = blink(T, uSeed.z);
    vec3 wake = mix(S(0.95, 0.98, 1.0), S(0.2, 0.9, 0.85), night);
    float bw = clamp(ringB * 0.55 + collar * 0.2 + sp * ss(0.12, 0.0, abs(db - 0.02 - (a - 1.9) * 0.1)) * 0.9, 0.0, 1.0);
    col = mix(col, wake * mix(1.0, 0.9, night), bw);
    alpha = max(alpha, bw);
    col += S(1.0, 0.35, 0.18) * sq(ss(0.11, 0.0, db)) * lf * 0.8 * (0.15 + 0.85 * night);   // the lantern's light on the water
    float dr = length(L - uRaft.xy);
    float ringR = ss(0.01, 0.0, abs(dr - 0.108 - 0.004 * sin(T * 1.3))) * uRaft.z * 0.7;
    float rw = ringR * (0.18 + 0.3 * noised(p * 90.0 + T * 0.3).x);
    col = mix(col, wake, rw);
    alpha = max(alpha, rw);
    for (int i = 0; i < 3; i++) {
      if (uFl[i].z <= 0.0) continue;
      float d = length(L - uFl[i].xy) - uFl[i].z;
      float melt = ss(0.02, 0.0, d) * ss(-0.01, 0.0, d);
      float lace = ss(0.5, 0.8, noised(p * 130.0 + T * 0.2).x);
      col = mix(col, mix(S(0.2, 0.7, 0.85), S(0.9, 0.97, 1.0), lace), melt * (0.4 + 0.3 * lace));
      alpha = max(alpha, melt * 0.8);
    }
    // gull shadows
    for (int i = 0; i < 3; i++) {
      if (uBird[i].z < 0.0) continue;
      float sh = ss(0.03, 0.0, length((L - uBird[i].xy - vec2(0.03, 0.05) * uBird[i].z) * vec2(1.0, 1.6)));
      col *= 1.0 - sh * 0.35 * (1.0 - night);
    }
  }

  // ---- foam where waves break: the shoaling swells, the swash line and lace behind it -------------------------------
  float nz = noised(p * 55.0 + vec2(T * 0.3, T * 0.22)).x;
  float nz2 = noised(p * 130.0 + vec2(-T * 0.4, T * 0.1)).x;
  float swashPh = 0.5 + 0.5 * sin(T * 1.25 + dot(p, vec2(23.0, 17.0)) + uSeed.z * 6.0);
  float reach = 0.0038 + 0.0032 * swashPh + 0.0045 * (nz - 0.5);
  float foam = ss(reach, reach * 0.15, depth);
  foam *= ss(0.30, 0.62, nz * 0.7 + nz2 * 0.5);
  float lace = ss(0.0016, 0.0, abs(depth - reach * 1.7)) * ss(0.45, 0.7, nz2) * 0.6;
  // breakers: bands riding in on the shoaling swell, only in the last stretch before the beach
  float brk = pow(ssw.w, 5.0) * ss(0.075, 0.02, e) * ss(0.45, 0.72, nz * 0.6 + nz2 * 0.6);
  // whitecaps on the steepest crests far out
  float cap = ss(0.0024, 0.0050, sw.x + 0.5 * ssw.x) * ss(0.35, 0.85, nz2) * 0.16;
  foam = clamp(foam + lace + brk * 0.8 + cap * 0.7 * (1.0 - night), 0.0, 1.0);
  vec3 foamCol = mix(S(0.96, 0.98, 1.0), S(0.07, 0.16, 0.34), night);
  foamCol *= 0.8 + 0.2 * diff;
  col = mix(col, foamCol, foam * 0.85);
  alpha = max(alpha, foam * 0.92);

  // ---- build-in: the front's foam band, boiling vents and a flash as it lands ------------------------------------
  if (a < 3.6) {
    float fb = ss(0.1, 0.0, abs(r - rf)) * (1.0 - ss(0.9, 1.7, a));
    float lacy = 0.55 + 0.45 * noised(p * 120.0 + a * 4.0).x;
    float boil = 0.0;
    for (int i = 0; i < 5; i++) {
      float tau = a - ventDelay(i);
      float vd = length(L - ventPos(i)) / uR;
      boil = max(boil, exp(-sq(vd / (i == 0 ? 0.22 : 0.13))) * ss(0.0, 0.2, tau) * (1.0 - ss(0.8, 1.9, tau)));
    }
    float bf = clamp(fb * lacy * 1.3 + vCrest * 0.45 + boil * (0.4 + 0.5 * noised(p * 160.0 - a * 6.0).x), 0.0, 1.0);
    col = mix(col, foamCol * 1.1, bf);
    alpha = max(alpha, bf);
    col += S(0.5, 0.8, 1.0) * exp(-sq((a - 0.15) / 0.2)) * exp(-r * 3.0) * 0.3;
  }

  // the very rim darkens a touch so the water sits in a basin
  col *= 0.88 + 0.12 * ss(0.0, 0.03, e);
  // the leading edge of the flood is thin
  alpha *= ss(0.0, 0.05, rf - r) * 0.8 + 0.2;

  #ifdef LITE
  col = mix(floorC * mix(1.0, 0.8, ss(0.4, 1.0, od)), col, alpha);
  gl_FragColor = vec4(col, 1.0);
  #else
  gl_FragColor = vec4(col, alpha);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- the sea floor (full only) -------------------------------------------------------------------------------
export const SEABED_VERT = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec2 vLocal;
void main(){
  vec3 p = position;
  vec2 nr; vec2 sf = shoreField(p.xz * uR, nr);
  p.xz *= uR;
  p.y = FLOOR + sf.y;
  vLocal = p.xz;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const SEABED_FRAG = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec2 vLocal;
void main(){
  vec2 L = vLocal, p = vWorld.xz;
  if (inBeachRing(L)) discard;
  float r = length(L) / uR;
  float a = uAge;
  vec2 nr; vec2 sf = shoreField(L, nr);
  float od = odOf(p, sf.x, sf.y);
  vec3 sw = swell(p, 3);
  vec2 refr = (sw.yz * 1.5) * (0.9 * od + 0.1) * 0.5;
  float wet = ss(0.0, 0.5, a - 0.15 - r * 0.9 + 0.35);
  vec3 c = seabedLit(p, L, od, refr, wet);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- kelp -----------------------------------------------------------------------------------------------------
export const KELP_VERT = /* glsl */ `
${COMMON}
attribute vec3 aBase;   // local x, y, z of the holdfast
attribute vec4 aS;      // rotation, height, half width, lean
attribute vec2 aP;      // phase, grow delay
varying float vY;
varying float vH;
varying float vSide;
void main(){
  float side = position.x, y01 = position.y;
  float grow = ss(0.0, 1.2, uAge - 1.0 - aP.y);
  float h = aS.y * grow;
  float T = uTime;
  float ph = aP.x + aBase.x * 14.0 + aBase.z * 9.0;
  float sway = sin(T * 1.1 + ph + y01 * 2.4) * 0.6 + sin(T * 2.3 + ph * 1.7 + y01 * 5.0) * 0.14 + sin(T * 0.4 + aBase.x * 4.0) * 0.3;
  float amp = h * 0.30 * y01 * y01;
  vec2 right = vec2(cos(aS.x), sin(aS.x));
  vec2 lean = vec2(-right.y, right.x);
  float w = aS.z * (1.0 - 0.75 * y01) * (0.8 + 0.2 * sin(y01 * 14.0 + aP.x));
  vec3 p = aBase + vec3(0.0, y01 * h, 0.0);
  p.xz += right * side * w;
  p.xz += lean * (aS.w * h * y01 * y01 + sway * amp);
  p.xz += right * (sin(T * 1.7 + ph * 1.3 + y01 * 3.0) * amp * 0.35);
  p.y -= (sway * sway) * amp * 0.15;
  vY = y01; vH = aP.x; vSide = side;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;
export const KELP_FRAG = /* glsl */ `
${COMMON}
varying float vY;
varying float vH;
varying float vSide;
void main(){
  vec3 base = mix(S(0.07, 0.20, 0.07), S(0.30, 0.52, 0.12), vY);
  base = mix(base, S(0.55, 0.50, 0.12), fract(vH * 3.7) * 0.45 * vY);
  float rib = 1.0 - ss(0.0, 0.5, abs(vSide)) * 0.0;
  base *= 0.75 + 0.25 * (1.0 - abs(vSide)) * rib;
  base += S(0.2, 0.5, 0.1) * ss(0.7, 1.0, vY) * 0.25 * (1.0 - uNight);
  base *= mix(1.0, 0.30, uNight);
  base += S(0.05, 0.7, 0.6) * ss(0.55, 1.0, vY) * uNight * 0.12;
  gl_FragColor = vec4(base, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- fish -----------------------------------------------------------------------------------------------------
export const FISH_VERT = /* glsl */ `
${COMMON}
attribute vec4 aF0;   // circle centre x, z, radius, signed speed
attribute vec4 aF1;   // phase, depth (y), size, hue
varying float vShade;
varying float vGlint;
varying float vHue;
void main(){
  float T = uTime;
  float th = aF1.x + T * aF0.w;
  vec2 c = aF0.xy + aF0.z * vec2(cos(th), sin(th));
  vec2 tg = sign(aF0.w) * vec2(-sin(th), cos(th));
  vec2 sd = vec2(-tg.y, tg.x);
  float bx = position.x, by = position.y, bz = position.z;
  float tail = (0.5 - bx * 0.5);
  bz += sin(T * 7.0 + aF1.x * 7.0 - bx * 4.0) * 0.16 * tail * tail;
  float sc = aF1.z * ss(0.0, 1.0, uAge - 2.0 - aF1.w * 0.8);
  vec3 p = vec3(c.x + (tg.x * bx + sd.x * bz) * sc, aF1.y + by * sc + 0.0006 * sin(T * 1.3 + aF1.x * 4.0), c.y + (tg.y * bx + sd.y * bz) * sc);
  vShade = by * 0.5 + 0.5;
  vHue = aF1.w;
  // a flash of scales when the fish turns its flank to the light
  vGlint = pow(max(0.0, sin(T * 2.2 + aF1.x * 9.0 + th * 3.0)), 28.0);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;
export const FISH_FRAG = /* glsl */ `
${COMMON}
varying float vShade;
varying float vGlint;
varying float vHue;
void main(){
  vec3 back = vHue > 0.8 ? S(0.78, 0.30, 0.10) : S(0.16, 0.30, 0.38);
  vec3 belly = vHue > 0.8 ? S(0.95, 0.80, 0.55) : S(0.80, 0.88, 0.92);
  vec3 c = mix(back, belly, ss(0.25, 0.9, vShade));
  c *= mix(1.0, 0.35, uNight);
  c += S(1.0, 0.98, 0.9) * vGlint * 1.4 * (1.0 - uNight * 0.5);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- gulls ----------------------------------------------------------------------------------------------------
export const BIRD_VERT = /* glsl */ `
${COMMON}
attribute vec4 aB0;   // x, y, z, heading
attribute vec2 aB1;   // scale, flap phase
varying float vTip;
varying float vUp;
void main(){
  vec3 q = position;
  float flap = sin(uTime * 7.0 + aB1.y);
  q.y += flap * abs(q.x) * 0.55 - abs(q.x) * 0.12;
  q.x *= 1.0 - 0.1 * abs(flap);
  float c = cos(aB0.w), s = sin(aB0.w);
  vec3 w = vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c) * aB1.x + aB0.xyz;
  vTip = ss(0.55, 1.0, abs(position.x));
  vUp = q.y;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(w, 1.0);
}
`;
export const BIRD_FRAG = /* glsl */ `
${COMMON}
varying float vTip;
varying float vUp;
void main(){
  vec3 c = mix(S(0.96, 0.95, 0.92), S(0.16, 0.17, 0.2), vTip);
  c *= mix(1.0, 0.14, uNight);
  c += S(1.0, 0.6, 0.35) * 0.06 * (1.0 - uNight);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- motes: plankton, shore spray, the buoy's glow and the build-in's droplets ----------------------------------
export const MOTE_VERT = /* glsl */ `
${COMMON}
attribute vec4 aA;    // kind, r1, r2, r3
attribute vec4 aB;    // r4, r5, r6, r7
varying vec4 vC;
varying float vK;
void main(){
  float kind = aA.x;
  float T = uTime, a = uAge;
  vec3 p = position;
  vec4 col = vec4(0.0);
  float size = 0.003;
  if (kind < 0.5) {
    // plankton drifting in the water, glowing at night
    p.xz += 0.012 * vec2(sin(T * 0.3 + aA.y * 20.0), cos(T * 0.26 + aA.z * 20.0));
    p.y += 0.001 * sin(T * 0.8 + aA.w * 20.0);
    float tw = pow(0.5 + 0.5 * sin(T * (1.5 + aA.y * 3.0) + aA.z * 40.0), 3.0);
    col = vec4(mix(S(0.04, 0.6, 0.9), S(0.08, 0.4, 1.0), aA.w), tw * uNight * ss(1.8, 3.0, a) * 0.6);
    size = 0.0030 + 0.0035 * aA.y;
  } else if (kind < 1.5) {
    // spray where breakers hit the shore: droplets leap and fall back
    float per = 1.6 + 2.2 * aA.y;
    float ph = fract(T / per + aA.z);
    float u = ph / 0.3;
    vec2 inw = -normalize(p.xz + 1e-5);
    float hgt = (0.008 + 0.014 * aA.w) * 4.0 * u * (1.0 - u);
    p.xz += inw * (0.012 + 0.03 * aA.w) * u;
    p.y = WY + 0.003 + hgt;
    float vis = step(u, 1.0) * ss(0.0, 0.1, u) * ss(1.0, 0.7, u) * ss(2.2, 3.2, a);
    col = vec4(mix(S(1.0, 1.0, 1.0), S(0.4, 0.55, 0.7), uNight * 0.7) * mix(1.0, 0.6, uNight), vis * 0.9);
    size = 0.0026 + 0.002 * aA.w;
  } else if (kind < 2.5) {
    // the buoy's lantern, glowing and blinking
    p = uBuoy.xyz + vec3(0.0, 0.11 * uBuoy.w, 0.0);
    float lf = blink(T, uSeed.z);
    col = vec4(S(1.0, 0.42, 0.18), lf * uBuoy.w * (0.45 + 0.55 * uNight));
    size = 0.05;
  } else if (kind < 3.5) {
    // droplets thrown from each vent
    float vi = floor(aB.x * 5.0);
    vec2 vp = vec2(0.0);
    float dl = 0.0;
    for (int i = 0; i < 5; i++) if (float(i) == vi) { vp = ventPos(i); dl = ventDelay(i); }
    float tau = a - dl - 0.05 - aA.y * 0.5;
    float ang = aA.z * 6.2832;
    float vy = uR * (0.9 + 1.1 * aA.w) * (vi < 0.5 ? 1.5 : 0.8);
    float vh = uR * (0.1 + 0.5 * aB.y) * 0.7;
    float g = 2.0 * vy / (0.8 + 0.4 * aB.y);
    vec3 q = vec3(vp.x + cos(ang) * vh * tau, vy * tau - 0.5 * g * tau * tau, vp.y + sin(ang) * vh * tau);
    float alive = step(0.0, tau) * step(0.0, q.y) * (1.0 - ss(2.0, 2.8, a));
    p = vec3(q.x, WY + 0.004 + max(q.y, 0.0), q.z);
    col = vec4(mix(S(0.75, 0.92, 1.0), S(1.0, 1.0, 1.0), aB.z) * mix(1.0, 0.55, uNight), alive * 0.95);
    size = 0.003 + 0.003 * aB.y;
  } else {
    // the flood hits the shore: droplets leap from the rim and fall back
    float t0 = 0.55 + aA.y * 0.6;
    float tau = a - t0;
    vec2 dir = normalize(p.xz + 1e-5);
    float life = 0.7 + aA.z * 0.5;
    float vy = uR * (0.25 + 0.45 * aA.w);
    float g = 2.0 * vy / life;
    float y = vy * tau - 0.5 * g * tau * tau;
    p.xz += dir * 0.02 * tau * (0.5 + aA.w);
    float alive = step(0.0, tau) * step(0.0, y) * (1.0 - ss(2.4, 3.2, a));
    p.y = WY + 0.004 + max(y, 0.0);
    col = vec4(mix(S(0.75, 0.92, 1.0), vec3(1.0), 0.5) * mix(1.0, 0.55, uNight), alive * 0.95);
    size = 0.0032 + 0.003 * aA.w;
  }
  vC = col; vK = kind;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * size / max(-mv.z, 0.01));
}
`;
export const MOTE_FRAG = /* glsl */ `
${COMMON}
varying vec4 vC;
varying float vK;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (vC.a < 0.01 || d > 0.5) discard;
  float core = ss(0.5, 0.0, d);
  float a = vK > 1.5 && vK < 2.5 ? (pow(core, 2.2) * 0.8 + pow(core, 9.0)) : core;
  vec3 c = vC.rgb * (vK > 1.5 && vK < 2.5 ? 1.6 + 2.0 * pow(core, 6.0) : 1.0 + pow(core, 3.0));
  gl_FragColor = vec4(c, vC.a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- the vents' jets: instanced cylinders ---------------------------------------------------------------------------
export const JET_VERT = /* glsl */ `
${COMMON}
attribute vec3 aV;   // vent x, z, strength
attribute float aD;  // delay
varying vec2 vUv;
varying float vFade;
void main(){
  float tau = uAge - aD;
  float up = easeOut(tau / 0.4);
  float fall = ss(0.95, 1.55, tau);
  float height = uR * 0.8 * aV.z * up * (1.0 - fall * 0.85);
  float y01 = position.y;
  float rad = uR * aV.z * (0.09 * pow(1.0 - y01, 1.4) + 0.012 + 0.06 * ss(0.55, 1.0, y01) * (1.0 - fall)) * (1.0 + 0.2 * sin(tau * 25.0 + y01 * 12.0));
  float tw = y01 * 5.0 + tau * 7.0;
  vec2 d2 = vec2(cos(tw) * position.x - sin(tw) * position.z, sin(tw) * position.x + cos(tw) * position.z);
  vec3 p = vec3(aV.x + d2.x * rad, WY + 0.002 + y01 * height, aV.y + d2.y * rad);
  vUv = vec2(atan(position.z, position.x) / PI * 0.5 + 0.5, y01);
  vFade = (1.0 - ss(1.2, 1.8, tau)) * ss(0.0, 0.08, tau);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;
export const JET_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
varying float vFade;
void main(){
  float spiral = 0.5 + 0.5 * sin(vUv.x * 6.283 * 3.0 - vUv.y * 14.0 + uAge * 14.0);
  float grain = noised(vec2(vUv.x * 18.0, vUv.y * 24.0 - uAge * 22.0)).x;
  float body = 0.35 + 0.5 * spiral + 0.4 * grain;
  float tip = ss(0.7, 1.0, vUv.y);
  float alpha = vFade * clamp(body * (1.0 - tip * 0.8), 0.0, 1.0) * 0.75;
  vec3 col = mix(S(0.45, 0.85, 0.95), S(1.0, 1.0, 1.0), spiral * 0.7 + tip * 0.3);
  col = mix(col, S(0.2, 0.9, 0.8), uNight * 0.35);
  col *= mix(1.0, 0.45, uNight);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
