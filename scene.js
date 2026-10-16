// Chug Jug PH — fixed WebGL planet behind the page + Lenis smooth scroll.
// Ported from the "Ascend" layout spec (three r0.143). Everything degrades quietly:
// if WebGL, the CDN or the planet assets fail, the page keeps its normal dark background.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const ASSET_BASE_URL = window.__PLANET_ASSET_BASE || 'https://api.getlayers.ai/storage/v1/object/public/public/assets/ascend-d9857ad1f2';
const PLANET_GLB = ASSET_BASE_URL + '/planet.glb';
const PLANET_LIGHTS_GLB = ASSET_BASE_URL + '/planet-lights.glb';
const PLANET_CLOUDS_PNG = ASSET_BASE_URL + '/planet-clouds.png';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CONFIG = {
  rimColor:'#c1faff', rimPower:2.4, nightLights:10, terrainDepth:0.33, terrainShade:1.3,
  oceanGlint:0.45, oceanDeep:0.12, oceanFlow:3, oceanFlowSpeed:0.8, oceanFlowScale:2.1,
  glowColor:'#3a6cff', glowIntensity:3.35, planetRadius:1.95, spin:0.03, initRotation:2.07,
  tilt:0.37, autoRotate:0,
  cloud1Height:1.005, cloud1Opacity:0.6, cloud1Spin:0.06,
  cloud2Height:1.03, cloud2Opacity:0.5, cloud2Spin:0.14,
  cloud3Height:1.075, cloud3Opacity:0.5, cloud3Spin:0.1,
  bgColor:'#040a1e', flameColor:'#3a6cff', flameColor2:'#c1faff', flameAmt:0.15,
  atmoColor:'#9fc4ff', atmoCount:320, atmoSize:22, atmoSpeed:0.8,
  starColor:'#cfe0ff', starCount:1400, starSize:1.6, starFlicker:1,
  markerColor:'#ffd27a', markerCount:60, markerSize:16, markerSpeed:0.5,
};
const LAYERS = { NONE:0, TORUS_SCENE:1, BLOOM_SCENE:2, ENTIRE_SCENE:3 };

const Lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hexToVec3 = (hex) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };
function sample(stops, p) {
  if (p <= stops[0].p) return stops[0].v;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (p <= b.p) { const t = (p - a.p) / (b.p - a.p); return Lerp(a.v, b.v, t * t * (3 - 2 * t)); }
  }
  return stops[stops.length - 1].v;
}

// ---- Lenis smooth scroll (never required; the page works without it) ----
let lenis = null;
(async () => {
  if (reduceMotion) return;
  try {
    const mod = await import(window.__LENIS_URL || 'https://unpkg.com/lenis@1.3.23/dist/lenis.mjs');
    const Lenis = mod.default || mod.Lenis;
    lenis = new Lenis({ duration: 1.15, smoothWheel: true, touchMultiplier: 1.5, anchors: { offset: -92 } });
    window.__lenis = lenis;
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    // Existing code uses scrollIntoView({behavior:'smooth'}); route it through Lenis.
    const nativeSIV = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg) {
      if (!lenis || !arg || typeof arg !== 'object') return nativeSIV.apply(this, arguments);
      const r = this.getBoundingClientRect();
      const offset = arg.block === 'center' ? -(innerHeight / 2 - r.height / 2) : -92;
      lenis.scrollTo(this, { offset });
    };
    // Don't scroll the page behind the cart drawer or a modal.
    const sync = () => {
      const locked = document.querySelector('.drawer.open, .modal.open');
      if (locked) lenis.stop(); else lenis.start();
    };
    new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  } catch (e) { console.warn('Lenis unavailable, using native scroll', e); }
})();

// ---- WebGL planet ----
try { initPlanet(); } catch (e) { console.warn('Planet scene unavailable', e); }

