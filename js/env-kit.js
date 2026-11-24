import * as THREE from 'three';

/* ============================================================
   Nền cảnh cho Studio — MỘT đường ống hình ảnh duy nhất.
   ------------------------------------------------------------
   Nguyên tắc:  NỀN = địa điểm (mỗi cảnh một cái)   ·   HIỆU ỨNG = thứ xảy ra trong địa điểm (fx-kit.js).

   Các loại nền (s.bgt):
     'color' 'grad' 'img' 'vid'   nền phẳng — vẽ BÊN TRONG WebGL (không còn lớp HTML riêng),
                                  nên sương mù, mờ ảo, biến dạng không khí… áp được lên ảnh / video.
     'env'                        môi trường 3D: bầu trời / đêm sao / studio / nhà / lớp học / bóng râm / nắng gắt / dưới nước.
     'pano'                       ảnh 360° (equirectangular 2:1), xoay được, tuỳ chọn làm ánh sáng phản chiếu.

   Thứ tự vẽ mỗi khung hình (render):
     nền → cảnh 3D (nhân vật, mô hình, hạt) → hậu kỳ [mờ ảo + biến dạng] → lớp phủ màn hình [viền tối, nhiễu, viền đen…]
   Hậu kỳ + lớp phủ + sương mù lấy từ fx-kit (khối hiệu ứng trên timeline), nên bật / tắt / hiện dần theo thời gian.

   Sương mù: fx 'fog' ghi vào scene.fog → vật thể + phòng (nhà / lớp học) mờ theo khoảng cách;
   bầu trời, ảnh 360° và nền phẳng được phủ một lớp sương (haze) cùng màu, nên nền KHÔNG còn nét hơn nhân vật.

   Mọi thứ tính từ thời gian t → tua / xuất video cho kết quả giống hệt lúc xem.

   API:
     const env = createEnvEngine(scene, camera, renderer)
     env.setLights(hemiLight, dirLight)                // đèn mặc định của Studio
     env.update(sceneData, t, {url, custom, aspect, bg, post})
         url    : ảnh 360° (khi bgt='pano')
         custom : true nếu cảnh có đèn riêng (không ghi đè đèn)
         bg     : mô tả nền phẳng {type:'color'|'grad'|'img'|'vid', c1, c2, ang, fit, z, x, y, url, el, force}
                  (force = khối "nền màu" trên timeline đang phủ lên mọi loại nền)
         post   : fxEngine.post  ({amp, type, glow, speed, t})
     env.render(renderer, scene, camera, fxEngine)     // thay cho renderer.render
     env.preload(url)                                  // chờ ảnh tải xong (xuất video)
     env.refresh()                                     // báo có tài nguyên mới (video sẵn sàng…)
   ============================================================ */

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sh = (c, k) => { const o = new THREE.Color(c); o.multiplyScalar(k); return '#' + o.getHexString(); };

/** Chỉ còn các ĐỊA ĐIỂM. Sương mù / mờ ảo / hơi nóng / sóng nước chuyển sang tab Hiệu ứng (xem ENV_BUNDLES). */
export const ENV_PRESETS = [
  ['sky', '☀️ Bầu trời'], ['night', '🌙 Đêm sao'], ['studio', '🎬 Studio'], ['house', '🏠 Trong nhà'],
  ['classroom', '🏫 Lớp học'], ['shade', '🌳 Bóng râm'], ['sun', '🔆 Nắng gắt'], ['underwater', '🌊 Dưới nước']
];
const BASE = {c1: '#2f7fe0', c2: '#cfe6ff', c3: '#7d8f6a', sc: '#fff4e0', light: 1, hk: 1, lk: 1, hc: '#ffffff', hg: '#666070', lc: '#ffffff', speed: 1,
  sun: 0, az: 120, el: 24, sl: false, stars: 0, clouds: 0, rays: 0, canopy: 0, rot: 0, exp: 1, ibl: false, room: ''};
