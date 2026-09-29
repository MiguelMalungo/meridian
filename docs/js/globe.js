// Cinematic globe: textured Earth with a live day/night terminator, amber city
// lights, every catalogue destination as a beacon, and glowing flight arcs.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import { latLonToXYZ } from './geo.js';

const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const wrapPi = (a) => {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
};

export const KIND_COLOR = {
  catalog: new THREE.Color('#ecd2ac'),
  completed: new THREE.Color('#a8957a'),
  planned: new THREE.Color('#b8c0ff'),
  confirmed: new THREE.Color('#ffb55e'),
  active: new THREE.Color('#fff0d2'),
  home: new THREE.Color('#fff6ea'),
};
const KIND_SIZE = { catalog: 6.5, completed: 8, planned: 11, confirmed: 12.5, active: 14, home: 13 };
const ARC_COLOR = {
  confirmed: new THREE.Color('#ffc27a'),
  planned: new THREE.Color('#b8c0ff'),
  active: new THREE.Color('#fff0d2'),
  completed: new THREE.Color('#8f7f68'),
  preview: new THREE.Color('#ffe2b8'),
};
const HOT = new THREE.Color('#ffe7c2');

// Approximate subsolar point (NOAA solar position equations), good to ~0.5°.
export function subsolarPoint(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * ((date.getTime() - start) / 86400000 + (hours - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqMin = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const lon = -(hours * 60 + eqMin - 720) / 4;
  return { lat: decl / RAD, lon: ((lon + 540) % 360) - 180 };
}

function slerpUnit(a, b, t) {
  const omega = Math.acos(clamp(a.dot(b), -1, 1));
  if (omega < 1e-5) return a.clone();
  const s = Math.sin(omega);
  return a.clone().multiplyScalar(Math.sin((1 - t) * omega) / s).add(b.clone().multiplyScalar(Math.sin(t * omega) / s));
}

function arcCurve(a, b) {
  const va = new THREE.Vector3(...latLonToXYZ(a.lat, a.lon));
  const vb = new THREE.Vector3(...latLonToXYZ(b.lat, b.lon));
  const h = 0.04 + 0.34 * (va.angleTo(vb) / Math.PI);
  const pts = [];
  for (let k = 0; k <= 80; k++) {
    const t = k / 80;
    pts.push(slerpUnit(va, vb, t).multiplyScalar(1.006 + h * Math.sin(Math.PI * t)));
  }
  return new THREE.CatmullRomCurve3(pts);
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFade: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFade; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * d * 0.018;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      col = mix(col, col * vec3(1.03, 0.98, 1.04) + vec3(0.006, 0.004, 0.014), 0.8);
      col += (hash(vUv * uRes + fract(uTime) * 91.7) - 0.5) * 0.022;
      col *= 1.0 - smoothstep(0.4, 1.0, d) * 0.7;
      gl_FragColor = vec4(col * uFade, 1.0);
    }
  `,
};

export class Globe {
  constructor(canvas, { onSelect = () => {}, onHover = () => {} } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.U = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
    };
    this.yaw = 0.4; this.yawTarget = 0.4;
    this.tilt = 0.45; this.tiltTarget = 0.45;
    this.velYaw = 0; this.velTilt = 0;
    this.view = { fx: null, fy: null, zoom: 1.7 };
    this.viewTarget = { fx: null, fy: null, zoom: 1 };
    this.userZoom = 1;
    this.baseDist = 6;
    this.frame = null;
    this.pointer = { x: 0, y: 0, nx: 0, ny: 0, down: false, moved: 0, lastX: 0, lastY: 0, inside: false };
    this.dragging = false;
    this.lastInteraction = -10;
    this.markerList = [];
    this.markerIndex = new Map();
    this.arcs = [];
    this.selected = null;
    this.hovered = null;
    this.fade = 0;
    this.fading = false;
    this.sunOverride = null;

    this._setupRenderer();
    this._setupScene();
    this._setupPost();
    this._bindEvents();
    this.resize();
  }

  // ------------------------------------------------------------------ setup
  _setupRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.setClearColor('#06050d', 1);
    this.renderer = r;
    this.U.uPixelRatio.value = r.getPixelRatio();
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
    this.camera.position.set(0, 0, 6);
    this.scene.add(this.camera);

    this.root = new THREE.Group();
    this.tiltGroup = new THREE.Group();
    this.spin = new THREE.Group();
    this.scene.add(this.root);
    this.root.add(this.tiltGroup);
    this.tiltGroup.add(this.spin);

    this._buildBackdrop();
    this._buildStars();
    this._buildEarth();
    this._buildAtmosphere();
    this._buildOrbits();
    this._buildBokeh();

    this.arcLayer = new THREE.Group();
    this.spin.add(this.arcLayer);
    this._buildComet();
  }

  _setupPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.55, 0.72);
    this.composer.addPass(this.bloom);
    this.fx = new ShaderPass(FinalShader);
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());
  }

  _buildBackdrop() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        void main() {
          vec3 d = normalize(vDir);
          float behind = pow(max(dot(d, vec3(0.0, 0.05, -1.0)), 0.0), 2.5);
          float n = noise(d * 3.0) * 0.6 + noise(d * 7.0) * 0.3 + noise(d * 15.0) * 0.1;
          vec3 base = vec3(0.006, 0.005, 0.013);
          vec3 haze = vec3(0.032, 0.024, 0.062);
          vec3 warm = vec3(0.04, 0.02, 0.014);
          vec3 c = base + haze * behind * (0.5 + 0.7 * n) + warm * pow(n, 3.0) * 0.4;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(180, 48, 24), mat));
  }

  _buildStars() {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 90 + Math.random() * 60;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      rnd[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.U.uTime, uPixelRatio: this.U.uPixelRatio },
      vertexShader: /* glsl */ `
        attribute float aRand; uniform float uTime; uniform float uPixelRatio;
        varying float vA; varying float vR;
        void main() {
          vR = aRand;
          vA = (0.35 + 0.65 * aRand) * (0.6 + 0.4 * sin(uTime * (0.3 + aRand) + aRand * 40.0));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (aRand > 0.97 ? 2.6 : 1.2) * uPixelRatio;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vR;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          vec3 col = mix(vec3(0.85, 0.82, 1.0), vec3(1.0, 0.85, 0.7), step(0.8, vR));
          gl_FragColor = vec4(col, smoothstep(0.5, 0.0, d) * vA * 0.5);
        }
      `,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  _buildEarth() {
    const blank = new THREE.DataTexture(new Uint8Array([8, 8, 16, 255]), 1, 1);
    blank.needsUpdate = true;
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: blank },
        uNight: { value: blank },
        uMisc: { value: blank },
        uSun: this.U.uSun,
        uLoaded: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uSun;
        varying vec2 vUv; varying vec3 vLocal; varying vec3 vWorldN; varying vec3 vViewDir; varying vec3 vSunW;
        void main() {
          vUv = uv;
          vLocal = normalize(position);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldN = normalize(mat3(modelMatrix) * position);
          vSunW = normalize(mat3(modelMatrix) * uSun);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uMisc;
        uniform vec3 uSun; uniform float uLoaded;
        varying vec2 vUv; varying vec3 vLocal; varying vec3 vWorldN; varying vec3 vViewDir; varying vec3 vSunW;
        void main() {
          vec3 n = normalize(vLocal);
          float s = dot(n, uSun);
          float dayMix = smoothstep(-0.06, 0.22, s);
          float light = max(s, 0.0);

          vec3 day = texture2D(uDay, vUv).rgb;
          float l = dot(day, vec3(0.299, 0.587, 0.114));
          day = mix(vec3(l), day, 0.78) * vec3(0.9, 0.96, 1.08);
          day *= 0.06 + 0.62 * pow(light, 0.9);

          vec4 misc = texture2D(uMisc, vUv);
          float cloud = smoothstep(0.25, 1.0, misc.b);
          vec3 night = texture2D(uNight, vUv).rgb;
          float lum = dot(night, vec3(0.333));
          vec3 lights = vec3(1.0, 0.64, 0.3) * pow(lum, 1.35) * 3.2 * (1.0 - cloud * 0.6);
          vec3 nightCol = night * vec3(0.35, 0.33, 0.55) * 0.5 + lights;

          vec3 col = mix(nightCol, day, dayMix);
          col = mix(col, vec3(0.9, 0.92, 1.0) * (0.015 + 0.6 * pow(light, 0.8)), cloud * 0.72 * smoothstep(-0.25, 0.25, s));

          // Warm band along the terminator.
          col += vec3(0.5, 0.2, 0.06) * exp(-pow(s * 6.0, 2.0)) * 0.18;

          // Ocean glint.
          vec3 sunW = normalize(vSunW);
          vec3 nW = normalize(vWorldN);
          float spec = pow(max(dot(reflect(-sunW, nW), vViewDir), 0.0), 140.0) * (1.0 - misc.g) * (1.0 - cloud);
          col += vec3(1.0, 0.86, 0.66) * spec * 0.25 * dayMix;

          // Atmospheric scattering at the limb.
          float fres = pow(1.0 - max(dot(nW, vViewDir), 0.0), 2.6);
          col += mix(vec3(0.9, 0.5, 0.3), vec3(0.45, 0.62, 1.0), smoothstep(-0.2, 0.4, s)) * fres * (0.06 + 0.5 * smoothstep(-0.35, 0.5, s));

          gl_FragColor = vec4(col * uLoaded, 1.0);
        }
      `,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 180, 120).rotateY(-Math.PI / 2), this.earthMat);
    this.spin.add(this.earth);
  }

  _buildAtmosphere() {
    const R = 1.065;
    const limb = Math.sqrt(1 - 1 / (R * R)).toFixed(4);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSun: this.U.uSun },
      vertexShader: /* glsl */ `
        varying vec3 vLocal; varying vec3 vN; varying vec3 vV;
        void main() {
          vLocal = normalize(position);
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun;
        varying vec3 vLocal; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = max(dot(vN, vV), 0.0);
          float limb = ${limb};
          float g = pow(smoothstep(0.0, limb, f), 2.4) * (1.0 - smoothstep(limb, limb + 0.1, f));
          float s = dot(vLocal, uSun);
          float lit = 0.14 + 0.86 * smoothstep(-0.4, 0.45, s);
          vec3 col = mix(vec3(1.0, 0.6, 0.38), vec3(0.62, 0.76, 1.0), smoothstep(-0.25, 0.3, s));
          gl_FragColor = vec4(col * g * lit * 0.8, 1.0);
        }
      `,
    });
    this.spin.add(new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), mat));
  }

  _buildOrbits() {
    this.orbits = [];
    const defs = [
      { r: 1.42, rot: [1.22, 0.1, 0.32], speed: 0.03, alpha: 0.2 },
      { r: 1.62, rot: [1.4, -0.2, -0.5], speed: -0.02, alpha: 0.12 },
    ];
    for (const d of defs) {
      const n = 512;
      const pos = new Float32Array(n * 3);
      const ang = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        pos.set([Math.cos(t) * d.r, 0, Math.sin(t) * d.r], i * 3);
        ang[i] = i / n;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aT', new THREE.BufferAttribute(ang, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.U.uTime, uAlpha: { value: d.alpha }, uSpeed: { value: d.speed } },
        vertexShader: /* glsl */ `
          attribute float aT; varying float vT;
          void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uAlpha; uniform float uSpeed;
          varying float vT;
          void main() {
            float sweep = fract(vT - uTime * uSpeed);
            gl_FragColor = vec4(vec3(0.86, 0.84, 1.0), uAlpha * (0.15 + 0.85 * pow(sweep, 3.0)));
          }
        `,
      });
      const holder = new THREE.Group();
      holder.rotation.set(...d.rot);
      holder.add(new THREE.LineLoop(geo, mat));
      this.root.add(holder);
      this.orbits.push(holder);
    }
  }

  // Soft out-of-focus motes floating between camera and globe.
  _buildBokeh() {
    const n = 16;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 1.4, -1.6 - Math.random() * 1.6], i * 3);
      size[i] = 40 + Math.random() * 120;
      rnd[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.U.uTime, uPixelRatio: this.U.uPixelRatio },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aRand;
        uniform float uTime; uniform float uPixelRatio;
        varying float vR;
        void main() {
          vR = aRand;
          vec3 p = position;
          p.x += sin(uTime * 0.05 + aRand * 30.0) * 0.12;
          p.y += cos(uTime * 0.04 + aRand * 20.0) * 0.08;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = aSize * uPixelRatio;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vR;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float disc = smoothstep(1.0, 0.82, d) * (0.6 + 0.4 * d);
          vec3 col = mix(vec3(1.0, 0.72, 0.42), vec3(0.8, 0.8, 1.0), step(0.6, vR));
          gl_FragColor = vec4(col, disc * (0.006 + 0.014 * vR));
        }
      `,
    });
    const bokeh = new THREE.Points(geo, mat);
    bokeh.renderOrder = 50;
    bokeh.frustumCulled = false;
    this.camera.add(bokeh);
  }

  _buildComet() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.comet = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixelRatio: this.U.uPixelRatio, uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uPixelRatio;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPixelRatio * 180.0 / -mv.z;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a = exp(-d * d * 22.0) * 2.2 + exp(-d * d * 5.0) * 0.35;
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.75) * a, a * uAlpha);
        }
      `,
    }));
    this.comet.frustumCulled = false;
    this.comet.visible = false;
    this.arcLayer.add(this.comet);
  }

  // ------------------------------------------------------------------ data layers
  async init() {
    const loader = new THREE.TextureLoader();
    const tex = (url, srgb = true) => new Promise((resolve, reject) => {
      loader.load(url, (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        resolve(t);
      }, undefined, reject);
    });
    const [day, night, misc, land, places] = await Promise.all([
      tex('textures/earth_day_4096.jpg'),
      tex('textures/earth_night_4096.jpg'),
      tex('textures/earth_bump_roughness_clouds_4096.jpg', false),
      fetch('data/land-110m.json').then((r) => r.json()),
      fetch('data/places.json').then((r) => r.json()),
    ]);
    const u = this.earthMat.uniforms;
    u.uDay.value = day;
    u.uNight.value = night;
    u.uMisc.value = misc;
    u.uLoaded.value = 1;
    this._buildLandDots(land);
    this._buildCityLights(places);
  }

  _buildLandDots(land) {
    const W = 2048;
    const H = 1024;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    geoPath(proj, ctx)(feature(land, land.objects.land));
    ctx.fill();
    const px = ctx.getImageData(0, 0, W, H).data;
    const N = 110000;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const pos = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const x = Math.cos(golden * i) * r;
      const z = Math.sin(golden * i) * r;
      const lat = Math.asin(y) / RAD;
      const lon = Math.atan2(x, z) / RAD;
      const ix = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W));
      const iy = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
      if (px[(iy * W + ix) * 4] > 127) pos.push(x * 1.0025, y * 1.0025, z * 1.0025);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const dots = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixelRatio: this.U.uPixelRatio, uSun: this.U.uSun },
      vertexShader: /* glsl */ `
        uniform float uPixelRatio; uniform vec3 uSun;
        varying float vA;
        void main() {
          float s = dot(normalize(position), uSun);
          vA = mix(0.16, 0.3, smoothstep(-0.1, 0.4, s));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPixelRatio * clamp(9.0 / -mv.z, 1.0, 3.2);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(0.93, 0.9, 1.0), vA * smoothstep(0.5, 0.15, d));
        }
      `,
    }));
    this.spin.add(dots);
  }

  _buildCityLights(places) {
    const n = places.length;
    const pos = new Float32Array(n * 3);
    const pop = new Float32Array(n);
    const rnd = new Float32Array(n);
    places.forEach(([lon, lat, p], i) => {
      pos.set(latLonToXYZ(lat, lon, 1.004), i * 3);
      pop[i] = clamp((p - 3) / 4.5, 0, 1);
      rnd[i] = Math.random();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPop', new THREE.BufferAttribute(pop, 1));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    const lights = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.U.uTime, uPixelRatio: this.U.uPixelRatio, uSun: this.U.uSun },
      vertexShader: /* glsl */ `
        attribute float aPop; attribute float aRand;
        uniform float uTime; uniform float uPixelRatio; uniform vec3 uSun;
        varying float vA; varying float vPop;
        void main() {
          float s = dot(normalize(position), uSun);
          float night = 1.0 - smoothstep(-0.18, 0.12, s);
          float tw = 0.8 + 0.2 * sin(uTime * (0.6 + aRand * 1.5) + aRand * 50.0);
          vA = (0.06 + 0.94 * night) * (0.3 + 0.7 * aPop) * tw;
          vPop = aPop;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPixelRatio * (3.0 + pow(aPop, 1.6) * 14.0) * clamp(4.2 / -mv.z, 0.5, 1.5);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vPop;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a = exp(-d * d * 14.0) * 1.3 + exp(-d * d * 3.0) * 0.22;
          vec3 col = mix(vec3(1.0, 0.62, 0.26), vec3(1.0, 0.86, 0.62), vPop);
          gl_FragColor = vec4(col * (1.0 + vPop), a * vA);
        }
      `,
    }));
    this.spin.add(lights);
  }

  // Beacons for every destination + arcs for trips.
  setData({ home, trips, cities }) {
    if (this.markers) {
      this.markers.geometry.dispose();
      this.markers.material.dispose();
      this.spin.remove(this.markers);
    }
    for (const a of this.arcs) {
      a.mesh.geometry.dispose();
      a.mat.dispose();
      this.arcLayer.remove(a.mesh);
    }
    this.arcs = [];

    const rank = { active: 4, confirmed: 3, planned: 2, completed: 1 };
    const kindOf = new Map();
    for (const t of trips) {
      const prev = kindOf.get(t.city);
      if (!prev || rank[t.phase] > rank[prev]) kindOf.set(t.city, t.phase);
    }
    if (home) kindOf.set(home, 'home');

    this.markerList = Object.values(cities).map((c) => ({
      code: c.code, lat: c.lat, lon: c.lon, kind: kindOf.get(c.code) || 'catalog',
      local: new THREE.Vector3(...latLonToXYZ(c.lat, c.lon, 1.006)),
    }));
    this.markerIndex = new Map(this.markerList.map((m, i) => [m.code, i]));

    const n = this.markerList.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const idx = new Float32Array(n);
    const pulse = new Float32Array(n);
    this.markerList.forEach((m, i) => {
      pos.set([m.local.x, m.local.y, m.local.z], i * 3);
      const c = KIND_COLOR[m.kind];
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = KIND_SIZE[m.kind];
      idx[i] = i;
      pulse[i] = m.kind === 'catalog' || m.kind === 'completed' ? 0 : 1;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aIndex', new THREE.BufferAttribute(idx, 1));
    geo.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 1));
    this.markers = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.U.uTime, uPixelRatio: this.U.uPixelRatio,
        uSelected: { value: -1 }, uHovered: { value: -1 }, uHot: { value: HOT.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aIndex; attribute float aPulse;
        uniform float uTime; uniform float uPixelRatio; uniform float uSelected; uniform float uHovered; uniform vec3 uHot;
        varying vec3 vColor; varying float vPulse; varying float vPhase; varying float vFront; varying float vSel;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vFront = smoothstep(0.0, 0.25, dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz)));
          float sel = 1.0 - step(0.5, abs(aIndex - uSelected));
          float hov = 1.0 - step(0.5, abs(aIndex - uHovered));
          vSel = sel;
          vColor = mix(aColor, uHot, max(sel, hov * 0.6));
          vPulse = max(aPulse, sel);
          vPhase = fract(uTime * 0.45 + aIndex * 0.137);
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          float scale = clamp(6.5 / -mv.z, 0.8, 3.2);
          gl_PointSize = uPixelRatio * aSize * scale * (1.0 + sel * 0.7 + hov * 0.35) * (1.0 + vPulse * 1.6);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vPulse; varying float vPhase; varying float vFront; varying float vSel;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float k = 1.0 + vPulse * 1.6;
          float r = d * k;
          float core = smoothstep(0.34, 0.0, r) * 1.6;
          float halo = exp(-r * r * 3.2) * 0.55;
          float ring = vPulse * smoothstep(0.07, 0.0, abs(d - vPhase)) * (1.0 - vPhase) * 0.9;
          float a = (core + halo + ring) * vFront;
          gl_FragColor = vec4(vColor * (1.2 + vSel), a);
        }
      `,
    }));
    this.markers.renderOrder = 5;
    this.spin.add(this.markers);

    const homeCity = home && cities[home];
    const start = this.time;
    trips.forEach((t, i) => {
      if (!homeCity || t.city === home || !cities[t.city]) return;
      this._addArc(arcCurve(homeCity, cities[t.city]), t.phase, t.city, start + 0.2 + i * 0.12);
    });
    this.homeCity = homeCity;
    this.cities = cities;
    this.select(this.selected, { fly: false });
  }

  _addArc(curve, phase, code, startAt) {
    const done = phase === 'completed';
    const preview = phase === 'preview';
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: ARC_COLOR[phase].clone() },
        uTime: this.U.uTime,
        uSpeed: { value: 0.12 + Math.random() * 0.06 },
        uOffset: { value: Math.random() },
        uBase: { value: done ? 0.1 : preview ? 0.0 : 0.2 },
        uPulse: { value: done ? 0 : 0.9 },
        uDash: { value: preview ? 1 : 0 },
        uDraw: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vFront;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vFront = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime; uniform float uSpeed; uniform float uOffset;
        uniform float uBase; uniform float uPulse; uniform float uDash; uniform float uDraw;
        varying vec2 vUv; varying float vFront;
        void main() {
          float x = vUv.x;
          if (x > uDraw) discard;
          float head = fract(uTime * uSpeed + uOffset);
          float dd = head - x;
          float tail = dd >= 0.0 ? exp(-dd * 9.0) : 0.0;
          float dash = mix(1.0, step(0.5, fract(x * 60.0 - uTime * 0.6)) * 0.55, uDash);
          float fade = smoothstep(0.0, 0.04, x) * smoothstep(1.0, 0.96, x);
          float front = smoothstep(-0.3, 0.1, vFront);
          float a = (uBase * dash + uPulse * tail) * fade * front;
          gl_FragColor = vec4(uColor * (1.0 + tail * uPulse * 2.5), a);
        }
      `,
    });
    const radius = preview ? 0.0024 : done ? 0.002 : 0.003;
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, radius, 6, false), mat);
    mesh.renderOrder = 4;
    this.arcLayer.add(mesh);
    const arc = { mesh, mat, code, phase, curve, startAt, baseColor: ARC_COLOR[phase].clone(), done, preview };
    this.arcs.push(arc);
    return arc;
  }

  // ------------------------------------------------------------------ selection
  select(code, { fly = true } = {}) {
    this.selected = code;
    // Dotted preview route for destinations that aren't in the manifest yet.
    this.arcs = this.arcs.filter((a) => {
      if (!a.preview) return true;
      a.mesh.geometry.dispose();
      a.mat.dispose();
      this.arcLayer.remove(a.mesh);
      return false;
    });
    const i = code ? this.markerIndex.get(code) : undefined;
    const m = i !== undefined ? this.markerList[i] : null;
    if (m && this.homeCity && code !== this.homeCity.code && !this.arcs.some((a) => a.code === code)) {
      this._addArc(arcCurve(this.homeCity, this.cities[code]), 'preview', code, this.time);
    }
    this._applySelection();
    if (m && fly) this.flyTo(m.lat, m.lon);
  }

  flyTo(lat, lon) {
    this.yawTarget = this.yaw + wrapPi(-lon * RAD - this.yaw);
    this.tiltTarget = clamp(lat * RAD, -1.2, 1.2);
    this.velYaw = 0;
    this.velTilt = 0;
    this.lastInteraction = this.time;
  }

  _applySelection() {
    if (this.markers) {
      const i = this.selected ? this.markerIndex.get(this.selected) : undefined;
      this.markers.material.uniforms.uSelected.value = i ?? -1;
    }
    let focusArc = null;
    for (const a of this.arcs) {
      const sel = a.code === this.selected;
      a.mat.uniforms.uColor.value.copy(sel ? HOT : a.baseColor);
      a.mat.uniforms.uBase.value = sel ? 0.45 : a.done ? 0.1 : a.preview ? 0.0 : 0.2;
      a.mat.uniforms.uPulse.value = sel ? 1.5 : a.done ? 0 : 0.9;
      if (sel && !focusArc) focusArc = a;
    }
    this.focusArc = focusArc;
  }

  _setHovered(code) {
    this.hovered = code;
    if (this.markers) this.markers.material.uniforms.uHovered.value = code ? this.markerIndex.get(code) : -1;
  }

  // Screen-space positions of every beacon (for HTML labels and picking).
  projectMarkers() {
    const rect = this.canvas.getBoundingClientRect();
    const out = [];
    const mw = this.spin.matrixWorld;
    const camPos = this.camera.position;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    for (const m of this.markerList) {
      v.copy(m.local).applyMatrix4(mw);
      n.copy(v).normalize();
      const facing = n.dot(toCam.copy(camPos).sub(v).normalize());
      v.project(this.camera);
      out.push({
        code: m.code,
        kind: m.kind,
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
        facing,
        visible: facing > 0.08 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05,
      });
    }
    return out;
  }

  project(code) {
    const i = this.markerIndex.get(code);
    if (i === undefined) return null;
    const v = this.markerList[i].local.clone().applyMatrix4(this.spin.matrixWorld);
    const facing = v.clone().normalize().dot(this.camera.position.clone().sub(v).normalize());
    v.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      visible: facing > 0.05,
    };
  }

  _pick() {
    let best = null;
    let bestD = 18;
    for (const p of this.projectMarkers()) {
      if (!p.visible) continue;
      const d = Math.hypot(p.x - this.pointer.x, p.y - this.pointer.y) - (p.kind === 'catalog' ? 0 : 4);
      if (d < bestD) {
        bestD = d;
        best = p.code;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ input
  _bindEvents() {
    const el = this.canvas;
    const p = this.pointer;
    const track = (e) => {
      const r = el.getBoundingClientRect();
      p.x = e.clientX;
      p.y = e.clientY;
      p.nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      p.ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    el.addEventListener('pointerdown', (e) => {
      track(e);
      p.down = true;
      p.moved = 0;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      this.velYaw = 0;
      this.velTilt = 0;
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      track(e);
      p.inside = true;
      if (!p.down) {
        const code = this._pick();
        if (code !== this.hovered) {
          this._setHovered(code);
          el.style.cursor = code ? 'pointer' : '';
          this.onHover(code);
        }
        return;
      }
      const dx = e.clientX - p.lastX;
      const dy = e.clientY - p.lastY;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (p.moved > 5) {
        const k = 0.0048 * this.view.zoom * this.userZoom;
        this.dragging = true;
        el.classList.add('is-dragging');
        this.yawTarget += dx * k;
        this.tiltTarget = clamp(this.tiltTarget + dy * k, -1.25, 1.25);
        this.velYaw = dx * k;
        this.velTilt = dy * k;
        this.lastInteraction = this.time;
      }
    });
    const end = (e) => {
      if (!p.down) return;
      if (p.moved <= 5 && e.type === 'pointerup') this.onSelect(this._pick());
      p.down = false;
      this.dragging = false;
      el.classList.remove('is-dragging');
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => {
      p.inside = false;
      if (this.hovered) {
        this._setHovered(null);
        this.onHover(null);
      }
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.userZoom = clamp(this.userZoom * (1 + e.deltaY * 0.0012), 0.45, 1.6);
      this.lastInteraction = this.time;
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(el);
  }

  resetZoom() {
    this.userZoom = 1;
    this.velYaw = 0;
    this.velTilt = 0;
    this.lastInteraction = this.time + 6; // hold still a moment before auto-rotating
  }

  nudgeZoom(factor) {
    this.userZoom = clamp(this.userZoom * factor, 0.45, 1.6);
    this.lastInteraction = this.time;
  }

  // fx/fy: screen point (px) for the globe centre; frame: area the globe should fill; zoom: camera multiplier.
  setView({ fx = null, fy = null, frameW, frameH, zoom = 1 }) {
    if (frameW && frameH) this.frame = { w: frameW, h: frameH };
    this.viewTarget = { fx, fy, zoom };
    if (this.view.fx == null) {
      this.view.fx = fx;
      this.view.fy = fy;
    }
    this._fit();
  }

  _fit() {
    const H = this.canvas.clientHeight;
    const W = this.canvas.clientWidth;
    if (!H || !W) return;
    const m = this.frame ? Math.min(this.frame.w, this.frame.h) : Math.min(W, H);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.baseDist = clamp(H / (0.8 * m * tanHalf), 3.2, 16);
  }

  _applyViewOffset() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const ox = this.view.fx == null ? 0 : w / 2 - this.view.fx;
    const oy = this.view.fy == null ? 0 : h / 2 - this.view.fy;
    if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, ox, oy, w, h);
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.fx.uniforms.uRes.value.set(w, h);
    this._fit();
    this._applyViewOffset();
  }

  // ------------------------------------------------------------------ loop
  reveal() {
    this.fading = true;
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  _updateSun() {
    const sp = this.sunOverride || subsolarPoint(new Date());
    this.sunPoint = sp;
    this.U.uSun.value.set(...latLonToXYZ(sp.lat, sp.lon, 1)).normalize();
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    const t = this.time;
    this.U.uTime.value = t;
    this.fx.uniforms.uTime.value = t;
    if (this.fading && this.fade < 1) this.fade = Math.min(1, this.fade + dt / 1.8);
    this.fx.uniforms.uFade.value = this.fade * this.fade * (3 - 2 * this.fade);
    if (this._sunAt === undefined || t - this._sunAt > 1) {
      this._updateSun();
      this._sunAt = t;
    }

    if (!this.dragging) {
      this.yawTarget += this.velYaw;
      this.tiltTarget = clamp(this.tiltTarget + this.velTilt, -1.25, 1.25);
      this.velYaw *= Math.exp(-dt * 4.5);
      this.velTilt *= Math.exp(-dt * 4.5);
    }
    const idle = !this.dragging && t - this.lastInteraction > 4;
    if (idle && !this.selected) {
      this.yawTarget += dt * (this.reducedMotion ? 0.01 : 0.035);
      this.tiltTarget = damp(this.tiltTarget, 0.45, 0.3, dt);
    }
    const lambda = this.dragging ? 14 : 2.6;
    this.yaw = damp(this.yaw, this.yawTarget, lambda, dt);
    this.tilt = damp(this.tilt, this.tiltTarget, lambda, dt);
    this.spin.rotation.y = this.yaw;
    this.tiltGroup.rotation.x = this.tilt;

    // Eased camera framing between overview and focus.
    const vt = this.viewTarget;
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    this.view.fx = damp(this.view.fx ?? W / 2, vt.fx ?? W / 2, 2.4, dt);
    this.view.fy = damp(this.view.fy ?? H / 2, vt.fy ?? H / 2, 2.4, dt);
    this.view.zoom = damp(this.view.zoom, vt.zoom, 2.2, dt);
    this._applyViewOffset();
    const dist = this.baseDist * this.view.zoom * this.userZoom;
    const px = this.pointer.inside && !this.pointer.down ? this.pointer.nx : 0;
    const py = this.pointer.inside && !this.pointer.down ? this.pointer.ny : 0;
    this.camera.position.set(
      damp(this.camera.position.x, px * 0.012 * dist, 2, dt),
      damp(this.camera.position.y, py * 0.008 * dist, 2, dt),
      dist,
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();

    for (const o of this.orbits) o.rotation.y += dt * 0.02;
    this.stars.rotation.y += dt * 0.002;

    for (const a of this.arcs) {
      const k = clamp((t - a.startAt) / 1.6, 0, 1);
      a.mat.uniforms.uDraw.value = this.fade < 0.6 ? 0 : 1 - Math.pow(1 - k, 3);
    }
    const fa = this.focusArc;
    if (fa && fa.mat.uniforms.uDraw.value > 0.99) {
      const head = (t * 0.16) % 1;
      const p = fa.curve.getPointAt(head);
      this.comet.geometry.attributes.position.setXYZ(0, p.x, p.y, p.z);
      this.comet.geometry.attributes.position.needsUpdate = true;
      this.comet.material.uniforms.uAlpha.value = Math.sin(Math.PI * head);
      this.comet.visible = true;
    } else {
      this.comet.visible = false;
    }

    this.composer.render(dt);
  }
}
