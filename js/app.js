import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/exporters/GLTFExporter.js";
import {setGitHubToken,hasGitHubToken,verifyToken,putText,putBinary,readJson,listCharacterProfiles} from "./github-sync.js";

const categories=[
{id:"faces",name:"Khuôn mặt",icon:"◉",description:"Hình dạng đầu và khuôn mặt"},
{id:"hair",name:"Tóc",icon:"♧",description:"Tóc mái, tóc trước và tóc sau"},
{id:"eyes",name:"Mắt đôi",icon:"◎",description:"Mô hình gồm cả hai mắt"},
{id:"extra-eyes-1",name:"Mắt bổ sung 1",icon:"◉",description:"Một mắt độc lập, có vị trí riêng"},
{id:"extra-eyes-2",name:"Mắt bổ sung 2",icon:"◉",description:"Một mắt độc lập, có vị trí riêng"},
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
let activeCharacterId="character-1"; // Each item keeps independent XYZ offsets for each character.
const characters=[{id:activeCharacterId,name:"Nhân vật 1",parts:{},thumbnail:null}];
let activeCharacter=characters[0];
const selectedItems=Object.fromEntries(categories.map(c=>[c.id,null]));
const loadedModels=Object.fromEntries(categories.map(c=>[c.id,null]));
const loadVersions=Object.fromEntries(categories.map(c=>[c.id,0]));
const $=s=>document.querySelector(s),canvas=$("#character-canvas"),scene=new THREE.Scene();scene.background=new THREE.Color("#e9e5ef");
const camera=new THREE.PerspectiveCamera(35,1,.1,100);camera.position.set(0,1.4,5.6);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,1.15,0);controls.minDistance=2.5;controls.maxDistance=9;
scene.add(new THREE.HemisphereLight(0xffffff,0xc9bddb,2));const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(3,5,4);scene.add(key);const fill=new THREE.DirectionalLight(0xd7c7ff,1.2);fill.position.set(-4,2,-3);scene.add(fill);
const floor=new THREE.Mesh(new THREE.CircleGeometry(2.2,64),new THREE.MeshBasicMaterial({color:0xded8e8}));floor.rotation.x=-Math.PI/2;floor.position.y=-.03;scene.add(floor);
const character=new THREE.Group();scene.add(character);
function alignCharacterToGround(){
 // Calculate from a neutral root position so repeated calls never accumulate offsets.
 const previousY=character.position.y;
 character.position.y=0;
 character.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(character);
 if(bounds.isEmpty()){character.position.y=previousY;return;}
 const targetY=floor.position.y-bounds.min.y;
 character.position.y=Number.isFinite(targetY)?targetY:previousY;
 character.updateMatrixWorld(true);
}
alignCharacterToGround();
const resize=()=>{const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);};new ResizeObserver(resize).observe(canvas);resize();
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}animate();$("#loading").style.display="none";
function renderTabs(){const nav=$("#category-tabs");nav.innerHTML="";categories.forEach(c=>{const b=document.createElement("button");b.className="category-tab"+(c.id===activeCategory?" active":"");b.innerHTML='<span class="tab-icon"></span>';b.querySelector(".tab-icon").textContent=c.icon;b.append(document.createTextNode(c.name));b.onclick=()=>selectCategory(c.id);nav.append(b);});}
function renderItems(){const c=categories.find(x=>x.id===activeCategory),grid=$("#item-grid"),q=$("#item-search").value.trim().toLowerCase();$("#active-category-title").textContent=c.name;$("#category-description").textContent=c.description;const filtered=items[activeCategory].filter(i=>(i.name+" "+i.id).toLowerCase().includes(q));grid.innerHTML="";filtered.forEach(item=>{const b=document.createElement("button");b.className="item-card"+(item===selectedItems[activeCategory]?" active":"")+(item.isNone?" item-card-none":"");const preview=document.createElement("div");preview.className="item-preview";if(item.thumbnail){const img=document.createElement("img");img.src=new URL(item.thumbnail,document.baseURI).href;img.alt="Thumbnail "+item.name;preview.append(img);}else preview.textContent=item.isNone?"⊘":"◇";const name=document.createElement("span");name.className="item-name";name.textContent=item.name;const kind=document.createElement("span");kind.className="item-kind";kind.textContent=item.isNone?"TÙY CHỌN · "+item.id:"GLB MODEL · "+item.id;b.append(preview,name,kind);b.onclick=()=>loadItem(item);grid.append(b);});$("#empty-hint").classList.toggle("show",filtered.length===0);$("#item-total").textContent=items[activeCategory].length+" item";$("#item-count").textContent=categories.reduce((n,c)=>n+items[c.id].length,0)+" item đã thêm";renderTransformPanel();}
function selectCategory(id){activeCategory=id;renderTabs();renderItems();}
function saveActiveCharacterParts(){
 if(!activeCharacter)return;
 categories.forEach(c=>{activeCharacter.parts[c.id]=selectedItems[c.id]||null;});
}
function clearActiveCharacterModels(){
 categories.forEach(c=>{
  loadVersions[c.id]++;
  if(loadedModels[c.id])character.remove(loadedModels[c.id]);
  loadedModels[c.id]=null;selectedItems[c.id]=null;
 });
}
function captureCharacterThumbnail(){
 try{renderer.render(scene,camera);activeCharacter.thumbnail=renderer.domElement.toDataURL("image/jpeg",.72);}catch(error){console.warn("Không tạo được thumbnail",error);}
}
function renderCharacterList(){
 const list=$("#character-list");list.innerHTML="";
 characters.forEach(record=>{
  const card=document.createElement("div");card.className="character-card"+(record.id===activeCharacterId?" active":"");
  const select=document.createElement("button");select.type="button";select.className="character-select";select.style.cssText="display:block;width:100%;padding:0;border:0;background:transparent;text-align:left;cursor:pointer";
  const thumb=document.createElement("div");thumb.className="character-thumb";
  if(record.thumbnail){const img=document.createElement("img");img.src=record.thumbnail;img.alt="Ảnh thu nhỏ "+record.name;thumb.append(img);}else thumb.textContent="✧";
  const name=document.createElement("span");name.className="character-card-name";name.textContent=record.name;
  const id=document.createElement("span");id.className="character-card-id";id.textContent=record.id;
  select.append(thumb,name,id);select.onclick=()=>activateCharacter(record.id);
  const actions=document.createElement("div");actions.className="character-card-actions";
  const rename=document.createElement("button");rename.type="button";rename.className="character-rename";rename.textContent="Đổi tên";rename.onclick=()=>renameCharacter(record.id);
  actions.append(rename);card.append(select,actions);list.append(card);
 });
}
let nameDialogCallback=null;
function showNameDialog(title,defaultValue,onSave){
 const modal=$("#name-dialog"),input=$("#name-dialog-input");
 $("#name-dialog-title").textContent=title;input.value=defaultValue||"";nameDialogCallback=onSave;modal.hidden=false;
 requestAnimationFrame(()=>{input.focus();input.select();});
}
function closeNameDialog(){$("#name-dialog").hidden=true;nameDialogCallback=null;}
$("#name-dialog-cancel").onclick=closeNameDialog;
$("#name-dialog").addEventListener("click",e=>{if(e.target.id==="name-dialog")closeNameDialog();});
$("#name-dialog-form").addEventListener("submit",e=>{e.preventDefault();const value=$("#name-dialog-input").value.trim();if(!value){toast("Tên nhân vật không được để trống.");return;}const cb=nameDialogCallback;closeNameDialog();if(cb)cb(value);});

