import { StudioScene } from './scene.js';
import { bindImporters } from './importer.js';
import { createMixamoAnimation, describeMixamoRig } from './mixamo-ai.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const studio = new StudioScene(viewport);
let selected = null, activeAction = null, flyMode = false, wireframe = false, uniform = true;
const keys = new Set();
let toastTimer;
let generatedAction = null;
const motionApiUrl = $('motionApiUrl');
const savedMotionUrl = localStorage.getItem('mixamoGeminiWorkerUrl') || '';
motionApiUrl.value = savedMotionUrl;
motionApiUrl.addEventListener('change', () => localStorage.setItem('mixamoGeminiWorkerUrl', motionApiUrl.value.trim()));
function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function selectObject(object) {
  selected = object;
  $('inspector').classList.toggle('hidden', !object);
  $('inspectorEmpty').classList.toggle('hidden', !!object);
  $('selectionLabel').textContent = object ? object.name : 'Nothing selected';
  if (!object) return;
  $('selectedName').textContent = object.name;
  const values = {posX:object.position.x,posY:object.position.y,posZ:object.position.z,rotX:THREE_DEG(object.rotation.x),rotY:THREE_DEG(object.rotation.y),rotZ:THREE_DEG(object.rotation.z),scaleX:object.scale.x,scaleY:object.scale.y,scaleZ:object.scale.z};
  Object.entries(values).forEach(([id,value]) => $(id).value = Number(value.toFixed(3)));
  $('visibleToggle').checked = object.visible;
  $('uniformScale').checked = uniform;
}
function THREE_DEG(rad) { return rad * 180 / Math.PI; }
function updateSceneList() {
  const list = $('sceneList'); list.innerHTML = '';
  if (!studio.models.length) list.innerHTML = '<div class="empty-assets">No objects in scene yet.<br>Import a model to get started.</div>';
  studio.models.forEach((obj,index) => {
    const row = document.createElement('div'); row.className = 'scene-item' + (obj === selected ? ' selected' : '');
    const symbol = document.createElement('span'); symbol.className='scene-symbol'; symbol.textContent='◈';
    const name = document.createElement('span'); name.textContent=obj.name || 'Object '+(index+1);
    const remove = document.createElement('span'); remove.className='scene-remove'; remove.textContent='⋯';
    row.append(symbol,name,remove); row.addEventListener('click',()=>{selectObject(obj);updateSceneList();});
    list.append(row);
  });
  $('objectCount').textContent = studio.models.length+' OBJECT'+(studio.models.length===1?'':'S');
}
async function importModel(file) {
  const result = await studio.loadFile(file);
  $('viewportEmpty').classList.add('hidden');
  selectObject(result.object); updateSceneList();
  const rig = describeMixamoRig(result.object);
  $('motionStatus').textContent = rig.isMixamo
    ? `Mixamo rig: ${rig.bones.length} bones detected.`
    : `Đã import model có ${rig.bones.length} xương. Nên dùng FBX Mixamo.`;
  if (result.animations.length) {
    $('clipStatus').textContent = result.animations.length+' animation clip'+(result.animations.length>1?'s':'');
    $('trackEmpty').classList.add('hidden'); $('clipTracks').innerHTML='';
    result.animations.forEach((clip,index)=>{
      const row=document.createElement('div'); row.className='clip-row'; row.textContent=clip.name || 'Animation '+(index+1);
      $('clipTracks').append(row);
    });
    playClip(result.object, result.animations[0]);
  }
  toast('Imported '+file.name);
}
function playClip(object,clip) {
  if (activeAction) activeAction.stop();
  const mixer=object.userData.mixer;
  if (!mixer) return;
  activeAction=mixer.clipAction(clip); activeAction.reset().play();
  $('playBtn').textContent='Ⅱ';
}
bindImporters({modelInput:$('modelInput'),environmentInput:$('environmentInput'),viewport,onModel:importModel,onEnvironment:async file=>{await studio.setEnvironment(file);toast('360° environment loaded');},onError:error=>{console.error(error);toast('Import failed: '+error.message);}});
$('addPrimitiveBtn').onclick=()=>{const cube=studio.addPrimitive();$('viewportEmpty').classList.add('hidden');selectObject(cube);updateSceneList();toast('Cube added');};
$('deleteObjectBtn').onclick=()=>{if(!selected)return;studio.remove(selected);selectObject(null);updateSceneList();if(!studio.models.length)$('viewportEmpty').classList.remove('hidden');};
$('visibleToggle').onchange=e=>{if(selected)selected.visible=e.target.checked;};
$('uniformScale').onchange=e=>uniform=e.target.checked;
[['posX','x','position'],['posY','y','position'],['posZ','z','position'],['rotX','x','rotation'],['rotY','y','rotation'],['rotZ','z','rotation'],['scaleX','x','scale'],['scaleY','y','scale'],['scaleZ','z','scale']].forEach(([id,axis,kind])=>{
  $(id).addEventListener('change',e=>{
    if(!selected)return; const value=Number(e.target.value)||0;
    if(kind==='rotation')selected.rotation[axis]=value*Math.PI/180;
    else selected[kind][axis]=value;
    if(kind==='scale'&&uniform){const scale=Math.max(.001,value);selected.scale.setScalar(scale);['scaleX','scaleY','scaleZ'].forEach(k=>$(k).value=scale.toFixed(3));}
  });
});
$('lightIntensity').oninput=e=>{$('lightValue').textContent=Number(e.target.value).toFixed(1);studio.ambient.intensity=Number(e.target.value);};
$('gridBtn').onclick=()=>{studio.grid.visible=!studio.grid.visible;$('gridBtn').classList.toggle('active',studio.grid.visible);};
$('wireBtn').onclick=()=>{wireframe=!wireframe;studio.models.forEach(o=>o.traverse(n=>{if(n.isMesh)(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.wireframe=wireframe);}));$('wireBtn').classList.toggle('active',wireframe);};
$('resetViewBtn').onclick=()=>{if(selected)studio.frameObject(selected);else{studio.camera.position.set(5,3.5,7);studio.controls.target.set(0,1,0);studio.camera.up.set(0,1,0);studio.controls.update();}};
$('frontViewBtn').onclick=()=>studio.setView('front');
$('sideViewBtn').onclick=()=>studio.setView('side');
$('topViewBtn').onclick=()=>studio.setView('top');
function setFlyMode(enabled){
  flyMode=enabled;studio.controls.enabled=!enabled;
  $('flyModeBtn').classList.toggle('active',enabled);$('orbitModeBtn').classList.toggle('active',!enabled);
  $('flyHint').classList.toggle('show',enabled);
  if(enabled){viewport.requestPointerLock?.();toast('Fly mode: click viewport, WASD + mouse');}
  else if(document.pointerLockElement)document.exitPointerLock();
}
$('flyModeBtn').onclick=()=>setFlyMode(true);
$('orbitModeBtn').onclick=()=>setFlyMode(false);
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&flyMode){flyMode=false;studio.controls.enabled=true;$('flyHint').classList.remove('show');$('flyModeBtn').classList.remove('active');$('orbitModeBtn').classList.add('active');}});
document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA'].includes(document.activeElement.tagName))return;keys.add(e.code);});
document.addEventListener('keyup',e=>keys.delete(e.code));
document.addEventListener('mousemove',e=>{
  if(!flyMode||document.pointerLockElement!==viewport)return;
  const sensitivity=.002;const direction=new (studio.camera.position.constructor)();
  studio.camera.getWorldDirection(direction);
  const euler=new (awaitlessEuler())(0,0,0,'YXZ');
  euler.setFromQuaternion(studio.camera.quaternion);euler.y-=e.movementX*sensitivity;euler.x-=e.movementY*sensitivity;
  euler.x=Math.max(-Math.PI/2+.02,Math.min(Math.PI/2-.02,euler.x));
  studio.camera.quaternion.setFromEuler(euler);
});
function awaitlessEuler(){return studio.camera.rotation.constructor;}
const originalRender=studio.render.bind(studio);
studio.render=function(){
  if(flyMode&&document.pointerLockElement===viewport){
    const speed=.12;const forward=new (studio.camera.position.constructor)();studio.camera.getWorldDirection(forward);forward.y=0;forward.normalize();
    const right=new (studio.camera.position.constructor)().crossVectors(forward,new (studio.camera.position.constructor)(0,1,0)).negate().normalize();
    if(keys.has('KeyW'))studio.camera.position.addScaledVector(forward,speed);
    if(keys.has('KeyS'))studio.camera.position.addScaledVector(forward,-speed);
    if(keys.has('KeyA'))studio.camera.position.addScaledVector(right,-speed);
    if(keys.has('KeyD'))studio.camera.position.addScaledVector(right,speed);
    if(keys.has('KeyQ'))studio.camera.position.y-=speed;
    if(keys.has('KeyE'))studio.camera.position.y+=speed;
  }
  originalRender();
};
$('playBtn').onclick=()=>{
  if(!selected?.userData.mixer||!selected.userData.clips?.length){toast('No animation clip found in selected model');return;}
  if(activeAction?.isRunning()){activeAction.paused=true;$('playBtn').textContent='▶';}
  else if(activeAction){activeAction.paused=false;activeAction.play();$('playBtn').textContent='Ⅱ';}
  else playClip(selected,selected.userData.clips[0]);
};
$('stopBtn').onclick=()=>{if(activeAction){activeAction.stop();activeAction=null;}$('playBtn').textContent='▶';};
$('addKeyBtn').onclick=()=>toast('Keyframe editor is coming in the animation phase.');