const PRE = {
  sky: {c1: '#2f7fe0', c2: '#cfe6ff', c3: '#7d8f6a', sun: .7, clouds: .5, lc: '#fff4e0', lk: 1.05, hc: '#bcd8ff', hg: '#6a6a58'},
  night: {c1: '#04081c', c2: '#1b2a52', c3: '#0a0f1e', sc: '#dfe8ff', sun: .8, az: 200, el: 30, stars: .9, clouds: .2, lc: '#8fa8ff', lk: .45, hc: '#4660a8', hg: '#101830', hk: .6},
  studio: {c1: '#4a4f5c', c2: '#8a90a0', c3: '#2a2d36', light: 1.1, hk: 1.1, lk: .9},
  house: {room: 'house', c1: '#f1e9dc', c2: '#e8d5b5', c3: '#a8794a', hc: '#ffe9c8', hg: '#7a5a3a', hk: 1.1, lc: '#ffd9a8', lk: .8},
  classroom: {room: 'classroom', c1: '#f2f2ee', c2: '#e9e4cf', c3: '#b7a98f', hc: '#f4f8ff', hg: '#8a8a80', hk: 1.2, lc: '#ffffff', lk: .8},
  shade: {c1: '#5d8f86', c2: '#a9c4bd', c3: '#3b5a3d', canopy: .55, sun: 0, lc: '#bcd4ff', lk: .5, hc: '#a6c8c0', hg: '#30463a', hk: .9},
  sun: {c1: '#6ab2ff', c2: '#fff7e0', c3: '#c9b27a', sc: '#fff3cf', sun: 1.2, el: 38, clouds: .1, lc: '#fff1c8', lk: 1.8, hc: '#ffffff', hg: '#c9a86a', hk: .8},
  underwater: {c1: '#06385a', c2: '#1b8aa6', c3: '#0a3a4a', rays: .8, el: 80, lc: '#9fe6ff', lk: .9, hc: '#5fc3dc', hg: '#0b3346', hk: .9},
  pano: {}
};
/** "Thêm hiệu ứng đi kèm": mỗi địa điểm gợi ý vài khối hiệu ứng — thêm vào timeline để sửa / xoá tuỳ ý (không còn ẩn trong thanh trượt của nền). */
export const ENV_BUNDLES = {
  sky: [],
  night: [{fx: 'fog', color: '#1b2a52', density: .12}],
  studio: [{fx: 'glow', intensity: .12}],
  house: [{fx: 'dust'}],
  classroom: [{fx: 'dust'}],
  shade: [{fx: 'fog', color: '#a9c4bd', density: .15}, {fx: 'glow', intensity: .2}],
  sun: [{fx: 'distort', kind: 'heat', intensity: .3}, {fx: 'glow', intensity: .35}],
  underwater: [{fx: 'fog', color: '#1b8aa6', density: .5}, {fx: 'distort', kind: 'wave', intensity: .35}, {fx: 'glow', intensity: .25}]
};
export const envBundle = k => ENV_BUNDLES[k] || [];
export const envDefaults = k => { k = PRE[k] ? k : 'sky'; return {preset: k, ...BASE, ...PRE[k]}; };
export const envParams = s => { const e = s && s.env, k = e && PRE[e.preset] ? e.preset : 'sky'; return {...envDefaults(k), ...(e || {}), preset: k}; };

/** Danh sách trường chỉnh: [khoá, nhãn, kiểu('r' thanh trượt | 'c' màu | 'b' bật tắt), min, max, step].
 *  kind: 'env' (môi trường 3D) | 'pano' (ảnh 360°). Mờ ảo / biến dạng / sương mù KHÔNG còn ở đây — chúng là hiệu ứng. */
export function envFields(P, kind) {
  if (kind === 'pano') return [['rot', 'Xoay ảnh 360° (độ)', 'r', -180, 180, 1], ['exp', 'Độ sáng ảnh', 'r', 0, 3, .01], ['ibl', 'Dùng ảnh làm ánh sáng phản chiếu cho nhân vật', 'b']];
  const f = P.room ? [['c1', 'Màu trần', 'c'], ['c2', 'Màu tường', 'c'], ['c3', 'Màu sàn', 'c']] : [['c1', 'Màu đỉnh trời', 'c'], ['c2', 'Màu chân trời', 'c'], ['c3', 'Màu mặt đất', 'c']];
  f.push(['light', 'Cường độ ánh sáng', 'r', 0, 3, .01]);
  if (!P.room) f.push(['sun', 'Mặt trời / trăng (độ sáng)', 'r', 0, 2, .01], ['az', 'Hướng mặt trời (độ)', 'r', 0, 360, 1], ['el', 'Độ cao mặt trời (độ)', 'r', -10, 89, 1], ['sl', 'Ánh sáng lên nhân vật theo hướng mặt trời', 'b'],
    ['clouds', 'Mây', 'r', 0, 1, .01], ['stars', 'Sao', 'r', 0, 1, .01], ['rays', 'Tia sáng dưới nước', 'r', 0, 1, .01], ['canopy', 'Tán lá che nắng', 'r', 0, 1, .01],
    ['speed', 'Tốc độ chuyển động (mây, tia sáng)', 'r', 0, 4, .05]);
  return f;
}