try{const savedToken=localStorage.getItem("3d-character-studio-github-token");if(savedToken)setGitHubToken(savedToken);}catch(error){console.warn("Không đọc được GitHub token từ Local Storage",error);}
$("#open-settings").onclick=()=>{$("#settings-dialog").hidden=false;$("#github-token").value="";$("#github-status").textContent=hasGitHubToken()?"Đã lưu token trên thiết bị này.":"Chưa kết nối GitHub.";};
$("#close-settings").onclick=()=>{$("#settings-dialog").hidden=true;};
$("#settings-dialog").addEventListener("click",e=>{if(e.target.id==="settings-dialog")$("#settings-dialog").hidden=true;});
$("#save-github").onclick=()=>{const value=$("#github-token").value.trim();if(!value){toast("Hãy nhập GitHub Token.");return;}setGitHubToken(value);try{localStorage.setItem("3d-character-studio-github-token",value);}catch(error){toast("Trình duyệt không cho phép lưu Local Storage.");return;}$("#github-token").value="";$("#github-status").textContent="Token đã được lưu trên thiết bị này.";toast("Đã lưu GitHub Token trên thiết bị.");};
$("#test-github").onclick=async()=>{const value=$("#github-token").value.trim();if(value)setGitHubToken(value);const status=$("#github-status");status.textContent="Đang kiểm tra...";try{status.textContent="Kết nối thành công: "+await verifyToken();toast("GitHub đã kết nối.");}catch(error){status.textContent="Lỗi: "+error.message;toast("Không kết nối được GitHub.");}};


