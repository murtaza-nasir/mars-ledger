// GLSL for the Ocean tile (Ocean.tsx): one surface shader, one fountain-jet shader and one spray-point shader.
// World space xz drives the waves, so neighbouring oceans carry one continuous sea.

export const COMMON = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uAge;      // seconds since placed (99 = standing)
uniform float uR;        // hex circumradius
uniform vec3  uSeed;     // per-instance randoms 0..1
uniform float uFloe;     // 0..1: how many ice floes this sea carries
uniform float uScale;    // screen px per world unit at distance 1 (for spray points)

#define PI 3.14159265
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
`;

// ---- the surface ---------------------------------------------------------------------------------------------
export const SURFACE_VERT = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec2 vLocal;
varying float vCrest;
void main(){
  vec3 p = position;
  p.xz *= uR * 0.992;
  float r = length(p.xz) / uR;
  float a = uAge;
  float y = 0.0;
  // gentle idle swell, phase-shifted per sea
  y += sin(uTime * 0.8 + uSeed.x * 6.283 + p.x * 9.0) * 0.0009 + sin(uTime * 0.55 + p.z * 11.0 + uSeed.y * 6.283) * 0.0006;
  float crest = 0.0;
  if (a < 3.2) {
    float rf = easeOut((a - 0.12) / 1.05) * 1.08;
    float w = 0.12;
    // the flood front: a rolling crest that rides the leading edge, overshooting then collapsing
    crest = exp(-sq((r - rf) / w)) * ss(0.0, 0.2, a - 0.1) * (1.0 - ss(1.0, 1.5, a)) ;
    y += crest * uR * 0.085;
    // the fountain's base boils at the centre
    float jet = ss(0.0, 0.25, a) * (1.0 - ss(1.0, 1.7, a));
    y += jet * uR * 0.07 * exp(-sq(r / 0.28)) * (0.7 + 0.3 * sin(a * 30.0));
    // after the flood, rings run out from the centre and die away
    float k = max(a - 0.5, 0.0);
    float ring = sin(r * 22.0 - k * 9.0) * exp(-k * 1.35) * ss(0.0, 0.5, a - r * 0.5);
    y += ring * uR * 0.0085 * ss(0.1, 0.5, a);
    vCrest = crest;
  } else vCrest = 0.0;
  p.y += y + 0.0065;
  vLocal = p.xz;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SURFACE_FRAG = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec2 vLocal;
varying float vCrest;

vec2 W(vec2 p, vec2 d, float k, float w, float a){ return normalize(d) * (a * k * cos(dot(p, normalize(d)) * k + w * uTime)); }

vec3 skyCol(vec3 d, vec3 sunD, vec3 moonD){
  float h = clamp(d.y, 0.0, 1.0);
  vec3 dayH = S(0.80, 0.46, 0.34), dayM = S(0.46, 0.34, 0.50), dayZ = S(0.12, 0.22, 0.50);
  vec3 nigH = S(0.10, 0.16, 0.32), nigZ = S(0.012, 0.02, 0.06);
  vec3 day = mix(dayH, dayM, ss(0.0, 0.25, h));
  day = mix(day, dayZ, ss(0.2, 0.9, h));
  vec3 night = mix(nigH, nigZ, ss(0.0, 0.6, h));
  vec3 c = mix(day, night, uNight);
  float s = max(dot(d, sunD), 0.0);
  c += S(1.0, 0.55, 0.25) * (pow(s, 6.0) * 0.10 + pow(s, 90.0) * 0.35 + pow(s, 3000.0) * 12.0) * (1.0 - uNight);
  float m = max(dot(d, moonD), 0.0);
  c += S(0.62, 0.78, 1.0) * (pow(m, 10.0) * 0.18 + pow(m, 500.0) * 6.0) * uNight;
  return c;
}

void main(){
  float R = uR;
  float r = length(vLocal) / R;
  float a = uAge;
  float rf = a > 3.0 ? 2.0 : easeOut((a - 0.12) / 1.05) * 1.08;
  if (r > rf) discard;
  float hd = hexN(vLocal, R);
  float apo = R * 0.8660254;
  float edge = (1.0 - hd) * apo; // world distance to the nearest rim edge
  vec2 p = vWorld.xz;
  float T = uTime;

  // ---- normal: layered travelling waves plus two scrolling noise layers --------------------------------
  vec2 g = vec2(0.0);
  vec2 wp = p + (noised(p * 9.0 + T * 0.05).yz - 0.5) * 0.06;  // warp so the wave trains never read as a grid
  g += W(wp, vec2(0.85, 0.52), 31.0, 1.15, 0.0020);
  g += W(wp, vec2(-0.42, 0.91), 47.0, 1.6, 0.0014);
  g += W(wp, vec2(0.15, -0.99), 73.0, 2.1, 0.0009);
  g += W(wp, vec2(-0.93, -0.36), 110.0, 2.8, 0.0005);
  vec3 n1 = noised(p * 70.0 + vec2(T * 0.55, T * 0.32));
  vec3 n2 = noised(p * 150.0 + vec2(-T * 0.7, T * 0.45) + 7.3);
  vec3 n3 = noised(p * 33.0 + vec2(T * 0.16, -T * 0.21) + 3.1);
  g += n1.yz * 0.0013 * 70.0 * 0.5 + n2.yz * 0.0004 * 150.0 * 0.5 + n3.yz * 0.0020 * 33.0 * 0.5;
  // the flood's crest and the settling rings tilt the surface near their sources
  float k = max(a - 0.5, 0.0);
  float ringPhase = r * 22.0 - k * 9.0;
  vec2 radial = vLocal / max(length(vLocal), 1e-4);
  float calm = 1.0 - ss(0.0, 1.0, k * 0.5);
  g += radial * cos(ringPhase) * exp(-k * 1.35) * 0.55 * step(a, 3.0) * ss(0.1, 0.5, a);
  g += radial * (vCrest * 1.6) * -sign(r - rf);
  g *= 1.0;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);

  vec3 sunD = normalize(vec3(-0.6, 0.42, -0.62));
  vec3 moonD = normalize(vec3(0.42, 0.50, -0.75));
  vec3 lightD = normalize(mix(sunD, moonD, uNight));

  // ---- body colour: turquoise shallows at the rim, deep blue in the middle --------------------------------
  float shallow = ss(0.62, 1.0, hd);
  vec3 deep = mix(S(0.015, 0.16, 0.42), S(0.01, 0.05, 0.16), uNight * 0.85);
  vec3 mid  = mix(S(0.03, 0.42, 0.62), S(0.012, 0.10, 0.24), uNight * 0.85);
  vec3 shal = mix(S(0.20, 0.88, 0.80), S(0.03, 0.22, 0.34), uNight * 0.85);
  vec3 body = mix(deep, mid, ss(0.0, 0.62, hd));
  body = mix(body, shal, shallow * shallow);
  // light scattering through the crests
  float sss = pow(1.0 - ndv, 2.0) * 0.35 + clamp(g.x * 0.0 + (n3.x - 0.5), 0.0, 1.0) * 0.22;
  body += mix(S(0.1, 0.55, 0.55), S(0.02, 0.15, 0.25), uNight) * sss * (0.4 + shallow);
  float diff = clamp(dot(N, lightD) * 0.5 + 0.5, 0.0, 1.0);
  body *= 0.4 + 0.95 * diff * mix(1.0, 0.35, uNight);

  // ---- sea-floor caustics showing through the shallows ------------------------------------------------------
  vec2 q = p * 52.0;
  q += vec2(sin(q.y * 0.6 + T * 0.9), cos(q.x * 0.6 + T * 1.1)) * 0.9;
  float cx = sin(q.x + sin(q.y * 1.3 + T)) * sin(q.y + sin(q.x * 1.1 - T * 1.2));
  float caus = pow(1.0 - abs(cx), 7.0);
  body += S(0.55, 1.0, 0.9) * caus * 0.2 * pow(shallow, 1.5) * (1.0 - uNight * 0.7);

  // ---- reflection of the sky -----------------------------------------------------------------------------
  vec3 Rv = reflect(-V, N);
  Rv.y = abs(Rv.y);
  float fres = clamp(0.04 + 0.96 * pow(1.0 - ndv, 3.6), 0.0, 1.0);
  vec3 refl = skyCol(Rv, sunD, moonD);
  vec3 col = mix(body, refl, fres);

  // ---- sun and moon glints ------------------------------------------------------------------------------
  vec3 H = normalize(lightD + V);
  float nh = max(dot(N, H), 0.0);
  vec3 lightCol = mix(S(1.0, 0.72, 0.42), S(0.7, 0.85, 1.0), uNight);
  col += lightCol * pow(nh, 700.0) * 1.6;
  // glitter: tiny facets that wink on and off where the broad lobe lines up
  vec2 gp = p * 420.0;
  vec2 gi = floor(gp);
  float gr = hash21(gi);
  float tw = 0.5 + 0.5 * sin(T * (2.0 + gr * 5.0) + gr * 40.0);
  float facet = ss(0.93, 1.0, gr) * ss(0.35, 1.0, tw);
  float lobe = pow(nh, 220.0);
  vec2 gf = fract(gp) - 0.5;
  facet *= ss(0.5, 0.2, length(gf));
  col += lightCol * facet * lobe * 40.0 * mix(1.0, 0.75, uNight);

  // ---- night: faint bioluminescent plankton swirls ---------------------------------------------------------
  if (uNight > 0.02) {
    vec2 sp = p * 14.0;
    for (int i = 0; i < 3; i++) sp += 0.7 * vec2(sin(sp.y * 1.3 + T * 0.21 + float(i)), sin(sp.x * 1.1 - T * 0.17 + float(i) * 2.0));
    float fil = sin(sp.x * 1.9 + sp.y * 1.2);
    float filament = pow(1.0 - abs(fil), 6.0);
    float fil2 = sin(sp.x * 1.1 - sp.y * 1.7 + 1.3);
    filament = max(filament, pow(1.0 - abs(fil2), 9.0) * 0.7);
    float cloud = ss(0.38, 0.78, noised(p * 7.0 + vec2(T * 0.03, -T * 0.02)).x);
    float dots = ss(0.95, 1.0, hash21(floor(p * 260.0 + 3.0))) * (0.5 + 0.5 * sin(T * 3.0 + hash21(floor(p * 260.0)) * 30.0));
    float bio = (filament * cloud * 1.0 + dots * cloud * 0.8 + dots * 0.12) * (1.0 - shallow * 0.4);
    bio *= 0.55 + 0.45 * ss(0.0, 0.5, length(g));
    vec3 s1 = vec3(cloud);
    col += mix(S(0.05, 0.9, 0.7), S(0.1, 0.6, 1.0), s1.x) * bio * uNight * 0.85;
  }

  // ---- ice floes (some seas only) -------------------------------------------------------------------------
  if (uFloe > 0.01) {
    float fl = 0.0, rim = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 rs = hash22(vec2(uSeed.x * 31.0 + fi * 7.7, uSeed.y * 17.0 + fi));
      float ang = rs.x * 6.283 + T * 0.012 * (fi + 1.0);
      float rad = (0.18 + 0.4 * rs.y) * R * (0.85 + 0.15 * sin(T * 0.2 + fi));
      vec2 c = vec2(cos(ang), sin(ang)) * rad;
      vec2 d = (vLocal - c) / R;
      float sz = (0.075 + 0.07 * hash21(rs + fi)) * (i == 0 ? 1.0 : 0.7) * (fi < uFloe * 3.0 ? 1.0 : 0.0);
      float th = atan(d.y, d.x);
      float irr = 1.0 + 0.28 * sin(th * 3.0 + fi * 2.0 + uSeed.z * 9.0) + 0.14 * sin(th * 5.0 + fi) ;
      float dist = length(d * vec2(1.0, 1.35)) / (sz * irr);
      fl = max(fl, ss(1.0, 0.86, dist) * ss(1.0, 0.8, hd));
      rim = max(rim, ss(1.0, 0.86, dist) - ss(0.86, 0.6, dist));
    }
    float fa = clamp(fl, 0.0, 1.0);
    vec3 ice = mix(S(0.78, 0.92, 0.98), S(0.95, 0.99, 1.0), noised(p * 90.0).x);
    ice *= mix(1.0, 0.25, uNight);
    ice += refl * 0.12 + lightCol * pow(nh, 60.0) * 0.5;
    ice += S(0.05, 0.3, 0.4) * rim * 0.5;
    col = mix(col, ice, fa * 0.95);
    // the cold meltwater around a floe
    col += S(0.2, 0.7, 0.8) * rim * 0.2 * (1.0 - uNight);
  }

  // ---- popping bubbles ------------------------------------------------------------------------------------
  {
    vec2 bp = vLocal / R * 3.4 + uSeed.xy * 20.0;
    vec2 bi = floor(bp);
    vec2 bf = fract(bp) - 0.5;
    float h = hash21(bi);
    if (h > 0.55) {
      float per = 3.0 + h * 3.0;
      float ph = fract((T + h * 50.0) / per);
      vec2 off = (hash22(bi + 3.0) - 0.5) * 0.45;
      float d = length(bf - off) ;
      float pop = ss(0.78, 0.8, ph);
      // a bubble rises as a bright dot, then bursts into a ring that spreads and fades
      float dot0 = ss(0.045, 0.0, d) * ss(0.0, 0.2, ph) * (1.0 - pop);
      float rr = (ph - 0.78) * 0.9;
      float ringb = ss(0.012, 0.0, abs(d - rr)) * pop * (1.0 - ss(0.78, 1.0, ph));
      col += (S(0.9, 1.0, 1.0) * dot0 * 0.5 + S(0.8, 0.95, 1.0) * ringb * 0.65) * (0.35 + shallow * 0.65) * ss(0.03, 0.2, edge);
    }
  }

  // ---- shoreline foam: soft, lacy, broken along the hex edges ------------------------------------------------
  float nz = noised(p * 55.0 + vec2(T * 0.3, T * 0.22)).x;
  float nz2 = noised(p * 130.0 + vec2(-T * 0.4, T * 0.1)).x;
  float pulse = 0.5 + 0.5 * sin(T * 1.25 + dot(p, vec2(23.0, 17.0)) + uSeed.z * 6.0);
  float reach = R * (0.028 + 0.03 * pulse + 0.04 * (nz - 0.5));
  float foam = ss(reach, reach * 0.15, edge);
  float broken = ss(0.30, 0.62, nz * 0.7 + nz2 * 0.5);
  foam *= broken;
  // a second, fainter line of lace behind the first
  float lace = ss(0.006, 0.0, abs(edge - reach * 1.6)) * ss(0.45, 0.7, nz2) * 0.5;
  foam = clamp(foam + lace * 0.7, 0.0, 1.0);
  vec3 foamCol = mix(S(0.95, 0.98, 1.0), S(0.34, 0.45, 0.62), uNight * 0.85);
  col = mix(col, foamCol, foam * 0.75);

  // ---- build-in: the front's foam band and the spray's wet sheen ---------------------------------------------
  if (a < 3.0) {
    float fb = ss(0.1, 0.0, abs(r - rf)) * (1.0 - ss(0.9, 1.7, a));
    float lacy = 0.55 + 0.45 * noised(p * 120.0 + a * 4.0).x;
    col = mix(col, foamCol * 1.12, clamp(fb * lacy * 1.3 + vCrest * 0.45, 0.0, 1.0));
    // white water boiling around the jet
    float boil = exp(-sq(r / 0.22)) * ss(0.0, 0.2, a) * (1.0 - ss(0.8, 1.9, a));
    col = mix(col, foamCol, boil * (0.4 + 0.5 * noised(p * 160.0 - a * 6.0).x));
    // a bright flash as it lands
    col += S(0.5, 0.8, 1.0) * exp(-sq((a - 0.15) / 0.2)) * exp(-r * 3.0) * 0.3;
  }

  // darken the very rim a touch so the water reads as sitting in a basin
  col *= 0.86 + 0.14 * ss(0.0, 0.04, edge) ;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- the fountain jet ----------------------------------------------------------------------------------------
export const JET_VERT = /* glsl */ `
${COMMON}
varying vec2 vUv;
varying float vFade;
varying vec3 vN;
void main(){
  // position.y 0..1 along the jet; position.xz unit circle
  float a = uAge;
  float up = easeOut(a / 0.4);
  float fall = ss(0.95, 1.55, a);
  float height = uR * 0.95 * up * (1.0 - fall * 0.85);
  float y01 = position.y;
  float yy = y01 * height;
  // thick at the foot, thin at the tip, flaring into a crown as it peaks
  float rad = uR * (0.10 * pow(1.0 - y01, 1.4) + 0.012 + 0.07 * ss(0.55, 1.0, y01) * (1.0 - fall)) * (1.0 + 0.2 * sin(a * 25.0 + y01 * 12.0));
  float tw = y01 * 5.0 + a * 7.0;
  vec3 dir = vec3(position.x, 0.0, position.z);
  float s = sin(tw), c = cos(tw);
  vec2 d2 = vec2(c * dir.x - s * dir.z, s * dir.x + c * dir.z);
  vec3 p = vec3(d2.x * rad, yy + 0.004, d2.y * rad);
  vUv = vec2(atan(position.z, position.x) / PI * 0.5 + 0.5, y01);
  vFade = (1.0 - ss(1.2, 1.8, a)) * ss(0.0, 0.08, a);
  vN = normalize(vec3(d2.x, 0.3, d2.y));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const JET_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
varying float vFade;
varying vec3 vN;
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

// ---- spray droplets -----------------------------------------------------------------------------------------
export const SPRAY_VERT = /* glsl */ `
${COMMON}
attribute vec4 aRand;
varying float vA;
varying float vSp;
void main(){
  float rimDrop = step(0.55, aRand.x);
  float t0 = rimDrop > 0.5 ? 0.45 + aRand.w * 0.65 : 0.08 + aRand.x * 0.7;
  float tau = uAge - t0;
  float ang = aRand.y * 6.2832;
  vec2 dir = vec2(cos(ang), sin(ang));
  float life = 0.75 + aRand.z * 0.6;
  vec3 p;
  if (rimDrop > 0.5) {
    // the flood hits the rim: droplets leap from the edge, mostly outward then falling back
    float hex = 0.8660254 / max(max(abs(dir.x), abs(dot(dir, vec2(0.5, 0.8660254)))), abs(dot(dir, vec2(-0.5, 0.8660254))));
    vec2 start = dir * uR * hex * 0.96;
    float vy = uR * (0.55 + 0.7 * aRand.z);
    float g = 2.0 * vy / life;
    vec2 xz = start + dir * uR * 0.12 * (aRand.z - 0.35) * tau * 3.0;
    p = vec3(xz.x, vy * tau - 0.5 * g * tau * tau, xz.y);
  } else {
    float vy = uR * (1.7 + 1.5 * aRand.z);
    float vh = uR * (0.25 + 0.75 * aRand.w) * 1.2;
    float g = 2.0 * vy / (0.9 + 0.5 * aRand.z);
    p = vec3(dir.x * vh * tau, vy * tau - 0.5 * g * tau * tau, dir.y * vh * tau);
  }
  float alive = step(0.0, tau) * step(p.y, 1000.0);
  float landed = step(p.y, -0.0001) * step(0.05, tau);
  vA = alive * (1.0 - landed) * (1.0 - ss(2.4, 3.0, uAge));
  vSp = aRand.z;
  p.y = max(p.y, 0.0) + 0.006;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * (0.009 + 0.009 * aRand.w) / max(-mv.z, 0.01));
}
`;

export const SPRAY_FRAG = /* glsl */ `
${COMMON}
varying float vA;
varying float vSp;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (vA < 0.01 || d > 0.5) discard;
  float core = ss(0.5, 0.05, d);
  vec3 col = mix(S(0.75, 0.92, 1.0), S(1.0, 1.0, 1.0), core);
  col = mix(col, S(0.3, 0.9, 0.85), uNight * 0.4);
  col *= mix(1.0, 0.55, uNight);
  col += S(1.0, 0.8, 0.5) * ss(0.2, 0.0, length(c - vec2(-0.12, 0.12))) * 0.6 * (1.0 - uNight);
  gl_FragColor = vec4(col, vA * core * 0.95);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
