import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";

const categories=[
{id:"faces",name:"Khuôn mặt",icon:"◉",description:"Hình dạng đầu và khuôn mặt"},
{id:"hair",name:"Tóc",icon:"♧",description:"Tóc mái, tóc trước và tóc sau"},
{id:"eyes",name:"Mắt",icon:"◎",description:"Kiểu mắt và tròng mắt"},
{id:"eyebrows",name:"Lông mày",icon:"⌒",description:"Hình dáng lông mày"},
{id:"noses",name:"Mũi",icon:"⌁",description:"Các kiểu mũi nhân vật"},
{id:"mouths",name:"Miệng",icon:"⌣",description:"Miệng và biểu cảm"},
{id:"body",name:"Cơ thể",icon:"♙",description:"Thân và hình dáng cơ thể"},
{id:"arms",name:"Tay",icon:"↗",description:"Cánh tay và bàn tay"},
{id:"legs",name:"Chân",icon:"↟",description:"Chân và bàn chân"},
{id:"clothes",name:"Trang phục",icon:"◇",description:"Áo, váy và quần áo"},
{id:"accessories",name:"Phụ kiện",icon:"✧",description:"Kính, nơ, mũ và phụ kiện"},
{id:"footwear",name:"Giày dép",icon:"⌑",description:"Giày, bốt và dép"}
];
const items=Object.fromEntries(categories.map(c=>[c.id,[]]));
let activeCategory="eyes";
const selectedItems=Object.fromEntries(categories.map(c=>[c.id,null]));
const loadedModels=Object.fromEntries(categories.map(c=>[c.id,null]));
const loadVersions=Object.fromEntries(categories.map(c=>[c.id,0]));
const $=s=>document.querySelector(s),canvas=$("#character-canvas"),scene=new THREE.Scene();scene.background=new THREE.Color("#e9e5ef");
const camera=new THREE.PerspectiveCamera(35,1,.1,100);camera.position.set(0,1.4,5.6);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,1.15,0);controls.minDistance=2.5;controls.maxDistance=9;
scene.add(new THREE.HemisphereLight(0xffffff,0xc9bddb,2));const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(3,5,4);scene.add(key);const fill=new THREE.DirectionalLight(0xd7c7ff,1.2);fill.position.set(-4,2,-3);scene.add(fill);
const floor=new THREE.Mesh(new THREE.CircleGeometry(2.2,64),new THREE.MeshBasicMaterial({color:0xded8e8}));floor.rotation.x=-Math.PI/2;floor.position.y=-.03;scene.add(floor);
const character=new THREE.Group();scene.add(character);
function mat(color,rough=.75){return new THREE.MeshStandardMaterial({color,roughness:rough});}
function sphere(parent,pos,scale,material){const m=new THREE.Mesh(new THREE.SphereGeometry(1,32,24),material);m.position.set(...pos);m.scale.set(...scale);parent.add(m);return m;}
function makeCharacter(){while(character.children.length)character.remove(character.children[0]);const skin=mat("#f4c9b4"),hair=mat("#55405d"),white=mat("#fffdf9"),iris=mat("#8b70bd"),dark=mat("#382d3d"),pink=mat("#d98e91");
sphere(character,[0,.55,0],[.48,.62,.34],mat("#d9b4d1"));
sphere(character,[0,1.55,0],[.66,.72,.57],skin);
sphere(character,[0,1.93,-.02],[.68,.43,.58],hair);
sphere(character,[-.34,1.55,.37],[.13,.25,.12],hair);sphere(character,[.34,1.55,.37],[.13,.25,.12],hair);
for(const x of [-.23,.23]){sphere(character,[x,1.62,.505],[.105,.14,.055],white);sphere(character,[x,1.62,.552],[.052,.085,.025],iris);sphere(character,[x,1.62,.574],[.022,.05,.012],dark);sphere(character,[x-.025,1.68,.584],[.018,.018,.01],white);}
sphere(character,[0,1.43,.555],[.055,.065,.05],pink);
const smile=new THREE.Mesh(new THREE.TorusGeometry(.105,.018,8,24,Math.PI),pink);smile.position.set(0,1.31,.55);smile.rotation.z=Math.PI;character.add(smile);
for(const x of [-.72,.72]){sphere(character,[x,.61,0],[.24,.5,.25],mat("#d9b4d1"));}
sphere(character,[-.22,-.05,0],[.19,.42,.2],mat("#f4c9b4"));sphere(character,[.22,-.05,0],[.19,.42,.2],mat("#f4c9b4"));
}
makeCharacter();
const resize=()=>{const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);};new ResizeObserver(resize).observe(canvas);resize();
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}animate();$("#loading").style.display="none";
function renderTabs(){const nav=$("#category-tabs");nav.innerHTML="";categories.forEach(c=>{const b=document.createElement("button");b.className="category-tab"+(c.id===activeCategory?" active":"");b.innerHTML='<span class="tab-icon"></span>';b.querySelector(".tab-icon").textContent=c.icon;b.append(document.createTextNode(c.name));b.onclick=()=>selectCategory(c.id);nav.append(b);});}
function renderItems(){const c=categories.find(x=>x.id===activeCategory),grid=$("#item-grid"),q=$("#item-search").value.trim().toLowerCase();$("#active-category-title").textContent=c.name;$("#category-description").textContent=c.description;const filtered=items[activeCategory].filter(i=>i.name.toLowerCase().includes(q));grid.innerHTML="";filtered.forEach(item=>{const b=document.createElement("button");b.className="item-card"+(item===selectedItems[activeCategory]?" active":"");const preview=document.createElement("div");preview.className="item-preview";preview.textContent="◇";const name=document.createElement("span");name.className="item-name";name.textContent=item.name;const kind=document.createElement("span");kind.className="item-kind";kind.textContent="GLB MODEL";b.append(preview,name,kind);b.onclick=()=>loadItem(item);grid.append(b);});$("#empty-hint").classList.toggle("show",filtered.length===0);$("#item-total").textContent=items[activeCategory].length+" item";$("#item-count").textContent=categories.reduce((n,c)=>n+items[c.id].length,0)+" item đã thêm";}
function selectCategory(id){activeCategory=id;renderTabs();renderItems();}
function loadItem(item){
 const categoryId=activeCategory;
 selectedItems[categoryId]=item;
 const version=++loadVersions[categoryId];
 const loader=new GLTFLoader();
 loader.load(item.url,gltf=>{
  if(version!==loadVersions[categoryId])return;
  const model=gltf.scene;
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const maxDimension=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(maxDimension)||maxDimension<=0){toast("Mô hình GLB không có kích thước hợp lệ.");return;}
  const scale=1.8/maxDimension;
  model.scale.setScalar(scale);
  model.position.set(-center.x*scale,1.15-center.y*scale,-center.z*scale);
  const previous=loadedModels[categoryId];
  if(previous)character.remove(previous);
  loadedModels[categoryId]=model;
  character.add(model);
  renderItems();
  toast("Đã cập nhật "+categories.find(c=>c.id===categoryId).name+": "+item.name);
 },undefined,error=>{console.error(error);if(version===loadVersions[categoryId])toast("Không thể mở mô hình GLB này.");});
}
$("#add-item").onclick=()=>$("#file-input").click();
$("#file-input").onchange=e=>{const file=e.target.files[0];if(!file)return;if(!file.name.toLowerCase().endsWith(".glb")){toast("Vui lòng chọn tệp .glb");e.target.value="";return;}const item={name:file.name.replace(/\.glb$/i,""),url:URL.createObjectURL(file),file};items[activeCategory].push(item);renderItems();loadItem(item);toast("Đã thêm item vào danh mục "+categories.find(c=>c.id===activeCategory).name+" (phiên hiện tại)");e.target.value="";};
$("#item-search").oninput=renderItems;
$("#reset-character").onclick=()=>{categories.forEach(c=>{loadVersions[c.id]++;if(loadedModels[c.id]){character.remove(loadedModels[c.id]);loadedModels[c.id]=null;}selectedItems[c.id]=null;});makeCharacter();renderItems();camera.position.set(0,1.4,5.6);controls.target.set(0,1.15,0);controls.update();toast("Đã đặt lại nhân vật xem trước.");};
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2400);}
renderTabs();renderItems();