$("#load-github-characters").onclick=async()=>{const status=$("#github-status");status.textContent="Đang tải hồ sơ...";try{await loadManifestAssets();const profiles=await listCharacterProfiles();if(!profiles.length){status.textContent="Chưa có hồ sơ trên GitHub.";return;}characters.splice(0,characters.length,...profiles.map(p=>{for(const category of categories){for(const asset of items[category.id]){const position=p.positions?.[asset.id];if(position){asset.positionByCharacter=asset.positionByCharacter||{};asset.positionByCharacter[p.id]=position;}const scale=p.scales?.[asset.id];if(scale){asset.scaleByCharacter=asset.scaleByCharacter||{};asset.scaleByCharacter[p.id]=scale;}const rotation=p.rotations?.[asset.id];if(rotation){asset.rotationByCharacter=asset.rotationByCharacter||{};asset.rotationByCharacter[p.id]=rotation;}const color=p.colors?.[asset.id];if(color){asset.colorByCharacter=asset.colorByCharacter||{};asset.colorByCharacter[p.id]=color;}}}return{id:p.id,name:p.name,parts:Object.fromEntries(categories.map(c=>[c.id,items[c.id].find(a=>a.id===p.parts?.[c.id])||null])),thumbnail:p.thumbnail||null};}));activeCharacter=characters[0];activeCharacterId=activeCharacter.id;clearActiveCharacterModels();alignCharacterToGround();categories.forEach(c=>{const asset=activeCharacter.parts[c.id];if(asset)loadItem(asset,c.id);});renderCharacterList();renderItems();status.textContent="Đã tải "+profiles.length+" hồ sơ từ GitHub.";toast("Đã tải hồ sơ nhân vật.");}catch(error){status.textContent="Lỗi tải hồ sơ: "+error.message;}};