$('generateMotionBtn').onclick = async () => {
  const prompt = $('motionPrompt').value.trim();
  const endpoint = motionApiUrl.value.trim().replace(/\/$/, '');
  if (!selected) { toast('Hãy import và chọn nhân vật FBX trước.'); return; }
  if (!prompt) { toast('Hãy nhập mô tả chuyển động.'); return; }
  if (!endpoint) { toast('Nhập Gemini Worker URL trước nhé.'); motionApiUrl.focus(); return; }
  const rig = describeMixamoRig(selected);
  if (!rig.bones.length) { toast('Không tìm thấy xương trong model này.'); return; }
  const button = $('generateMotionBtn');
  button.disabled = true; button.textContent = 'Đang tạo...';
  $('motionStatus').textContent = 'Gemini đang phân tích chuyển động...';
  try {
    const response = await fetch(endpoint + '/animate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, bones: rig.bones, rigName: selected.name })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Gemini Worker request failed');
    const clip = createMixamoAnimation(payload.animation, selected);
    if (!selected.userData.mixer) {
      const { AnimationMixer } = await import('three');
      selected.userData.mixer = new AnimationMixer(selected);
      studio.mixers.push(selected.userData.mixer);
    }
    if (activeAction) activeAction.stop();
    if (generatedAction) generatedAction.stop();
    const mixer = selected.userData.mixer;
    const action = mixer.clipAction(clip);
    action.reset(); action.setLoop(2201, Infinity); action.play();
    activeAction = action; generatedAction = action;
    $('playBtn').textContent = 'Ⅱ';
    $('clipStatus').textContent = 'AI: ' + clip.name;
    $('trackEmpty').classList.add('hidden');
    $('clipTracks').innerHTML = '';
    const row = document.createElement('div'); row.className = 'clip-row'; row.textContent = clip.name;
    $('clipTracks').append(row);
    $('motionStatus').textContent = payload.animation.summary || 'Chuyển động đã được tạo.';
    toast('Đã tạo chuyển động cho Mixamo!');
  } catch (error) {
    console.error(error);
    $('motionStatus').textContent = error.message;
    toast('Không tạo được: ' + error.message);
  } finally {
    button.disabled = false; button.textContent = '✦ Tạo chuyển động';
  }
};
function screenshot(){
  studio.renderer.render(studio.scene,studio.camera);
  const link=document.createElement('a');link.download='3d-studio-frame.png';link.href=studio.renderer.domElement.toDataURL('image/png');link.click();
}
$('screenshotBtn').onclick=screenshot;$('exportBtn').onclick=screenshot;
let elapsed=0;
setInterval(()=>{if(activeAction?.isRunning()){elapsed+=.05;$('timecode').textContent='00:'+String(Math.floor(elapsed/60)).padStart(2,'0')+'.'+String(Math.floor(elapsed%60)).padStart(2,'0');$('playhead').style.left=Math.min(100,elapsed/10*100)+'%';}},50);
updateSceneList();