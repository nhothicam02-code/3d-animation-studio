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
function setStudioStatus(message, detail = '', state = 'ready') {
  const statusText = $('systemStatusText');
  const statusDetail = $('systemStatusDetail');
  const statusDot = $('systemStatusDot');
  if (statusText) statusText.textContent = message;
  if (statusDetail) statusDetail.textContent = detail;
  if (statusDot) statusDot.className = 'status-indicator ' + state;
  const motionStatus = $('motionStatus');
  if (motionStatus) motionStatus.textContent = detail ? message + ' · ' + detail : message;
}

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
  const bindPose = new Map();
  result.object.traverse(node => {
    if (node.isBone) {
      const pose = {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone()
      };
      bindPose.set(node.name, pose);
      node.userData.bindQuaternion = pose.quaternion.clone();
    }
  });
  result.object.userData.bindPose = bindPose;
  result.object.userData.originalClips = result.animations.slice();
  $('viewportEmpty').classList.add('hidden');
  selectObject(result.object); updateSceneList();
  const rig = describeMixamoRig(result.object);
  const rigMessage = rig.isMixamo ? `Mixamo · ${rig.bones.length} xương` : `Model · ${rig.bones.length} xương`;
  setStudioStatus(rig.isMixamo ? 'Đã tải nhân vật Mixamo' : 'Đã tải model', rigMessage, rig.isMixamo ? 'ready' : 'warning');
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