function updateGitHubProgress(percent,title,detail,count=""){
 const panel=$("#github-save-progress");if(!panel)return;
 panel.hidden=false;$("#github-progress-title").textContent=title;
 $("#github-progress-percent").textContent=Math.round(percent)+"%";
 $("#github-progress-fill").style.width=Math.max(0,Math.min(100,percent))+"%";
 $("#github-progress-detail").textContent=detail;$("#github-progress-count").textContent=count;
}
async function saveCharacterProfiles(){
 if(!hasGitHubToken()){toast("Hãy kết nối GitHub Token trong Settings trước khi lưu.");return;}
 saveActiveCharacterParts();captureCharacterThumbnail();
 const button=$("#save-characters");if(button){button.disabled=true;button.textContent="Đang lưu GitHub...";}
 const panel=$("#github-save-progress");if(panel)panel.hidden=false;
 try{
  updateGitHubProgress(2,"Đang chuẩn bị lưu lên GitHub","Đang đọc thư viện tài nguyên...");
  const manifest=await readJson("data/asset-manifest.json");manifest.data.assets=manifest.data.assets||[];
  const pending=[];
  for(const category of categories)for(const item of items[category.id]){if(item.path&&manifest.data.assets.some(a=>a.id===item.id))continue;if(item.file)pending.push({category,item});}
  const total=pending.length+1+characters.length;let completed=0;
  for(const entry of pending){
   const category=entry.category,item=entry.item,path="assets/"+category.id+"/"+item.id+".glb";
   updateGitHubProgress(5+75*(completed/Math.max(total,1)),"Đang upload mô hình GLB",item.name,(completed+1)+"/"+total+" tác vụ");
   await putBinary(path,item.file,"Upload asset "+item.name);
   manifest.data.assets=manifest.data.assets.filter(a=>a.id!==item.id);manifest.data.assets.push({id:item.id,name:item.name,category:category.id,path,format:"glb",size:item.file.size});
   item.path=path;item.url="https://raw.githubusercontent.com/nhothicam02-code/3d-animation-studio/main/"+path;completed++;
   updateGitHubProgress(5+75*(completed/Math.max(total,1)),"Đang upload mô hình GLB","Đã tải: "+item.name,completed+"/"+total+" tác vụ");
  }
  updateGitHubProgress(82,"Đang cập nhật thư viện","Đang lưu asset-manifest.json",(completed+1)+"/"+total+" tác vụ");
  await putText("data/asset-manifest.json",JSON.stringify(manifest.data,null,2),"Update uploaded asset library");completed++;
  for(const record of characters){
   const profile={schemaVersion:1,id:record.id,name:record.name,thumbnail:record.thumbnail||null,parts:Object.fromEntries(categories.map(c=>[c.id,record.parts?.[c.id]?.id||null])),positions:Object.fromEntries(categories.flatMap(c=>items[c.id].map(item=>[item.id,item.positionByCharacter?.[record.id]||{x:0,y:0,z:0}]))),scales:Object.fromEntries(categories.flatMap(c=>items[c.id].map(item=>[item.id,item.scaleByCharacter?.[record.id]||{x:1,y:1,z:1}]))),rotations:Object.fromEntries(categories.flatMap(c=>items[c.id].map(item=>[item.id,item.rotationByCharacter?.[record.id]||{x:0,y:0,z:0}]))),colors:Object.fromEntries(categories.flatMap(c=>items[c.id].map(item=>[item.id,item.colorByCharacter?.[record.id]||null]))),updatedAt:new Date().toISOString()};
   updateGitHubProgress(82+18*(completed/Math.max(total,1)),"Đang lưu hồ sơ nhân vật",record.name,(completed+1)+"/"+total+" tác vụ");
   await putText("characters/"+record.id+".json",JSON.stringify(profile,null,2),"Save character "+record.name);completed++;
  }
  const data={version:1,savedAt:new Date().toISOString(),activeCharacterId,characters:characters.map(record=>({id:record.id,name:record.name,thumbnail:record.thumbnail,parts:Object.fromEntries(categories.map(c=>[c.id,record.parts?.[c.id]?.id||null])),positions:Object.fromEntries(categories.flatMap(c=>items[c.id].map(item=>[item.id,item.positionByCharacter||{}]))),scales:Object.fromEntries(categories.flatMap(c=>items[c.id].map(item=>[item.id,item.scaleByCharacter||{}]))),rotations:Object.fromEntries(categories.flatMap(c=>items[c.id].map(item=>[item.id,item.rotationByCharacter||{}]))),colors:Object.fromEntries(categories.flatMap(c=>items[c.id].map(item=>[item.id,item.colorByCharacter||{}])))}))};
  localStorage.setItem("character-studio-profiles",JSON.stringify(data));
  updateGitHubProgress(100,"Đã lưu thành công","Toàn bộ mô hình và hồ sơ đã được đồng bộ lên GitHub",completed+"/"+total+" tác vụ");
  toast("Đã lưu nhân vật và toàn bộ item lên GitHub thành công.");
 }catch(error){console.error("GitHub save failed",error);updateGitHubProgress(0,"Lưu GitHub thất bại",error.message,"Có thể thử lại");toast("Lưu GitHub thất bại: "+error.message);}
 finally{if(button){button.disabled=false;button.textContent="↓ Lưu nhân vật";}}
}

