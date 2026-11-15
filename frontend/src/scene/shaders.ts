/** GLSL shared by the globe and the stereographic polar maps. */

export const LUNAR_SHADING = /* glsl */ `
  uniform sampler2D uColor;
  uniform sampler2D uNormal;
  uniform float uHasColor;
  uniform float uHasNormal;
  uniform vec3 uSunDir;      // unit, Moon body frame
  uniform vec3 uEarthDir;    // unit, Moon body frame
  uniform float uSunIntensity;
  uniform float uEarthshine;
  uniform float uNormalStrength; // 1 = relief as baked (4x exaggerated)
  uniform float uAmbient;        // flat fill so shadowed terrain stays readable on maps

  #ifndef PI
  #define PI 3.141592653589793
  #endif

  vec3 latLonToVec(float lat, float lon) {
    float cl = cos(lat);
    return vec3(cl * cos(lon), sin(lat), -cl * sin(lon));
  }

  // Equirectangular UV for a unit vector, with derivatives that ignore the
  // seam at lon = 180 (no mip line there).
  vec4 sampleSeamless(sampler2D tex, vec2 uv) {
    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);
    dx.x -= floor(dx.x + 0.5);
    dy.x -= floor(dy.x + 0.5);
    return textureGrad(tex, uv, dx, dy);
  }

  // Placeholder albedo while no colour map is loaded: neutral regolith grey.
  vec3 albedoAt(vec2 uv) {
    if (uHasColor < 0.5) return vec3(0.16);
    return sampleSeamless(uColor, uv).rgb;
  }

  vec3 normalAt(vec3 p, vec2 uv) {
    if (uHasNormal < 0.5) return p;
    vec3 t = sampleSeamless(uNormal, uv).xyz * 2.0 - 1.0;
    t.xy *= uNormalStrength;
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), p) + vec3(1e-6, 0.0, 0.0));
    vec3 north = cross(p, east);
    return normalize(t.x * east + t.y * north + t.z * p);
  }

  // Lunar-Lambert: the Moon is nearly flat-lit at full phase (no limb
  // darkening), Lambertian near the terminator.
  vec3 shadeLunar(vec3 p, vec2 uv, vec3 viewDir) {
    vec3 albedo = albedoAt(uv);
    vec3 n = normalAt(p, uv);
    float mu0 = dot(n, uSunDir);
    float mu = max(dot(n, viewDir), 0.05);
    // Soft terminator: light fades over a wide band instead of a hard line
    float cosSun = dot(p, uSunDir);
    float geomLit = smoothstep(-0.16, 0.12, cosSun);
    // Grazing light ramps in smoothly so the day side has no sharp rim either
    float soft = smoothstep(-0.06, 0.22, mu0);
    float lambert = max(mu0, 0.0);
    float ls = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;
    float sunTerm = mix(lambert, ls, 0.6 * soft) * geomLit + 0.05 * soft * geomLit;
    float earthTerm = max(dot(n, uEarthDir), 0.0) * uEarthshine;
    vec3 earthshine = vec3(0.55, 0.66, 0.9) * earthTerm;
    // Cool fill on the night side: darker than day, never pitch black, relief still reads
    float night = 1.0 - geomLit;
    vec3 fill = vec3(0.62, 0.7, 0.95) * uAmbient * (0.35 + 0.65 * night) * (0.75 + 0.25 * max(dot(n, p), 0.0));
    return albedo * (uSunIntensity * sunTerm + earthshine) + albedo * fill;
  }
`;

export const GLOBE_VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vPos = position;
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

export const GLOBE_FRAG = /* glsl */ `
  varying vec3 vPos;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${LUNAR_SHADING}
  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vPos);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 col = shadeLunar(p, vUv, viewDir);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const STEREO_VERT = /* glsl */ `
  varying vec2 vScreen;
  void main() {
    vScreen = position.xy; // -1..1 full-screen quad
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const STEREO_FRAG = /* glsl */ `
  varying vec2 vScreen;
  uniform vec2 uCenter;     // map centre, in stereographic units (sphere radius 1)
  uniform float uHalfHeight;
  uniform float uAspect;
  uniform float uPole;      // +1 north, -1 south
  uniform float uGrid;      // graticule opacity
  ${LUNAR_SHADING}

  float gridLine(float v, float step, float width) {
    float d = abs(fract(v / step + 0.5) - 0.5) * step;
    float w = fwidth(v) * width;
    return 1.0 - smoothstep(0.0, w, d);
  }

  void main() {
    vec2 q = uCenter + vScreen * vec2(uAspect, 1.0) * uHalfHeight;
    float r = length(q);
    float c = 2.0 * atan(r * 0.5);                 // angular distance from the pole: r = 2 tan(c/2)
    float lat = uPole * (0.5 * PI - c);
    float lon = uPole > 0.0 ? atan(q.x, -q.y) : atan(q.x, q.y);
    vec3 p = latLonToVec(lat, lon);
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
    vec3 col = shadeLunar(p, uv, p);

    // Graticule: latitude every 1 deg (fine) / 5 deg, longitude every 30 deg.
    float latDeg = lat * 180.0 / PI;
    float lonDeg = lon * 180.0 / PI;
    float g = max(gridLine(latDeg, 5.0, 1.0), gridLine(lonDeg, 30.0, 1.0) * step(0.004, c));
    float gFine = gridLine(latDeg, 1.0, 0.8) * 0.4;
    col = mix(col, vec3(0.93, 0.88, 0.78), max(g, gFine) * uGrid);

    // Fade beyond the hemisphere edge
    col *= 1.0 - smoothstep(PI * 0.5, PI * 0.62, c);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Procedural placeholder Earth (used until a real Earth texture is in the manifest). */
export const EARTH_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vLocal;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vLocal = normalize(position);
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

export const EARTH_FRAG = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vLocal;
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform vec3 uSunDir;
  uniform sampler2D uMap;
  uniform float uHasMap;
  #include <common>
  #include <logdepthbuf_pars_fragment>

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    float mu0 = dot(n, uSunDir);
    vec3 day;
    if (uHasMap > 0.5) {
      day = texture2D(uMap, vUv).rgb;
    } else {
      float clouds = smoothstep(0.55, 0.8, fbm(vLocal * 3.2 + 7.0));
      float ice = smoothstep(0.82, 0.9, abs(vLocal.y));
      vec3 ocean = vec3(0.02, 0.07, 0.2);
      day = mix(ocean, vec3(0.85), ice);
      day = mix(day, vec3(0.92), clouds * 0.85);
    }
    float lit = smoothstep(-0.08, 0.15, mu0);
    float gain = uHasMap > 0.5 ? 1.7 : 2.6; // real texture is already bright (clouds, ice)
    vec3 col = day * (0.015 + gain * max(mu0, 0.0)) * lit;
    // Thin atmosphere rim on the day side
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    col += vec3(0.25, 0.45, 1.0) * rim * smoothstep(-0.2, 0.3, mu0) * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