const motionButton = $('generateMotionBtn');
if (motionButton) {
motionButton.onclick = async () => {
  const prompt = $('motionPrompt').value.trim();
  const apiKey = localStorage.getItem('mixamoGeminiApiKey') || '';
  if (!selected) { toast('Hãy import và chọn nhân vật FBX trước.'); return; }
  if (!prompt) { toast('Hãy nhập mô tả chuyển động.'); return; }
  if (!apiKey) { toast('Hãy thiết lập Gemini API ở trang Gemini API trước nhé.'); setStudioStatus('Thiếu Gemini API key', 'Mở trang Gemini API để thiết lập', 'warning'); return; }
  const rig = describeMixamoRig(selected);
  if (!rig.bones.length) { toast('Không tìm thấy xương trong model này.'); return; }
  if (!rig.isMixamo) {
    toast('Model có xương nhưng chưa nhận diện được bộ xương Mixamo.');
    setStudioStatus('Chưa nhận diện Mixamo', 'Hãy dùng model rig Mixamo chuẩn', 'warning');
    return;
  }
  const button = $('generateMotionBtn');
  const previousAction = activeAction;
  button.disabled = true; button.textContent = 'Đang tạo...';
  setStudioStatus('Gemini đang tạo chuyển động...', 'Animation hiện tại vẫn tiếp tục phát', 'loading');
  try {
    const schema = {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        summary: { type: 'STRING' },
        duration: { type: 'NUMBER' },
        tracks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              bone: { type: 'STRING' },
              keyframes: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    time: { type: 'NUMBER' }, x: { type: 'NUMBER' },
                    y: { type: 'NUMBER' }, z: { type: 'NUMBER' }
                  },
                  required: ['time', 'x', 'y', 'z']
                }
              }
            },
            required: ['bone', 'keyframes']
          }
        }
      },
      required: ['name', 'summary', 'duration', 'tracks']
    };
    const instructions = [
      'You are a professional 3D character animator creating keyframes for this exact Mixamo skeleton.',
      'Return local Euler XYZ ROTATION OFFSETS in DEGREES relative to the character pose at the exact moment the new AI clip will begin.',
      'The existing animation (for example Sitting Laughing) continues playing while you generate. The runtime will capture the live pose at the instant this clip starts. Therefore all animated bones MUST have zero rotation offset at time 0.',
      'Create a continuous transition from that live pose into the action described by the user. If the character is sitting and the prompt asks it to walk, animate standing up first, then walking.',
      'Do NOT force the character to return to its starting pose at the end. End in the natural final pose requested and hold that pose.',
      'Use only exact bone names from the provided list. Do not invent names.',
      'Use smooth, natural, physically plausible motion. Use 3 to 8 keyframes per animated bone. Animate only relevant bones; leave unrelated bones unchanged.',
      'Keep hips/root rotation within 12 degrees, spine/chest within 28 degrees, head/neck within 32 degrees, and limbs within anatomically safe ranges. Never rotate the whole character upside down.',
      'This first version is in-place animation; do not use root translation or extreme rotations.',
      'Interpret the Vietnamese user prompt faithfully. Keep duration 2 to 12 seconds unless specified.',
      'User prompt: ' + prompt,
      'Character: ' + selected.name,
      'Exact bone names: ' + rig.bones.join(', ')
    ].join('\n');
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: instructions }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          maxOutputTokens: 8192
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Gemini API request failed');
    const responseText = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    if (!responseText) throw new Error('Gemini không trả về dữ liệu chuyển động.');
    const animation = JSON.parse(responseText);
    const basePose = new Map();
    selected.traverse(node => {
      if (node.isBone) {
        const bind = selected.userData.bindPose?.get(node.name);
        basePose.set(node.name, bind ? bind.quaternion.clone() : node.userData.bindQuaternion.clone());
      }
    });
    const clip = createMixamoAnimation(animation, selected, basePose);
    if (!selected.userData.mixer) {
      const { AnimationMixer } = await import('three');
      selected.userData.mixer = new AnimationMixer(selected);
      studio.mixers.push(selected.userData.mixer);
    }
    const mixer = selected.userData.mixer;
    // Stop every source/generated action, then restore the exact imported bind pose.
    mixer.stopAllAction();
    mixer.time = 0;
    selected.traverse(node => {
      if (!node.isBone) return;
      const bind = selected.userData.bindPose?.get(node.name);
      if (!bind) return;
      node.position.copy(bind.position);
      node.quaternion.copy(bind.quaternion);
      node.scale.copy(bind.scale);
    });
    activeAction = null;
    generatedAction = null;
    selected.userData.clips = [clip];
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(2200, 1);
    action.clampWhenFinished = true;
    action.play();
    activeAction = action;
    generatedAction = action;
    $('playBtn').textContent = 'Ⅱ';
    $('clipStatus').textContent = '1 AI animation · Original clips محفوظ';
    $('trackEmpty').classList.add('hidden');
    $('clipTracks').innerHTML = '';
    selected.userData.clips.forEach((savedClip, index) => {
      const row = document.createElement('div');
      row.className = 'clip-row';
      row.textContent = savedClip.name || 'AI Animation';
      $('clipTracks').append(row);
    });
    const trackCount = clip.tracks.length;
    setStudioStatus('Tạo animation thành công', (animation.summary || clip.name) + ' · ' + trackCount + ' tracks · ' + clip.duration.toFixed(1) + ' giây', 'ready');
    toast('Đã tạo chuyển động cho Mixamo!');
  } catch (error) {
    console.error(error);
    setStudioStatus('Tạo chuyển động thất bại', error.message, 'error');
    toast('Không tạo được: ' + error.message);
  } finally {
    button.disabled = false; button.textContent = '✦ Tạo chuyển động';
  }
};
}

function screenshot(){
  studio.renderer.render(studio.scene,studio.camera);
  const link=document.createElement('a');link.download='3d-studio-frame.png';link.href=studio.renderer.domElement.toDataURL('image/png');link.click();
}
$('screenshotBtn').onclick=screenshot;$('exportBtn').onclick=screenshot;
let elapsed=0;
setInterval(()=>{if(activeAction?.isRunning()){elapsed+=.05;$('timecode').textContent='00:'+String(Math.floor(elapsed/60)).padStart(2,'0')+'.'+String(Math.floor(elapsed%60)).padStart(2,'0');$('playhead').style.left=Math.min(100,elapsed/10*100)+'%';}},50);
updateSceneList();