$("#save-characters").onclick=saveCharacterProfiles;
function safeFileName(name){
 return String(name||"character").normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"")||"character";
}
async function exportCharacterGLB(){
 const button=$("#export-character");
 if(!character.children.length){toast("Nhân vật hiện chưa có mô hình để xuất.");return;}
 button.disabled=true;button.textContent="Đang xuất...";
 try{
  character.updateMatrixWorld(true);
  const exporter=new GLTFExporter();
  const result=await exporter.parseAsync(character,{
   binary:true,
   onlyVisible:true,
   trs:false,
   maxTextureSize:4096
  });
  const blob=new Blob([result],{type:"model/gltf-binary"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=safeFileName(activeCharacter?.name)+".glb";
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast("Đã xuất mô hình "+link.download+" thành công.");
 }catch(error){
  console.error("GLB export failed",error);
  toast("Xuất GLB thất bại: "+(error?.message||"Lỗi không xác định"));
 }finally{
  button.disabled=false;button.textContent="⬇ Xuất mô hình 3D";
 }
}
$("#export-character").onclick=exportCharacterGLB;
function renameCharacter(id){
 const record=characters.find(c=>c.id===id);if(!record)return;
 showNameDialog("Đổi tên nhân vật",record.name,clean=>{record.name=clean;renderCharacterList();if(record.id===activeCharacterId)toast("Đã đổi tên nhân vật.");});
}
function activateCharacter(id){
 const target=characters.find(c=>c.id===id);if(!target)return;
 if(activeCharacter&&activeCharacterId!==id){saveActiveCharacterParts();captureCharacterThumbnail();}
 clearActiveCharacterModels();
 activeCharacter=target;activeCharacterId=target.id;
 alignCharacterToGround();
 categories.forEach(c=>{
  const item=activeCharacter.parts?.[c.id];
  if(item)loadItem(item,c.id);
 });
 renderCharacterList();renderItems();
}
$("#add-character").onclick=()=>{
 const proposed="Nhân vật "+(characters.length+1);
 showNameDialog("Tạo nhân vật mới",proposed,clean=>{
 saveActiveCharacterParts();captureCharacterThumbnail();clearActiveCharacterModels();
 const record={id:"char-"+crypto.randomUUID(),name:clean,parts:{},thumbnail:null};
 characters.push(record);activeCharacter=record;activeCharacterId=record.id;
 alignCharacterToGround();renderCharacterList();renderItems();toast("Đã tạo "+clean);
});
};
function getItemPosition(item,characterId=activeCharacterId){
 if(!item.positionByCharacter)item.positionByCharacter={};
 if(!item.positionByCharacter[characterId])item.positionByCharacter[characterId]={x:0,y:0,z:0};
 return item.positionByCharacter[characterId];
}
function getItemScale(item,characterId=activeCharacterId){
 if(!item.scaleByCharacter)item.scaleByCharacter={};
 if(!item.scaleByCharacter[characterId])item.scaleByCharacter[characterId]={x:1,y:1,z:1};
 return item.scaleByCharacter[characterId];
}
function getItemRotation(item,characterId=activeCharacterId){
 if(!item.rotationByCharacter)item.rotationByCharacter={};
 if(!item.rotationByCharacter[characterId])item.rotationByCharacter[characterId]={x:0,y:0,z:0};
 return item.rotationByCharacter[characterId];
}
function getItemColor(item,characterId=activeCharacterId){
 if(!item.colorByCharacter)item.colorByCharacter={};
 return item.colorByCharacter[characterId]||null;
}
function applyItemPosition(item,categoryId=activeCategory){
 const model=loadedModels[categoryId];if(!model||selectedItems[categoryId]!==item)return;
 const offset=getItemPosition(item),base=model.userData.basePosition;
 model.position.set(base.x+offset.x,base.y+offset.y,base.z+offset.z);
}
function applyItemScale(item,categoryId=activeCategory){
 const model=loadedModels[categoryId];if(!model||selectedItems[categoryId]!==item)return;
 const scale=getItemScale(item);
 model.scale.set(model.userData.baseScale.x*scale.x,model.userData.baseScale.y*scale.y,model.userData.baseScale.z*scale.z);
}
function applyItemRotation(item,categoryId=activeCategory){
 const model=loadedModels[categoryId];if(!model||selectedItems[categoryId]!==item)return;
 const rotation=getItemRotation(item);
 model.rotation.set(THREE.MathUtils.degToRad(rotation.x),THREE.MathUtils.degToRad(rotation.y),THREE.MathUtils.degToRad(rotation.z),"XYZ");
}
function applyItemColor(item,categoryId=activeCategory){
 const model=loadedModels[categoryId];if(!model||selectedItems[categoryId]!==item)return;
 const color=getItemColor(item);
 model.traverse(child=>{
  if(!child.isMesh||!child.material)return;
  const mats=Array.isArray(child.material)?child.material:[child.material];
  mats.forEach((mat,index)=>{
   const original=child.userData.originalColors?.[index];
   if(mat.color){if(color)mat.color.set(color);else if(original)mat.color.copy(original);}
  });
 });
}
function renderTransformPanel(){
 const panel=$("#transform-panel"),item=selectedItems[activeCategory];
 panel.hidden=!item||item.isNone;if(!item||item.isNone)return;
 $("#transform-item-name").textContent=item.name;
 const pos=getItemPosition(item),scale=getItemScale(item),rotation=getItemRotation(item),color=getItemColor(item)||"#ffffff";
 ["x","y","z"].forEach(axis=>{$("#position-"+axis).value=pos[axis];$("#position-"+axis+"-value").textContent=Number(pos[axis]).toFixed(2);$("#scale-"+axis).value=scale[axis];$("#scale-"+axis+"-value").textContent=Number(scale[axis]).toFixed(2)+"×";$("#rotation-"+axis).value=rotation[axis];$("#rotation-"+axis+"-value").textContent=Number(rotation[axis])+"°";});
 $("#item-color").value=color;$("#item-color-hex").value=color.toUpperCase();
}
function updateItemAxis(axis,value){
 const item=selectedItems[activeCategory];if(!item)return;
 const n=Number(value);getItemPosition(item)[axis]=n;
 $("#position-"+axis+"-value").textContent=n.toFixed(2);applyItemPosition(item);
}
function updateItemScale(axis,value){
 const item=selectedItems[activeCategory];if(!item)return;
 const n=Number(value),scale=getItemScale(item);
 if($("#scale-uniform").checked){["x","y","z"].forEach(a=>{scale[a]=n;$("#scale-"+a).value=n;$("#scale-"+a+"-value").textContent=n.toFixed(2)+"×";});}
 else{scale[axis]=n;$("#scale-"+axis+"-value").textContent=n.toFixed(2)+"×";}
 applyItemScale(item);
}
function updateItemRotation(axis,value){
 const item=selectedItems[activeCategory];if(!item)return;
 const n=Number(value);getItemRotation(item)[axis]=n;
 $("#rotation-"+axis+"-value").textContent=n+"°";applyItemRotation(item);
}
function updateItemColor(value){
 const item=selectedItems[activeCategory];if(!item||!/^#[0-9a-fA-F]{6}$/.test(value))return;
 item.colorByCharacter=item.colorByCharacter||{};item.colorByCharacter[activeCharacterId]=value.toLowerCase();
 $("#item-color").value=value;$("#item-color-hex").value=value.toUpperCase();applyItemColor(item);
}
["x","y","z"].forEach(axis=>$("#position-"+axis).addEventListener("input",e=>updateItemAxis(axis,e.target.value)));
["x","y","z"].forEach(axis=>$("#scale-"+axis).addEventListener("input",e=>updateItemScale(axis,e.target.value)));
["x","y","z"].forEach(axis=>$("#rotation-"+axis).addEventListener("input",e=>updateItemRotation(axis,e.target.value)));
$("#item-color").addEventListener("input",e=>updateItemColor(e.target.value));
$("#item-color-hex").addEventListener("change",e=>{const value=e.target.value.trim();if(/^#[0-9a-fA-F]{6}$/.test(value))updateItemColor(value);else{toast("Mã màu HEX không hợp lệ.");renderTransformPanel();}});
$("#reset-item-position").onclick=()=>{
 const item=selectedItems[activeCategory];if(!item)return;
 item.positionByCharacter[activeCharacterId]={x:0,y:0,z:0};
 item.scaleByCharacter=item.scaleByCharacter||{};item.scaleByCharacter[activeCharacterId]={x:1,y:1,z:1};
 item.rotationByCharacter=item.rotationByCharacter||{};item.rotationByCharacter[activeCharacterId]={x:0,y:0,z:0};
 item.colorByCharacter=item.colorByCharacter||{};delete item.colorByCharacter[activeCharacterId];
 applyItemPosition(item);applyItemScale(item);applyItemRotation(item);applyItemColor(item);renderTransformPanel();
};
function loadItem(item,categoryOverride=activeCategory){
 const categoryId=categoryOverride;selectedItems[categoryId]=item;const version=++loadVersions[categoryId];
 if(item.isNone||item.id==="none-"+categoryId){if(loadedModels[categoryId])character.remove(loadedModels[categoryId]);loadedModels[categoryId]=null;if(activeCharacter)activeCharacter.parts[categoryId]=item;renderItems();alignCharacterToGround();captureCharacterThumbnail();renderCharacterList();toast("Đã bỏ qua danh mục "+categories.find(c=>c.id===categoryId).name+".");return;}
 renderItems();
 new GLTFLoader().load(item.url,gltf=>{
  if(version!==loadVersions[categoryId])return;
  const model=gltf.scene,box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),maxDimension=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(maxDimension)||maxDimension<=0){toast("Mô hình GLB không có kích thước hợp lệ.");return;}
  const targetSizes={faces:1.45,hair:1.55,eyes:.48,"extra-eyes-1":.34,"extra-eyes-2":.34,eyebrows:.34,noses:.16,mouths:.30,body:1.35,arms:.82,legs:.72,clothes:1.28,accessories:.48,footwear:.48};const targetSize=targetSizes[categoryId]||1.0;const scale=targetSize/maxDimension;model.scale.setScalar(scale);
  model.position.set(-center.x*scale,1.15-center.y*scale,-center.z*scale);
  model.userData.basePosition=model.position.clone();
  model.userData.baseScale=model.scale.clone();
  model.traverse(child=>{if(child.isMesh&&child.material){const mats=Array.isArray(child.material)?child.material:[child.material];child.material=mats.length>1?mats.map(m=>m.clone()):mats[0].clone();child.userData.originalColors=(Array.isArray(child.material)?child.material:[child.material]).map(m=>m.color?m.color.clone():null);}});
  const offset=getItemPosition(item);model.position.add(new THREE.Vector3(offset.x,offset.y,offset.z));
  const savedScale=getItemScale(item);model.scale.set(model.userData.baseScale.x*savedScale.x,model.userData.baseScale.y*savedScale.y,model.userData.baseScale.z*savedScale.z);
  const savedRotation=getItemRotation(item);model.rotation.set(THREE.MathUtils.degToRad(savedRotation.x),THREE.MathUtils.degToRad(savedRotation.y),THREE.MathUtils.degToRad(savedRotation.z),"XYZ");
  const savedColor=getItemColor(item);if(savedColor){model.traverse(child=>{if(child.isMesh&&child.material){const mats=Array.isArray(child.material)?child.material:[child.material];mats.forEach(m=>{if(m.color)m.color.set(savedColor);});}});}
  if(loadedModels[categoryId])character.remove(loadedModels[categoryId]);
  loadedModels[categoryId]=model;character.add(model);alignCharacterToGround();renderItems();captureCharacterThumbnail();renderCharacterList();
  toast("Đã cập nhật "+categories.find(c=>c.id===categoryId).name+": "+item.name);
 },undefined,error=>{console.error(error);if(version===loadVersions[categoryId])toast("Không thể mở mô hình GLB này.");});
}
const LOCAL_ASSET_DB="3d-character-studio-assets";
function openLocalAssetDB(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(LOCAL_ASSET_DB,1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("assets"))db.createObjectStore("assets",{keyPath:"id"});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function storeLocalAsset(record){
 const db=await openLocalAssetDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction("assets","readwrite");tx.objectStore("assets").put(record);
  tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};
 });
}
async function readLocalAssets(){
 const db=await openLocalAssetDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction("assets","readonly"),request=tx.objectStore("assets").getAll();
  request.onsuccess=()=>{db.close();resolve(request.result||[]);};request.onerror=()=>{db.close();reject(request.error);};
 });
}
$("#add-item").onclick=()=>$("#file-input").click();
$("#file-input").onchange=async e=>{
 const file=e.target.files[0];if(!file)return;
 if(!file.name.toLowerCase().endsWith(".glb")){toast("Vui lòng chọn tệp .glb");e.target.value="";return;}
 const categoryId=activeCategory,id="asset-"+crypto.randomUUID(),name=file.name.replace(/\\.glb$/i,"");
 const item={id,name,url:URL.createObjectURL(file),file,positionByCharacter:{}};
 items[categoryId].push(item);renderItems();loadItem(item);
 try{await storeLocalAsset({id,name,category:categoryId,blob:file,size:file.size,updatedAt:new Date().toISOString()});toast("Đã lưu item trên thiết bị; có thể khôi phục sau khi tải lại trang.");}
 catch(error){console.error("IndexedDB save failed",error);toast("Không lưu được file trên thiết bị: "+error.message);}
 if(hasGitHubToken()){
  try{
   const path="assets/"+categoryId+"/"+id+".glb";await putBinary(path,file,"Add asset "+name);
   const manifest=await readJson("data/asset-manifest.json");
   manifest.data.assets=(manifest.data.assets||[]).filter(a=>a.id!==id);
   manifest.data.assets.push({id,name,category:categoryId,path,format:"glb",size:file.size});
   await putText("data/asset-manifest.json",JSON.stringify(manifest.data,null,2),"Update asset manifest");
   item.url="https://raw.githubusercontent.com/nhothicam02-code/3d-animation-studio/main/"+path;item.path=path;
   toast("Đã đồng bộ GLB lên GitHub.");
  }catch(error){toast("Đã lưu trên thiết bị nhưng GitHub lỗi: "+error.message);}
 }
 e.target.value="";
};
$("#item-search").oninput=renderItems;
$("#reset-character").onclick=()=>{clearActiveCharacterModels();activeCharacter.parts={};alignCharacterToGround();renderItems();captureCharacterThumbnail();renderCharacterList();camera.position.set(0,1.4,5.6);controls.target.set(0,1.15,0);controls.update();toast("Đã đặt lại nhân vật đang chọn.");};
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2400);}
function restoreCharacterProfiles(){
 try{
  const raw=localStorage.getItem("character-studio-profiles");if(!raw)return;
  const data=JSON.parse(raw);if(!Array.isArray(data.characters)||!data.characters.length)return;
  characters.splice(0,characters.length,...data.characters.map(record=>({id:String(record.id),name:String(record.name||"Nhân vật"),parts:{},thumbnail:record.thumbnail||null})));
  activeCharacterId=characters.some(c=>c.id===data.activeCharacterId)?data.activeCharacterId:characters[0].id;
  activeCharacter=characters.find(c=>c.id===activeCharacterId)||characters[0];
 }catch(error){console.warn("Không thể khôi phục hồ sơ nhân vật",error);}
}
async function loadManifestAssets(){
 try{
  const response=await fetch("./data/asset-manifest.json",{cache:"no-store"});if(!response.ok)throw new Error("HTTP "+response.status);
  const manifest=await response.json();
  for(const asset of (manifest.assets||[])){
   if(!asset.id||!asset.category||!items[asset.category])continue;
   if(items[asset.category].some(item=>item.id===asset.id))continue;
   const path=asset.path||("assets/"+asset.category+"/"+asset.id+".glb");
   items[asset.category].push({id:asset.id,name:asset.name||asset.id,path,url:new URL(path,document.baseURI).href,thumbnail:asset.thumbnail||null,isNone:asset.id==="none-"+asset.category||asset.type==="none",positionByCharacter:{}});
  }
  // Load user-uploaded GLB files persisted in this browser's IndexedDB.
  try{
   const localAssets=await readLocalAssets();
   for(const asset of localAssets){
    if(!asset.id||!items[asset.category]||items[asset.category].some(x=>x.id===asset.id))continue;
    const url=URL.createObjectURL(asset.blob);
    items[asset.category].push({id:asset.id,name:asset.name||asset.id,url,file:asset.blob,path:null,positionByCharacter:{}});
   }
  }catch(error){console.warn("Không thể khôi phục GLB đã upload trên thiết bị",error);}
  // Restore saved local character parts only after the manifest assets are available.
  try{
   const saved=JSON.parse(localStorage.getItem("character-studio-profiles")||"null");
   if(saved&&Array.isArray(saved.characters)&&saved.characters.length){
    for(const savedRecord of saved.characters){
     const record=characters.find(c=>c.id===savedRecord.id);
     if(!record)continue;
     record.name=savedRecord.name||record.name;record.thumbnail=savedRecord.thumbnail||record.thumbnail;
     record.parts=Object.fromEntries(categories.map(c=>[c.id,items[c.id].find(a=>a.id===savedRecord.parts?.[c.id])||null]));
     for(const category of categories){
      for(const asset of items[category.id]){
       const position=savedRecord.positions?.[asset.id]?.[record.id]||savedRecord.positions?.[asset.id];
       if(position){asset.positionByCharacter=asset.positionByCharacter||{};asset.positionByCharacter[record.id]=position;}const scale=savedRecord.scales?.[asset.id]?.[record.id]||savedRecord.scales?.[asset.id];if(scale){asset.scaleByCharacter=asset.scaleByCharacter||{};asset.scaleByCharacter[record.id]=scale;}const rotation=savedRecord.rotations?.[asset.id]?.[record.id]||savedRecord.rotations?.[asset.id];if(rotation){asset.rotationByCharacter=asset.rotationByCharacter||{};asset.rotationByCharacter[record.id]=rotation;}const color=savedRecord.colors?.[asset.id]?.[record.id]||savedRecord.colors?.[asset.id];if(color){asset.colorByCharacter=asset.colorByCharacter||{};asset.colorByCharacter[record.id]=color;}
      }
     }
    }
    const restored=characters.find(c=>c.id===saved.activeCharacterId);
    if(restored){clearActiveCharacterModels();activeCharacter=restored;activeCharacterId=restored.id;alignCharacterToGround();categories.forEach(c=>{const asset=activeCharacter.parts[c.id];if(asset)loadItem(asset,c.id);});renderCharacterList();}
   }
  }catch(error){console.warn("Không thể khôi phục các bộ phận đã lưu",error);}
  renderItems();toast("Đã nạp "+(manifest.assets||[]).length+" mô hình từ thư viện GitHub.");
 }catch(error){console.warn("Không nạp được asset manifest",error);}
}
restoreCharacterProfiles();alignCharacterToGround();
renderTabs();renderItems();captureCharacterThumbnail();renderCharacterList();loadManifestAssets();