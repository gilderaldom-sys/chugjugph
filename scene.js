// Chug Jug PH — fixed WebGL backdrop (Blue Razz Rush jug) behind the page + Lenis smooth scroll.
// Ported from the "Ascend" layout spec (three r0.143), with the Blue Razz Rush and Strawberry Bomb jugs in place of the planet.
// Everything degrades quietly: if WebGL or the CDN fails, the page keeps its normal dark background.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const JUG_IMG = 'media/blue-razz.webp';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CONFIG = {
  glowColor:'#2f7bff', glowIntensity:2.6,
  bgColor:'#040a1e', flameColor:'#3a6cff', flameColor2:'#c1faff', flameAmt:0.15,
  atmoColor:'#9fc4ff', atmoCount:320, atmoSize:22, atmoSpeed:0.8,
  starColor:'#cfe0ff', starCount:1400, starSize:1.6, starFlicker:1,
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

// ---- WebGL backdrop ----
try { initPlanet(); } catch (e) { console.warn('Planet scene unavailable', e); }

function initPlanet() {
  const canvas = document.getElementById('planetCanvas');
  if (!canvas) return;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) return;

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
  controls.enabled = false; controls.autoRotate = true; controls.autoRotateSpeed = 0;
  controls.minDistance = 3.5; controls.maxDistance = 16; controls.target.set(0, 0, 0);

  // scroll keyframes
  // Two flavors that mirror each other: Blue Razz Rush (sign +1) and Strawberry Bomb (sign -1).
  const STOPS_X = [{p:0,v:-1.9},{p:0.08,v:-3.7},{p:0.4,v:3.7},{p:0.7,v:-3.7},{p:0.9,v:3.5},{p:1,v:-2.3}]; // blue's x; strawberry mirrors it
  const STOPS_Y = [{p:0,v:-3.6},{p:0.08,v:0.2},{p:0.4,v:0.1},{p:0.7,v:0.2},{p:0.9,v:0.1},{p:1,v:-0.2}];
  const STOPS_S = [{p:0,v:1.0},{p:0.08,v:0.78},{p:0.4,v:0.78},{p:0.7,v:0.78},{p:0.9,v:0.78},{p:1,v:0.85}];

  const makeGlowMat = (hex) => new THREE.ShaderMaterial({
    uniforms: { uGlow:{value:hexToVec3(hex)}, uIntensity:{value:CONFIG.glowIntensity} },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uGlow; uniform float uIntensity; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2); gl_FragColor = vec4(uGlow * a * uIntensity, a); }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const JUG_DEFS = [
    { url: 'media/blue-razz.webp',       glow: '#2f7bff', sign:  1, delay: 0 },
    { url: 'media/strawberry-bomb.webp', glow: '#ff3f81', sign: -1, delay: 0.35 },
  ];
  const jugs = JUG_DEFS.map((d) => {
    const world = new THREE.Group();
    world.position.set(d.sign * STOPS_X[0].v, STOPS_Y[0].v, 0);
    world.scale.setScalar(STOPS_S[0].v);
    world.visible = false; // shown once its image has loaded, so the halo doesn't pop in alone
    scene.add(world);
    const group = new THREE.Group(); world.add(group);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), makeGlowMat(d.glow));
    glow.scale.setScalar(4.4);
    glow.layers.set(LAYERS.ENTIRE_SCENE);
    world.add(glow);
    return { ...d, world, group, glow, loaded: false, entryStart: 0 };
  });

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

  let starTime = 0, spinPhase = 0;

  // ---- the jug: a lit-from-behind billboard of the Blue Razz Rush photo ----
  const JUG_H = 3.6;
  const ENTRY_DUR = reduceMotion ? 0.001 : 1.9, ENTRY_START_Y = -6.5;
  jugs.forEach((j) => {
    new THREE.TextureLoader().load(j.url, (tex) => {
      tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const aspect = tex.image.width / tex.image.height;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.88, color: 0xc4cce4 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(JUG_H * aspect, JUG_H), mat);
      mesh.layers.set(LAYERS.ENTIRE_SCENE);
      mesh.renderOrder = 3;
      j.group.add(mesh);
      j.world.visible = true; j.loaded = true; j.entryStart = performance.now() / 1000 + j.delay;
    }, undefined, () => { console.warn('jug image unavailable', j.url); });
  });
  document.documentElement.classList.add('gl');

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
    starTime += dt; spinPhase += dt;
    starMat.uniforms.uTime.value = starTime;

    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const pTarget = clamp(window.scrollY / maxScroll, 0, 1);
    curP += (pTarget - curP) * Math.min(1, dt * 4.5);
    const sideScale = clamp(window.innerWidth / 1200, 0.5, 1);
    const k = Math.min(1, dt * 3.2);
    curX += (sample(STOPS_X, curP) * sideScale - curX) * k;
    curY += (sample(STOPS_Y, curP) - curY) * k;
    curS += (sample(STOPS_S, curP) - curS) * k;
    const fit = clamp(window.innerWidth / 1000, 0.45, 1); // smaller jugs on narrow screens
    jugs.forEach((j, n) => {
      let entryY = ENTRY_START_Y;
      if (j.loaded) { const t = clamp((now - j.entryStart) / ENTRY_DUR, 0, 1); entryY = ENTRY_START_Y * Math.pow(1 - t, 3); }
      j.world.position.set(j.sign * curX, curY + entryY, 0);
      j.world.scale.setScalar(curS * fit);
      // each jug turns as you scroll (a swaying yaw, never showing its back) and floats gently, out of step with its partner
      const ph = spinPhase + n * 1.7;
      j.group.rotation.y = j.sign * (Math.sin(curP * Math.PI * 3) * 0.55) + Math.sin(ph * 0.6) * 0.06;
      j.group.rotation.z = j.sign * Math.sin(curP * Math.PI * 2) * 0.07 + Math.sin(ph * 0.5) * 0.015;
      j.group.position.y = Math.sin(ph * 0.9) * 0.08;
      j.glow.quaternion.copy(camera.quaternion);
    });

    controls.update();
    camera.layers.set(LAYERS.TORUS_SCENE); torusComposer.render();
    camera.layers.set(LAYERS.BLOOM_SCENE); bloomComposer.render();
    camera.layers.set(LAYERS.ENTIRE_SCENE); finalComposer.render();
  }
  requestAnimationFrame(frame);
}