function initPlanet() {
  const canvas = document.getElementById('planetCanvas');
  if (!canvas) return;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) return;

  const SNOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx; vec3 x2 = x0 - i2 + 2.0 * C.xxx; vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy; vec4 y = y_ *ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x); vec3 p1 = vec3(a0.zw,h.y); vec3 p2 = vec3(a1.xy,h.z); vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`;

  const renderer = new THREE.WebGL1Renderer({ canvas, antialias: true });
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  let W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
  camera.position.set(0, 0, 8);
  camera.layers.enable(LAYERS.TORUS_SCENE);
  camera.layers.enable(LAYERS.BLOOM_SCENE);
  camera.layers.enable(LAYERS.ENTIRE_SCENE);
  scene.add(camera);

  const amb = new THREE.AmbientLight(0xffffff, 1.8); amb.layers.set(LAYERS.ENTIRE_SCENE); scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(0, 10, 2); dir.layers.set(LAYERS.ENTIRE_SCENE); scene.add(dir);

  // composers
  const size2 = () => new THREE.Vector2(W, H);
  const torusComposer = new EffectComposer(renderer);
  torusComposer.renderToScreen = false;
  torusComposer.addPass(new RenderPass(scene, camera));
  torusComposer.addPass(new ShaderPass(GammaCorrectionShader));
  torusComposer.addPass(new UnrealBloomPass(size2(), 0.22, 0.2, 0));
  torusComposer.addPass(new ShaderPass(CopyShader));

  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  bloomComposer.addPass(new UnrealBloomPass(size2(), 0.5, 0.6, 0));
  bloomComposer.addPass(new ShaderPass(GammaCorrectionShader));

  const FinalPass = {
    uniforms: {
      iTime:{value:0}, tDiffuse:{value:null}, torusTexture:{value:null}, bloomTexture:{value:null}, haloTexture:{value:null},
      uBg:{value:hexToVec3(CONFIG.bgColor)}, uFlameA:{value:hexToVec3(CONFIG.flameColor)},
      uFlameB:{value:hexToVec3(CONFIG.flameColor2)}, uFlameAmt:{value:CONFIG.flameAmt},
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `
    uniform float iTime; uniform sampler2D tDiffuse; uniform sampler2D bloomTexture; uniform sampler2D torusTexture; uniform sampler2D haloTexture;
    uniform vec3 uBg; uniform vec3 uFlameA; uniform vec3 uFlameB; uniform float uFlameAmt;
    varying vec2 vUv;
    vec3 warp3d(vec3 pos, float t){ float curv=.8,a=1.9,b=0.7; pos*=2.;
      pos.x+=curv*sin(t+a*pos.y)+t*b; pos.y+=curv*cos(t+a*pos.x);
      pos.y+=curv*sin(t+a*pos.z)+t*b; pos.z+=curv*cos(t+a*pos.y);
      pos.z+=curv*sin(t+a*pos.x)+t*b; pos.x+=curv*cos(t+a*pos.z);
      return 0.5+0.5*cos(pos.xyz+vec3(1,2,4)); }
    void main(){
      vec2 uv = 2.*vUv - 1.;
      vec3 w = pow(warp3d(vec3(uv.x, sin(uv.y), uv.y), iTime*1.5), vec3(1.5));
      vec3 flame = 1.5*uFlameA*w.x; flame*=w.y; flame += uFlameB*w.z;
      flame *= smoothstep(0.25, 1., abs(uv.y));
      float md = smoothstep(-0.7, 1., -uv.y*uv.x); flame *= md*md;
      vec3 bg = uBg * (1.0 - 0.4 * length(uv));
      vec3 halo = texture2D(haloTexture, vUv).xyz;
      gl_FragColor = vec4(bg + flame*uFlameAmt + texture2D(bloomTexture, vUv).xyz + texture2D(torusTexture, vUv).xyz + texture2D(tDiffuse, vUv).xyz + halo, 1.);
    }`,
  };
  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(new RenderPass(scene, camera));
  const finalPass = new ShaderPass(FinalPass);
  finalPass.uniforms.bloomTexture.value = bloomComposer.renderTarget1.texture;
  finalPass.uniforms.torusTexture.value = torusComposer.renderTarget1.texture;
  finalComposer.addPass(finalPass);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enablePan = false;
  controls.enabled = false; controls.autoRotate = true; controls.autoRotateSpeed = CONFIG.autoRotate;
  controls.minDistance = 3.5; controls.maxDistance = 16; controls.target.set(0, 0, 0);

  // scroll keyframes
  const STOPS_X = [{p:0,v:0},{p:0.32,v:-3.1},{p:0.64,v:3.2},{p:1,v:0}];
  const STOPS_Y = [{p:0,v:-4.5},{p:0.32,v:0.55},{p:0.64,v:0.45},{p:1,v:0.15}];
  const STOPS_S = [{p:0,v:2.15},{p:0.32,v:1.0},{p:0.64,v:0.92},{p:1,v:1.12}];

  const worldGroup = new THREE.Group();
  worldGroup.position.set(STOPS_X[0].v, STOPS_Y[0].v, 0);
  worldGroup.scale.setScalar(STOPS_S[0].v);
  worldGroup.visible = false; // shown once the planet exists, so the halo doesn't pop in alone
  scene.add(worldGroup);
  const planetGroup = new THREE.Group(); planetGroup.rotation.z = CONFIG.tilt; worldGroup.add(planetGroup);
  const cloudGroup = new THREE.Group(); cloudGroup.rotation.z = CONFIG.tilt; cloudGroup.visible = false; worldGroup.add(cloudGroup);

  // atmosphere halo
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uGlow:{value:hexToVec3(CONFIG.glowColor)}, uIntensity:{value:CONFIG.glowIntensity} },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uGlow; uniform float uIntensity; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2); gl_FragColor = vec4(uGlow * a * uIntensity, a); }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glowMat);
  glowMesh.scale.setScalar(CONFIG.planetRadius * 2.3);
  glowMesh.layers.set(LAYERS.ENTIRE_SCENE);
  worldGroup.add(glowMesh);

  const uRes = new THREE.Vector2(W * DPR, H * DPR);

  // ambient motes
  let finalTimeDriver = 0;
  {
    const n = CONFIG.atmoCount, pos = new Float32Array(n * 3), sz = new Float32Array(n), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i*3] = Math.random()*2-1; pos[i*3+1] = Math.random()*2-1; pos[i*3+2] = Math.random()*2-1;
      sz[i] = CONFIG.atmoSize * (0.4 + Math.random()); seed[i] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime:{value:0}, uRes:{value:uRes}, uColor:{value:hexToVec3(CONFIG.atmoColor)} },
      vertexShader: `
        attribute float size; attribute float seed; uniform float uTime; uniform vec2 uRes;
        varying float vA;
        vec3 warp(vec3 p, float t){ float c=0.9,a=1.9,b=0.02,s=0.05; p*=2.;
          p.x+=c*sin(s*t+a*p.y)+t*b; p.y+=c*cos(s*t+a*p.x); p.y+=c*sin(s*t+a*p.z)+t*b;
          p.z+=c*cos(s*t+a*p.y); p.z+=c*sin(s*t+a*p.x)+t*b; p.x+=c*cos(s*t+a*p.z);
          return cos(p+vec3(1,2,4)); }
        void main(){
          vec3 v = position*4.0 + warp(position, uTime)*1.2;
          vec4 mv = modelViewMatrix * vec4(v, 1.0);
          float r = length(v); float farF = 1.0 - smoothstep(5.0, 6.5, r); float nearF = smoothstep(0.0, 0.5, -mv.z);
          vA = farF * nearF;
          gl_PointSize = size * uRes.y / 900.0 / -mv.z; gl_PointSize = max(gl_PointSize, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main(){ vec2 p = gl_PointCoord - 0.5; float l = length(p); if (l > 0.5) discard;
          float tex = smoothstep(0.5, 0.0, l); gl_FragColor = vec4(uColor * tex, tex * vA * 0.55); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    });
    const motes = new THREE.Points(g, m);
    motes.frustumCulled = false;
    motes.layers.set(LAYERS.ENTIRE_SCENE);
    motes.onBeforeRender = () => {
      const t = performance.now() / 1000;
      motes.position.copy(camera.position);
      m.uniforms.uTime.value = t * CONFIG.atmoSpeed * 8;
      finalPass.uniforms.iTime.value = t;
    };
    scene.add(motes);
  }

  // starfield
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime:{value:0}, uSize:{value:CONFIG.starSize}, uFlicker:{value:CONFIG.starFlicker}, uColor:{value:hexToVec3(CONFIG.starColor)}, uRes:{value:uRes} },
    vertexShader: `
      attribute float seed; attribute float bright;
      uniform float uTime; uniform float uSize; uniform float uFlicker; uniform vec2 uRes;
      varying float vTw;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 0.6 + 0.4 * sin(uTime * uFlicker + seed);
        vTw = bright * tw;
        gl_PointSize = max(uSize * uRes.y / 900.0 * (90.0 / max(-mv.z, 1.0)), 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vTw;
      void main(){
        vec2 p = gl_PointCoord - 0.5; float l = length(p); if (l > 0.5) discard;
        float core = smoothstep(0.5, 0.0, l);
        gl_FragColor = vec4(uColor, core * vTw);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
  });
  {
    const n = CONFIG.starCount, pos = new Float32Array(n * 3), seed = new Float32Array(n), bright = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i*3] = 90 * r * Math.cos(th); pos[i*3+1] = 90 * u; pos[i*3+2] = 90 * r * Math.sin(th);
      seed[i] = Math.random() * 100; bright[i] = 0.35 + Math.random() * 0.65;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('bright', new THREE.BufferAttribute(bright, 1));
    const stars = new THREE.Points(g, starMat);
    stars.frustumCulled = false; stars.layers.set(LAYERS.ENTIRE_SCENE);
    scene.add(stars);
  }

  // time bases
  const planetTime = { value: 0 }, cloudTime = { value: 0 };
  let starTime = 0, markerTime = 0, spinPhase = 0;
  const markerMat = new THREE.ShaderMaterial({
    uniforms: { uTime:{value:0}, uColor:{value:hexToVec3(CONFIG.markerColor)}, uSize:{value:CONFIG.markerSize}, uSpeed:{value:CONFIG.markerSpeed}, uRes:{value:uRes} },
    vertexShader: `
      attribute float seed; uniform float uSize; uniform vec2 uRes;
      varying float vSeed; varying float vFade;
      void main(){
        vSeed = seed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 vn = normalize(normalMatrix * normalize(position));
        vec3 vd = normalize(-mv.xyz);
        vFade = smoothstep(0.15, 0.5, dot(vn, vd));
        gl_PointSize = max(uSize * uRes.y / 900.0 * (7.0 / max(-mv.z, 1.0)), 2.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; uniform float uSpeed;
      varying float vSeed; varying float vFade;
      void main(){
        if (vFade <= 0.001) discard;
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.30, 0.0, d) * 1.2;
        float ph = fract(uTime * uSpeed + vSeed);
        float ring = smoothstep(0.07, 0.0, abs(d - ph)) * (1.0 - ph);
        gl_FragColor = vec4(uColor, clamp(core + ring, 0.0, 1.0) * vFade);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false,
  });

  // ---- planet material injection ----
  function makePlanetMaterial(baseMat, nightTex) {
    const mat = baseMat.clone();
    mat.metalness = 0; mat.roughness = 1; mat.envMapIntensity = 0;
    mat.extensions = Object.assign({}, mat.extensions, { derivatives: true }); // dFdx/dFdy under WebGL1
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        time: planetTime, noiseScale:{value:30}, speedX:{value:1.5}, speedY:{value:2.0}, speedZ:{value:2.5},
        rimColor:{value:new THREE.Color(CONFIG.rimColor)}, rimPower:{value:CONFIG.rimPower},
        nightBlendTexture:{value:nightTex}, nightLights:{value:CONFIG.nightLights},
        terrainDepth:{value:CONFIG.terrainDepth}, terrainShade:{value:CONFIG.terrainShade},
        oceanGlint:{value:CONFIG.oceanGlint}, oceanDeep:{value:CONFIG.oceanDeep},
        oceanFlow:{value:CONFIG.oceanFlow}, oceanFlowSpeed:{value:CONFIG.oceanFlowSpeed}, oceanFlowScale:{value:CONFIG.oceanFlowScale},
      });
      shader.vertexShader = 'varying vec2 vCustomUv;\n' + shader.vertexShader.replace(/void\s+main\s*\(\s*\)\s*\{/, 'void main(){\n vCustomUv = uv;');
      shader.fragmentShader = `
        varying vec2 vCustomUv;
        uniform float time; uniform float noiseScale; uniform float speedX; uniform float speedY; uniform float speedZ;
        uniform vec3 rimColor; uniform float rimPower; uniform sampler2D nightBlendTexture; uniform float nightLights;
        uniform float terrainDepth; uniform float terrainShade; uniform float oceanGlint; uniform float oceanDeep;
        uniform float oceanFlow; uniform float oceanFlowSpeed; uniform float oceanFlowScale;
        ${SNOISE}
      ` + shader.fragmentShader.replace('#include <dithering_fragment>', `
        #include <dithering_fragment>
        vec3 normalizedNormal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        float rim = 1.0 - max(dot(viewDir, normalizedNormal), 0.0);
        rim = pow(rim, rimPower); rim = pow(rim, 1.5); rim *= 0.7;
        vec3 currentColor = gl_FragColor.rgb;
        float blueDom = currentColor.b - max(currentColor.r, currentColor.g);
        float waterMask = clamp(smoothstep(-0.005, 0.03, blueDom), 0.0, 1.0);
        float shimmer = snoise(vec3(vCustomUv.x * noiseScale + time * speedX, vCustomUv.y * noiseScale - time * speedY, time * speedZ));
        gl_FragColor.rgb += waterMask * shimmer * 0.025;
        float fT = time * oceanFlowSpeed * 4.0;
        float fS = 4.0 * oceanFlowScale;
        float warp = snoise(vec3(vCustomUv.x * fS - fT * 0.5, vCustomUv.y * fS + fT * 0.4, fT * 0.5));
        float flow = snoise(vec3(vCustomUv.x * fS * 2.0 + fT * 0.6 + warp, vCustomUv.y * fS * 2.0 - fT * 0.5, fT * 0.7));
        flow = warp * 0.6 + flow * 0.4;
        gl_FragColor.rgb += waterMask * flow * 0.12 * oceanFlow;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.01, 0.06, 0.16), waterMask * oceanDeep);
        vec3 finalColor = mix(gl_FragColor.rgb, rimColor, rim);
        gl_FragColor = vec4(finalColor, 1.0);
        vec3 surfPos = -vViewPosition;
        float terrH = dot(texture2D(map, vCustomUv).rgb, vec3(0.299, 0.587, 0.114));
        vec3 sigX = dFdx(surfPos), sigY = dFdy(surfPos);
        vec3 vR1 = cross(sigY, normalizedNormal), vR2 = cross(normalizedNormal, sigX);
        float fDet = dot(sigX, vR1);
        vec3 vGrad = sign(fDet) * (dFdx(terrH) * vR1 + dFdy(terrH) * vR2);
        vec3 bumpedNormal = normalize(abs(fDet) * normalizedNormal - terrainDepth * vGrad);
        vec3 shadeNormal = mix(bumpedNormal, normalizedNormal, waterMask);
        vec3 cityLights = texture2D(nightBlendTexture, vCustomUv).rgb * gl_FragColor.rgb * nightLights;
        vec3 viewSunDir = normalize(vec3(-0.9, 0.18, 0.4));
        float ndl = dot(normalizedNormal, viewSunDir);
        float dayAmt = smoothstep(-0.05, 0.35, ndl);
        float relief = dot(shadeNormal, viewSunDir) - ndl;
        gl_FragColor.rgb *= clamp(1.0 + relief * terrainShade * dayAmt, 0.55, 1.6);
        float nightFactor  = smoothstep(0.18, -0.30, ndl);
        float lightsFactor = smoothstep(0.30, -0.35, ndl);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.08, nightFactor);
        gl_FragColor.rgb += cityLights * lightsFactor;
        vec3 halfDir = normalize(viewSunDir + viewDir);
        float ripple = snoise(vec3(vCustomUv * 240.0, time * 4.0));
        float ndh = max(dot(normalizedNormal, halfDir) + ripple * 0.02, 0.0);
        float glint = pow(ndh, 140.0);
        gl_FragColor.rgb += glint * waterMask * dayAmt * oceanGlint * vec3(1.0, 0.97, 0.88);
      `);
    };
    return mat;
  }

  // land-only golden markers
  function addMarkers(mesh) {
    try {
      const img = mesh.material.map && mesh.material.map.image;
      const geo = mesh.geometry, P = geo.attributes.position, UV = geo.attributes.uv;
      if (!img || !UV) return;
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
      const data = cx.getImageData(0, 0, cv.width, cv.height).data;
      const idx = geo.index ? geo.index.array : null;
      const triCount = (idx ? idx.length : P.count) / 3;
      const vi = (t, k) => idx ? idx[t * 3 + k] : t * 3 + k;
      const cum = new Float32Array(triCount); let total = 0;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let t = 0; t < triCount; t++) {
        a.fromBufferAttribute(P, vi(t, 0)); b.fromBufferAttribute(P, vi(t, 1)); c.fromBufferAttribute(P, vi(t, 2));
        total += b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5; cum[t] = total;
      }
      const pts = [], seeds = [];
      for (let tries = 0; tries < 6000 && pts.length < CONFIG.markerCount * 3; tries++) {
        const r = Math.random() * total; let lo = 0, hi = triCount - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
        const t = lo; let u = Math.random(), v = Math.random(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
        const i0 = vi(t,0), i1 = vi(t,1), i2 = vi(t,2);
        const uu = UV.getX(i0)*w + UV.getX(i1)*u + UV.getX(i2)*v;
        const vv = UV.getY(i0)*w + UV.getY(i1)*u + UV.getY(i2)*v;
        const px = clamp(Math.floor(uu * cv.width), 0, cv.width - 1), py = clamp(Math.floor(vv * cv.height), 0, cv.height - 1);
        const o = (py * cv.width + px) * 4, cr = data[o], cg = data[o+1], cb = data[o+2];
        if (cb > cr + 6 && cb > cg + 6) continue; // ocean
        a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
        const q = a.multiplyScalar(w).add(b.multiplyScalar(u)).add(c.multiplyScalar(v)).multiplyScalar(1.012);
        pts.push(q.x, q.y, q.z); seeds.push(Math.random());
        if (pts.length / 3 >= CONFIG.markerCount) break;
      }
      if (!seeds.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
      const markers = new THREE.Points(g, markerMat);
      markers.frustumCulled = false;
      markers.layers.set(LAYERS.ENTIRE_SCENE);
      mesh.add(markers);
    } catch (e) { console.warn('markers skipped', e); }
  }

  // clouds
  function addClouds(tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(5, 5);
    const defs = [
      { h:CONFIG.cloud1Height, o:CONFIG.cloud1Opacity, s:'cloud1Spin', ry:0.0, phase:0.0 },
      { h:CONFIG.cloud2Height, o:CONFIG.cloud2Opacity, s:'cloud2Spin', ry:2.2, phase:13.0 },
      { h:CONFIG.cloud3Height, o:CONFIG.cloud3Opacity, s:'cloud3Spin', ry:4.3, phase:27.0 },
    ];
    return defs.map((d) => {
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false });
      mat.extensions = { derivatives: true };
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, { uTime: cloudTime, noiseScale:{value:20}, uSpeedX:{value:1}, uSpeedY:{value:2}, uSpeedZ:{value:2}, uOpacity:{value:d.o}, uPhase:{value:d.phase} });
        shader.vertexShader = 'varying vec2 vCloudUv;\n' + shader.vertexShader.replace(/void\s+main\s*\(\s*\)\s*\{/, 'void main(){\n vCloudUv = uv;');
        shader.fragmentShader = `
          varying vec2 vCloudUv; uniform float uTime; uniform float noiseScale; uniform float uSpeedX; uniform float uSpeedY; uniform float uSpeedZ; uniform float uOpacity; uniform float uPhase;
          ${SNOISE}
        ` + shader.fragmentShader.replace('#include <dithering_fragment>', `
          #include <dithering_fragment>
          gl_FragColor.rgb = vec3(1.0);
          float cloudNoise = snoise(vec3(vCloudUv.x * noiseScale + uTime * uSpeedX + uPhase, vCloudUv.y * noiseScale - uTime * uSpeedY + uPhase, uTime * uSpeedZ + uPhase));
          float cloudNdv = max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0);
          float cloudEdge = pow(1.0 - cloudNdv, 3.0);
          float cloudMod = mix(cloudNoise, 1.0, cloudEdge);
          float cloudNdl = dot(normalize(vNormal), normalize(vec3(-0.9, 0.18, 0.4)));
          float cloudDay = 1.0 - smoothstep(0.30, -0.30, cloudNdl) * 0.9;
          gl_FragColor.a *= cloudMod * uOpacity * cloudDay;
        `);
      };
      const m = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.planetRadius * d.h, 64, 64), mat);
      m.rotation.y = d.ry; m.renderOrder = 2; m.layers.set(LAYERS.ENTIRE_SCENE);
      cloudGroup.add(m);
      return { mesh: m, spinKey: d.s };
    });
  }

  // ---- load assets (with a procedural fallback so the page is never empty) ----
  let clouds = [], loaded = false, entryStart = 0;
  const ENTRY_DUR = reduceMotion ? 0.001 : 1.9, ENTRY_START_Y = -6.5;

  function proceduralPlanet() {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
    const x = cv.getContext('2d'); x.fillStyle = '#143c8c'; x.fillRect(0, 0, 1024, 512);
    x.fillStyle = '#3b7a3a';
    for (let i = 0; i < 60; i++) { x.beginPath(); x.ellipse(Math.random()*1024, 80 + Math.random()*350, 20 + Math.random()*70, 12 + Math.random()*40, Math.random()*3, 0, 7); x.fill(); }
    const map = new THREE.CanvasTexture(cv); map.encoding = THREE.sRGBEncoding;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), new THREE.MeshStandardMaterial({ map }));
    return mesh;
  }

  function installPlanet(mesh, nightTex) {
    mesh.geometry.computeBoundingSphere();
    const s = CONFIG.planetRadius / mesh.geometry.boundingSphere.radius;
    mesh.scale.setScalar(s);
    mesh.material = makePlanetMaterial(mesh.material, nightTex);
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.layers.set(LAYERS.ENTIRE_SCENE);
    planetGroup.add(mesh);
    window.__planetMesh = mesh;
    addMarkers(mesh);
    cloudGroup.visible = true; worldGroup.visible = true;
    loaded = true; entryStart = performance.now() / 1000;
    document.documentElement.classList.add('gl');
  }

  const draco = new DRACOLoader(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
  const gltf = new GLTFLoader(); gltf.setDRACOLoader(draco);
  const loadGLB = (url) => new Promise((res, rej) => gltf.load(url, res, undefined, rej));
  const firstMesh = (root) => { let f = null; root.traverse((o) => { if (!f && o.isMesh) f = o; }); return f; };
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackTex.needsUpdate = true;

  (async () => {
    let nightTex = blackTex;
    try { const lg = await loadGLB(PLANET_LIGHTS_GLB); const lm = firstMesh(lg.scene); if (lm && lm.material.map) nightTex = lm.material.map; } catch (e) { console.warn('night lights unavailable', e); }
    try {
      const pg = await loadGLB(PLANET_GLB);
      const pm = firstMesh(pg.scene); if (!pm) throw new Error('no mesh in planet.glb');
      installPlanet(pm, nightTex);
    } catch (e) {
      console.warn('planet.glb unavailable, using a stand-in globe', e);
      installPlanet(proceduralPlanet(), nightTex);
    }
    try {
      new THREE.TextureLoader().load(PLANET_CLOUDS_PNG, (tex) => { clouds = addClouds(tex); }, undefined, () => {});
    } catch (e) {}
  })();

  // ---- resize ----
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === W && Math.abs(h - H) < 120) return; // ignore mobile URL-bar jiggle
    W = w; H = h;
    camera.aspect = W / H; camera.updateProjectionMatrix();
    renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
    [torusComposer, bloomComposer, finalComposer].forEach((c) => { c.setPixelRatio(DPR); c.setSize(W, H); });
    uRes.set(W * DPR, H * DPR);
  }
  window.addEventListener('resize', onResize);

  // ---- frame loop ----
  let last = performance.now() / 1000, curP = 0, curX = STOPS_X[0].v, curY = STOPS_Y[0].v, curS = STOPS_S[0].v;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last); last = now;
    planetTime.value += dt / 12; cloudTime.value += dt / 20; starTime += dt; markerTime += dt;
    starMat.uniforms.uTime.value = starTime; markerMat.uniforms.uTime.value = markerTime;
    clouds.forEach((c) => { c.mesh.rotation.y += dt * CONFIG[c.spinKey]; });
    spinPhase += dt * CONFIG.spin;

    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const pTarget = clamp(window.scrollY / maxScroll, 0, 1);
    curP += (pTarget - curP) * Math.min(1, dt * 4.5);
    const sideScale = clamp(window.innerWidth / 1200, 0.5, 1);
    const k = Math.min(1, dt * 3.2);
    curX += (sample(STOPS_X, curP) * sideScale - curX) * k;
    curY += (sample(STOPS_Y, curP) - curY) * k;
    curS += (sample(STOPS_S, curP) - curS) * k;
    let entryY = ENTRY_START_Y;
    if (loaded) { const t = clamp((now - entryStart) / ENTRY_DUR, 0, 1); entryY = ENTRY_START_Y * (1 - (1 - Math.pow(1 - t, 3))); }
    worldGroup.position.set(curX, curY + entryY, 0);
    worldGroup.scale.setScalar(curS);
    planetGroup.rotation.y = CONFIG.initRotation + spinPhase + curP * Math.PI * 1.6;
    glowMesh.quaternion.copy(camera.quaternion);

    controls.update();
    camera.layers.set(LAYERS.TORUS_SCENE); torusComposer.render();
    camera.layers.set(LAYERS.BLOOM_SCENE); bloomComposer.render();
    camera.layers.set(LAYERS.ENTIRE_SCENE); finalComposer.render();
  }
  requestAnimationFrame(frame);
}