/* ---------------- Bầu trời bằng shader (có sương phủ về phía chân trời) ---------------- */
const DOME_FS = `precision highp float; varying vec3 vD;
uniform vec3 uTop,uHor,uBot,uSunC,uSunD,uFogC; uniform float uT,uSun,uStars,uClouds,uRays,uCanopy,uFogK;
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.03+vec2(7.1,3.3);a*=.5;}return s;}
void main(){
  vec3 d=normalize(vD); float h=d.y;
  vec3 col=mix(uHor,uTop,pow(clamp(h,0.,1.),.55));
  col=mix(col,uBot,smoothstep(.02,-.25,h));
  float sd=max(dot(d,uSunD),0.);
  if(uStars>0.&&h>-.05){
    vec3 p=d*95.,ip=floor(p),f=fract(p)-.5; float r=h21(ip.xy+ip.z*13.7);
    float st=smoothstep(.2,0.,length(f))*step(.975,r)*(.55+.45*sin(uT*2.+r*60.));
    col+=vec3(st)*uStars*smoothstep(0.,.25,h);
  }
  if(uClouds>0.&&h>0.){
    vec2 q=d.xz/(h+.25)*1.4+vec2(uT*.012,0.); float c=fbm(q*1.6);
    float m=smoothstep(.62-.3*uClouds,.95-.2*uClouds,c)*smoothstep(0.,.12,h);
    vec3 cc=mix(uHor,vec3(1.),.6)*(.8+.4*pow(sd,2.)); col=mix(col,cc,m*.85);
  }
  if(uRays>0.){
    float ray=pow(clamp(fbm(vec2(d.x/(h+.4)*3.+uT*.07,d.z/(h+.4)*.6))*1.8-.45,0.,1.),2.);
    col+=vec3(.5,.9,1.)*ray*uRays*smoothstep(0.,.5,h)*.5;
  }
  if(uCanopy>0.&&h>.15){
    vec2 q=d.xz/(h+.1)*2.2; float l=smoothstep(.45,.55,fbm(q*3.+vec2(uT*.03)));
    float w=smoothstep(.15,.45,h);
    col=mix(col,vec3(.05,.16,.08)*(.6+.8*fbm(q*9.)),l*uCanopy*w); col+=(1.-l)*uSunC*.3*uCanopy*w;
  }
  float disc=smoothstep(.9985,.9995,sd), glow=pow(sd,64.)*.6+pow(sd,8.)*.25;
  col+=uSunC*(disc*1.5+glow)*uSun;
  col=mix(col,uFogC,uFogK*(1.-.7*smoothstep(0.,.6,max(h,0.))));   // sương: dày nhất ở chân trời
  gl_FragColor=vec4(col,1.);
  #include <colorspace_fragment>
}`;

/* ---------------- Nền phẳng (màu / gradient / ảnh / video) vẽ trong WebGL ----------------
   Màu truyền dạng sRGB thô để gradient trộn giống CSS (trộn trong sRGB), rồi đổi sang tuyến tính. */
const FLAT_FS = `precision highp float; varying vec2 vUv; uniform sampler2D tMap;
uniform vec3 uC1,uC2,uFogC; uniform float uMode,uAng,uAsp,uImgAsp,uFit,uZ,uFogK; uniform vec2 uOff;
vec3 s2l(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c));}
void main(){
  vec2 p=(vUv-.5)*vec2(uAsp,1.);
  vec3 col=uC1;
  if(uMode>.5&&uMode<1.5){
    vec2 d=vec2(sin(uAng),cos(uAng)); float len=abs(uAsp*d.x)+abs(d.y);
    col=mix(uC1,uC2,clamp(dot(p,d)/len+.5,0.,1.));
  }
  vec3 lin=s2l(col);
  vec4 tx=texture2D(tMap,vec2(.5));
  if(uMode>1.5){
    float hi=uFit<.5?max(1.,uAsp/uImgAsp):(uFit<1.5?min(1.,uAsp/uImgAsp):1.);
    vec2 sz=(uFit<1.5?vec2(uImgAsp*hi,hi):vec2(uAsp,1.))*uZ;
    vec2 q=(p-vec2(uOff.x*uAsp,-uOff.y))/sz+.5;
    tx=texture2D(tMap,q);
    float inside=step(0.,q.x)*step(q.x,1.)*step(0.,q.y)*step(q.y,1.);
    lin=mix(lin,tx.rgb,tx.a*inside);
  }
  lin=mix(lin,uFogC,uFogK*.7);
  gl_FragColor=vec4(lin,1.);
  #include <colorspace_fragment>
}`;

/* ---------------- Ảnh 360° ---------------- */
const PANO_FS = `precision highp float; varying vec2 vUv; varying float vH; uniform sampler2D tMap; uniform vec3 uFogC; uniform float uExp,uFogK;
void main(){
  vec3 c=texture2D(tMap,vUv).rgb*uExp;
  c=mix(c,uFogC,uFogK*(.85-.35*smoothstep(0.,.6,abs(vH))));
  gl_FragColor=vec4(c,1.);
  #include <colorspace_fragment>
}`;

/* ---------------- Hậu kỳ: biến dạng + mờ ảo (tham số lấy từ fx-kit) ---------------- */
const POST_FS = `precision highp float; varying vec2 vUv; uniform sampler2D tMap; uniform float uT,uAmp,uType,uGlow,uAsp; uniform vec2 uRes;
vec2 warp(vec2 uv){
  float a=uAmp;
  if(a<=0.) return uv;
  if(uType<.5){ float w=1.-uv.y*.7; uv.x+=(sin(uv.y*46.+uT*3.1)*.0045+sin(uv.y*19.-uT*2.2)*.0035)*a*w; uv.y+=sin(uv.x*33.+uT*2.3)*.0022*a*w; }
  else if(uType<1.5){ uv+=a*.0065*vec2(sin(uv.y*21.+uT*1.7)+.5*sin(uv.y*43.-uT*1.2),cos(uv.x*25.+uT*1.5)+.5*cos(uv.x*51.-uT*1.1)); }
  else if(uType<2.5){ vec2 p=uv-.5; float d=length(p*vec2(uAsp,1.)); uv+=normalize(p+1e-5)*sin(d*46.-uT*4.)*a*.008*smoothstep(0.,.3,d); }
  else { vec2 p=(uv-.5)*vec2(uAsp,1.); uv=.5+p*(1.+a*.9*dot(p,p))/vec2(uAsp,1.); }
  return clamp(uv,.001,.999);
}
void main(){
  vec2 uv=warp(vUv); vec4 c=texture2D(tMap,uv);
  if(uGlow>0.){
    float rad=uGlow*12.*uRes.y/720.; vec4 b=c; float n=1.;
    for(int i=0;i<12;i++){ float an=float(i)*.5236; for(int j=1;j<=2;j++){ vec2 o=vec2(cos(an),sin(an))*rad*float(j)*.5/uRes; b+=texture2D(tMap,uv+o); n+=1.; } }
    b/=n; c=mix(c,b,uGlow*.55); c.rgb+=max(b.rgb-.55,0.)*uGlow*.9;
  }
  gl_FragColor=c;
  #include <colorspace_fragment>
}`;

/* ---------------- Phòng (nhà / lớp học) dựng bằng canvas + hộp ---------------- */
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function mk(w, h, ppm, fn, rep) {
  const c = document.createElement('canvas'); c.width = Math.round(w * ppm); c.height = Math.round(h * ppm);
  const g = c.getContext('2d'), R = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x * ppm, (h - y - hh) * ppm, ww * ppm, hh * ppm); };
  fn(g, R, ppm, h, w);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
const RH = 3.4, RW = 14, RD = 18, RZ = 3;     // phòng: x ±7, z −6…12, cao 3.4 m
function windowRect(g, R, ppm, H, x, y, w, h) {
  R(x - .06, y - .06, w + .12, h + .12, '#f4f1ea');
  const gr = g.createLinearGradient(0, (H - y - h) * ppm, 0, (H - y) * ppm); gr.addColorStop(0, '#9fd0ff'); gr.addColorStop(1, '#eaf6ff');
  g.fillStyle = gr; g.fillRect(x * ppm, (H - y - h) * ppm, w * ppm, h * ppm);
  R(x + w / 2 - .025, y, .05, h, '#f4f1ea'); R(x, y + h / 2 - .025, w, .05, '#f4f1ea');
}
function wallTex(kind, P, side) {
  const W = side ? RD : RW;
  return mk(W, RH, 90, (g, R, ppm, H) => {
    R(0, 0, W, H, P.c2);
    const gr = g.createLinearGradient(0, 0, 0, H * ppm); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.16)'); g.fillStyle = gr; g.fillRect(0, 0, W * ppm, H * ppm);
    R(0, 0, W, .14, sh(P.c2, .65));
    if (kind === 'house') {
      if (!side) { windowRect(g, R, ppm, H, 2.4, 1.0, 2.2, 1.6); windowRect(g, R, ppm, H, 9.4, 1.0, 2.2, 1.6); R(6.3, 1.5, 1.4, .95, '#6b4a2e'); R(6.38, 1.58, 1.24, .79, '#9fc3d6'); }
      else { windowRect(g, R, ppm, H, 3.5, 1.0, 2.0, 1.6); windowRect(g, R, ppm, H, 12.5, 1.0, 2.0, 1.6); R(8.1, .14, .95, 2.1, '#7a5230'); R(8.9, 1.1, .08, .08, '#d9c27a'); R(5.8, 1.6, .9, .7, '#6b4a2e'); R(5.86, 1.66, .78, .58, '#d9b99a'); }
    } else {
      if (!side) {
        R(0, 0, W, 1.05, sh(P.c2, .86));
        R(3.9, 1.0, 6.2, 1.4, '#8a6a43'); R(4.0, 1.1, 6.0, 1.2, '#2f4a3c'); R(4.0, 1.04, 6.0, .06, '#b8b2a4');
        g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 3; for (let i = 0; i < 14; i++) { g.beginPath(); const x = (4.1 + rnd() * 5.6) * ppm, y = (H - 1.2 - rnd() * 1) * ppm; g.moveTo(x, y); g.quadraticCurveTo(x + 30 * rnd(), y - 12, x + 60 * rnd(), y + 6); g.stroke(); }
        R(6.78, 2.85, .44, .44, '#f4f1ea'); g.fillStyle = '#222'; g.beginPath(); g.arc(7 * ppm, (H - 3.07) * ppm, .17 * ppm, 0, 7); g.fill();
      } else if (side === 1) { for (let i = 0; i < 4; i++) windowRect(g, R, ppm, H, 1.6 + i * 4.2, 1.1, 1.8, 1.4); }
      else { R(2.5, 1.3, 5.5, 1.2, '#b98b57'); for (let i = 0; i < 9; i++) R(2.7 + i * .6, 1.4 + rnd() * .5, .45, .5, ['#ff8a8a', '#ffd36b', '#8ad1ff', '#a5e08a'][i % 4]); R(11.0, .14, .95, 2.1, '#7a5230'); }
    }
  });
}
function floorTex(kind, P) {
  seed = 7;
  return mk(2.5, 2.5, 160, (g, R, ppm) => {
    if (kind === 'house') { for (let i = 0; i < 5; i++) { R(0, i * .5, 2.5, .5, sh(P.c3, .85 + rnd() * .3)); R(0, i * .5, 2.5, .012, 'rgba(0,0,0,.35)'); R((i * .9) % 2.5, i * .5, .012, .5, 'rgba(0,0,0,.3)'); } }
    else { for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) R(i * .5, j * .5, .5, .5, (i + j) % 2 ? P.c3 : sh(P.c3, .86)); }
  }, [RW / 2.5, RD / 2.5]);
}
function ceilTex(kind, P) {
  return mk(RW, RD, 40, (g, R) => { R(0, 0, RW, RD, P.c1); if (kind === 'classroom') for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { R(1.4 + i * 4.4, 1.2 + j * 4.2, 3, .5, '#9a9a94'); R(1.45 + i * 4.4, 1.25 + j * 4.2, 2.9, .4, '#ffffff'); } });
}
function buildRoom(kind, P) {
  seed = 3;
  const grp = new THREE.Group(), geo = new THREE.BoxGeometry(RW, RH, RD), B = t => new THREE.MeshBasicMaterial({map: t, side: THREE.BackSide});
  const wb = wallTex(kind, P, 0), ws1 = wallTex(kind, P, 1), ws2 = kind === 'classroom' ? wallTex(kind, P, 2) : ws1;
  const room = new THREE.Mesh(geo, [B(ws1), B(ws2), B(ceilTex(kind, P)), B(floorTex(kind, P)), B(wb), B(wb)]);
  room.position.set(0, RH / 2, RZ); grp.add(room);
  const L = c => new THREE.MeshLambertMaterial({color: c}), box = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), L(c)); m.position.set(x, y, z); grp.add(m); return m; };
  if (kind === 'house') {
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), L('#a45a4a')); rug.rotation.x = -Math.PI / 2; rug.position.set(0, .012, -3); grp.add(rug);
    box(2.4, .45, .95, 0, .225, -4.8, '#6f7f9a'); box(2.4, .6, .22, 0, .75, -5.2, '#6f7f9a'); box(.22, .6, .95, -1.31, .4, -4.8, '#5f6f8a'); box(.22, .6, .95, 1.31, .4, -4.8, '#5f6f8a');
    box(1.2, .38, .7, 0, .19, -2.9, '#8a5a34'); box(.4, .4, .4, -1.8, .2, -4.6, '#d9a85a');
    box(2.4, 2.2, .35, -6.8, 1.1, -3.5, '#7a5230'); for (let i = 0; i < 12; i++) box(.16, .35, .03, -6.62, .55 + (i % 4) * .5, -4.4 + Math.floor(i / 4) * .8 + rnd() * .05, ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e'][i % 4]);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.22, .17, .4, 12), L('#b0693e')); pot.position.set(5.6, .2, -5); grp.add(pot);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(.45, 12, 10), L('#3f8f4a')); bush.position.set(5.6, .8, -5); grp.add(bush);
  } else {
    box(2.0, .08, .8, -4.5, .78, -5.2, '#a8794a'); box(2.0, .7, .1, -4.5, .4, -5.5, '#8a6a43');
    for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) {
      const x = -3.75 + c * 1.5 + (c > 2 ? .5 : 0), z = -2.6 - r * 1.3;
      box(1.1, .06, .6, x, .72, z, '#d2b48c'); box(.05, .7, .05, x - .5, .35, z - .25, '#666'); box(.05, .7, .05, x + .5, .35, z - .25, '#666'); box(.05, .7, .05, x - .5, .35, z + .25, '#666'); box(.05, .7, .05, x + .5, .35, z + .25, '#666');
      box(.45, .05, .42, x, .44, z + .62, '#3b6ea8'); box(.45, .42, .05, x, .68, z + .82, '#3b6ea8');
    }
  }
  return grp;
}
function disposeGroup(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) for (const m of [].concat(n.material)) { if (m.map) m.map.dispose(); m.dispose(); } }); o.removeFromParent(); }

/* ============================================================
   Bộ máy
   ============================================================ */
export function createEnvEngine(scene, camera, renderer) {
  const C = h => new THREE.Color(h);
  const raw = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')), n = m ? parseInt(m[1], 16) : 0; return new THREE.Vector3((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  const fogC = new THREE.Color(1, 1, 1);

  /* --- bầu trời môi trường --- */
  const U = {uTop: {value: C('#2f7fe0')}, uHor: {value: C('#cfe6ff')}, uBot: {value: C('#7d8f6a')}, uSunC: {value: C('#fff4e0')}, uSunD: {value: new THREE.Vector3(0, 1, 0)}, uT: {value: 0}, uSun: {value: 0}, uStars: {value: 0}, uClouds: {value: 0}, uRays: {value: 0}, uCanopy: {value: 0}, uFogC: {value: new THREE.Color(1, 1, 1)}, uFogK: {value: 0}};
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.ShaderMaterial({uniforms: U, vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: DOME_FS, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false}));
  dome.renderOrder = -1001; dome.frustumCulled = false; dome.visible = false; dome.name = 'env_dome';

  /* --- ảnh 360° --- */
  const PA = {tMap: {value: null}, uFogC: {value: new THREE.Color(1, 1, 1)}, uExp: {value: 1}, uFogK: {value: 0}};
  const pg = new THREE.SphereGeometry(100, 64, 40); pg.scale(-1, 1, 1);
  const panoM = new THREE.Mesh(pg, new THREE.ShaderMaterial({uniforms: PA, vertexShader: 'varying vec2 vUv; varying float vH; void main(){ vUv=uv; vH=normalize(position).y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: PANO_FS, depthTest: false, depthWrite: false, fog: false}));
  panoM.renderOrder = -1001; panoM.frustumCulled = false; panoM.visible = false; panoM.name = 'env_pano';

  /* --- nền phẳng --- */
  const FU = {tMap: {value: null}, uC1: {value: new THREE.Vector3()}, uC2: {value: new THREE.Vector3()}, uFogC: {value: new THREE.Color(1, 1, 1)}, uMode: {value: 0}, uAng: {value: 2.36}, uAsp: {value: 1}, uImgAsp: {value: 1}, uFit: {value: 0}, uZ: {value: 1}, uFogK: {value: 0}, uOff: {value: new THREE.Vector2()}};
  const flatM = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({uniforms: FU, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }', fragmentShader: FLAT_FS, depthTest: false, depthWrite: false, fog: false}));
  flatM.renderOrder = -1001; flatM.frustumCulled = false; flatM.visible = true; flatM.name = 'env_flat';
  scene.add(dome, panoM, flatM);

  /* --- hậu kỳ --- */
  const PU = {tMap: {value: null}, uT: {value: 0}, uAmp: {value: 0}, uType: {value: 0}, uGlow: {value: 0}, uAsp: {value: 1}, uRes: {value: new THREE.Vector2(1, 1)}};
  const postMat = new THREE.ShaderMaterial({uniforms: PU, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }', fragmentShader: POST_FS, depthTest: false, depthWrite: false, blending: THREE.NoBlending});
  const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), pq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat); pq.frustumCulled = false; postScene.add(pq);
  let rt = null; const v2 = new THREE.Vector2();

  const S = {post: false, vid: null, vidT: -1}, L = {h: null, d: null}, cache = new Map(), ibl = {url: '', rt: null, pm: null};
  let room = null, roomKey = '', last = null, dirty = false, vtex = {el: null, tex: null};

  const load = url => {
    let o = cache.get(url); if (o) return o.p;
    o = {tex: null, err: false};
    o.p = new Promise((res, rej) => {
      const ld = new THREE.TextureLoader(); ld.setCrossOrigin('anonymous');
      ld.load(url, t => {
        const mx = renderer.capabilities.maxTextureSize, im = t.image;
        if (im && im.width > mx) { const k = mx / im.width, c = document.createElement('canvas'); c.width = mx; c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); t.image = c; }
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; o.tex = t; dirty = true; res(t);
      }, undefined, e => { o.err = true; rej(e); });
    });
    o.p.catch(() => {}); cache.set(url, o); return o.p;
  };
  const readyTex = url => { if (!url) return null; load(url); const o = cache.get(url); return o && o.tex || null; };
  const restoreLights = () => { if (!L.h) return; L.h.color.copy(L.hc); L.h.groundColor.copy(L.hg); L.h.intensity = L.hi; L.d.color.copy(L.dc); L.d.intensity = L.di; L.d.position.copy(L.dp); };

  const api = {
    setLights(h, d) { L.h = h; L.d = d; L.hc = h.color.clone(); L.hg = h.groundColor.clone(); L.hi = h.intensity; L.dc = d.color.clone(); L.di = d.intensity; L.dp = d.position.clone(); },
    preload(url) { return url ? load(url) : Promise.resolve(); },
    refresh() { dirty = true; },
    /** Cập nhật theo dữ liệu cảnh s tại thời điểm t. ctx = {url, custom, aspect, bg, post}. */
    update(s, t, ctx = {}) {
      last = [s, t, ctx];
      const bg = ctx.bg || {type: 'color', c1: (s && s.bg) || '#171923'};
      const bt = bg.force ? 'flat' : (s.bgt || 'color'), isEnv = bt === 'env';
      const P = envParams(s), tt = t * P.speed;
      const panoTex = bt === 'pano' ? readyTex(ctx.url) : null, pano = !!panoTex, flat = !isEnv && !pano;
      dome.visible = isEnv && !P.room; panoM.visible = pano; flatM.visible = flat;

      /* sương phủ nền: lấy từ scene.fog do fx 'fog' ghi (khoảng cách tham chiếu 40 m) */
      const fg = scene.fog, K = fg && fg.density > 0 ? 1 - Math.exp(-Math.pow(fg.density * 40, 2)) : 0;
      if (fg) fogC.copy(fg.color);

      if (isEnv && P.room) {
        const key = P.room + '|' + P.c1 + '|' + P.c2 + '|' + P.c3;
        if (key !== roomKey) { if (room) disposeGroup(room); room = buildRoom(P.room, P); scene.add(room); roomKey = key; }
      }
      if (room) room.visible = isEnv && !!P.room;

      if (dome.visible) {
        U.uTop.value.set(P.c1); U.uHor.value.set(P.c2); U.uBot.value.set(P.c3); U.uSunC.value.set(P.sc); U.uT.value = tt;
        const el = P.el * DEG, az = P.az * DEG; U.uSunD.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az));
        U.uSun.value = P.sun; U.uStars.value = P.stars; U.uClouds.value = P.clouds; U.uRays.value = P.rays; U.uCanopy.value = P.canopy;
        U.uFogK.value = K; U.uFogC.value.copy(fogC);
      }

      let env = null;
      if (pano) {
        PA.tMap.value = panoTex; PA.uExp.value = P.exp; PA.uFogK.value = K; PA.uFogC.value.copy(fogC);
        panoM.rotation.y = -Math.PI / 2 + P.rot * DEG;
        if (P.ibl) {
          if (ibl.url !== ctx.url) { if (!ibl.pm) ibl.pm = new THREE.PMREMGenerator(renderer); if (ibl.rt) ibl.rt.dispose(); ibl.rt = ibl.pm.fromEquirectangular(panoTex); ibl.url = ctx.url; }
          env = ibl.rt.texture;
        }
      }
      scene.environment = env;

      S.vid = null;
      if (flat) {
        let mode = 0, tex = null, asp = 1;
        if (bg.type === 'grad') mode = 1;
        else if (bg.type === 'img') { tex = readyTex(bg.url); if (tex) { const im = tex.image; asp = (im.naturalWidth || im.width) / Math.max(1, im.naturalHeight || im.height); } }
        else if (bg.type === 'vid' && bg.el && bg.el.readyState >= 2 && bg.el.videoWidth > 0) {
          if (vtex.el !== bg.el) {
            if (vtex.tex) vtex.tex.dispose();
            const vt = new THREE.VideoTexture(bg.el); vt.colorSpace = THREE.SRGBColorSpace;   // VideoTexture: three đọc đúng videoWidth / videoHeight
            vtex = {el: bg.el, tex: vt}; S.vidT = -1;
          }
          tex = vtex.tex; asp = bg.el.videoWidth / Math.max(1, bg.el.videoHeight); S.vid = tex;
        }
        if (tex) mode = 2;
        FU.uMode.value = mode; FU.uC1.value.copy(raw(bg.c1)); FU.uC2.value.copy(raw(bg.c2 || bg.c1)); FU.uAng.value = (bg.ang ?? 135) * DEG;
        FU.tMap.value = tex; FU.uImgAsp.value = asp; FU.uFit.value = bg.fit === 'contain' ? 1 : bg.fit === 'fill' ? 2 : 0;
        FU.uZ.value = (bg.z ?? 100) / 100; FU.uOff.value.set((bg.x || 0) / 100, (bg.y || 0) / 100);
        FU.uFogK.value = K; FU.uFogC.value.copy(fogC);
      }

      /* hậu kỳ: tham số lấy từ khối hiệu ứng (fx-kit) */
      const pp = ctx.post || {amp: 0, type: 0, glow: 0, speed: 1};
      S.post = pp.amp > .001 || pp.glow > .001;
      PU.uT.value = t * (pp.speed || 1); PU.uAmp.value = pp.amp; PU.uGlow.value = pp.glow; PU.uType.value = pp.type || 0; PU.uAsp.value = ctx.aspect || 1;

      if (L.h) {
        if (isEnv && !ctx.custom) {
          L.h.color.set(P.hc); L.h.groundColor.set(P.hg); L.h.intensity = L.hi * P.light * P.hk; L.d.color.set(P.lc); L.d.intensity = L.di * P.light * P.lk;
          if (P.sl && !P.room) L.d.position.copy(U.uSunD.value).multiplyScalar(10); else L.d.position.copy(L.dp);
        } else restoreLights();
      }
    },
    /** Thay cho renderer.render: nền → cảnh → hậu kỳ → lớp phủ màn hình (fxEngine.overlay). */
    render(r, sc, cam, fxe) {
      if (dirty && last) { dirty = false; api.update(...last); }
      dome.position.copy(cam.position); panoM.position.copy(cam.position);
      r.getDrawingBufferSize(v2); FU.uAsp.value = v2.x / Math.max(1, v2.y);
      if (S.vid && vtex.el && vtex.el.currentTime !== S.vidT) { S.vidT = vtex.el.currentTime; S.vid.needsUpdate = true; }
      if (!S.post) r.render(sc, cam);
      else {
        if (!rt) rt = new THREE.WebGLRenderTarget(v2.x, v2.y, {type: THREE.HalfFloatType, samples: 4});
        else if (rt.width !== v2.x || rt.height !== v2.y) rt.setSize(v2.x, v2.y);
        r.setRenderTarget(rt); r.render(sc, cam); r.setRenderTarget(null);
        PU.tMap.value = rt.texture; PU.uRes.value.copy(v2); r.render(postScene, postCam);
      }
      if (fxe && fxe.overlay) fxe.overlay(r);
    },
    dispose() {
      if (room) disposeGroup(room);
      for (const m of [dome, panoM, flatM]) { m.geometry.dispose(); m.material.dispose(); m.removeFromParent(); }
      if (rt) rt.dispose(); if (vtex.tex) vtex.tex.dispose(); if (ibl.rt) ibl.rt.dispose();
      for (const o of cache.values()) if (o.tex) o.tex.dispose();
      scene.environment = null; restoreLights();
    }
  };
  return api;
}
