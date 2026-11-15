import { StudioScene } from './scene.js';
import { bindImporters } from './importer.js';
import { describeMixamoRig } from './mixamo-ai.js';
import { planActions } from './action-planner.js';
import { AnimationSequencer } from './sequencer.js';

const $=id=>document.getElementById(id);
const viewport=$('viewport');
const studio=new StudioScene(viewport);
let selected=null, sequencer=null, activeAction=null;
const status=(title,detail='',state='ready')=>{
  $('statusTitle').textContent=title; $('statusDetail').textContent=detail;
  $('statusDot').className='dot '+state;
};
const toast=message=>{const el=$('toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800);};
function listScene(){
  const list=$('sceneList');list.replaceChildren();
  if(!studio.models.length){list.textContent='Chưa có model';return;}
  studio.models.forEach(obj=>{
    const b=document.createElement('button');b.className='scene-item'+(obj===selected?' active':'');b.textContent=obj.name;
    b.onclick=()=>selectModel(obj);list.append(b);
  });
}
function restoreBindPose(object){
  object.traverse(n=>{
    if(!n.isBone)return;
    const pose=object.userData.bindPose?.get(n.name);
    if(pose){n.position.copy(pose.position);n.quaternion.copy(pose.quaternion);n.scale.copy(pose.scale);}
  });
  object.updateMatrixWorld(true);
}
function selectModel(obj){
  selected=obj;
  $('selectedModel').textContent=obj.name;
  $('viewportEmpty').hidden=true;
  $('sceneList').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.textContent===obj.name));
  $('rigInfo').textContent=describeMixamoRig(obj).bones.length+' bones';
  status('Đã chọn nhân vật',obj.name);
}
async function importModel(file){
  const result=await studio.loadFile(file);
  const bindPose=new Map();
  result.object.traverse(n=>{if(n.isBone){bindPose.set(n.name,{position:n.position.clone(),quaternion:n.quaternion.clone(),scale:n.scale.clone()});n.userData.bindQuaternion=n.quaternion.clone();}});
  result.object.userData.bindPose=bindPose;
  result.object.userData.originalClips=(result.animations||[]).slice();
  if(result.object.userData.mixer)result.object.userData.mixer.stopAllAction();
  selectModel(result.object);listScene();
  const rig=describeMixamoRig(result.object);
  $('rigInfo').textContent=(rig.isMixamo?'Mixamo':'Humanoid')+' · '+rig.bones.length+' bones';
  status(rig.isMixamo?'Rig Mixamo đã sẵn sàng':'Đã import model',rig.isMixamo?'Có thể tạo chuyển động':'Model chưa chắc tương thích đầy đủ','ready');
  if(result.animations?.length){$('planSummary').textContent='Model có '+result.animations.length+' animation gốc.';}
  toast('Đã import '+file.name);
}
bindImporters({modelInput:$('modelInput'),environmentInput:$('environmentInput'),viewport,onModel:importModel,onEnvironment:f=>studio.setEnvironment(f),onError:e=>{status('Lỗi import',e.message,'error');toast(e.message);}});
$('importBtn').onclick=()=>$('modelInput').click();
$('environmentBtn').onclick=()=>$('environmentInput').click();
$('resetViewBtn').onclick=()=>selected?studio.frameObject(selected):null;
$('frontBtn').onclick=()=>studio.setView('front');
$('sideBtn').onclick=()=>studio.setView('side');
$('topBtn').onclick=()=>studio.setView('top');
$('gridBtn').onclick=()=>{studio.grid.visible=!studio.grid.visible;$('gridBtn').classList.toggle('active',studio.grid.visible);};
$('playOriginalBtn').onclick=()=>{
  if(!selected?.userData.originalClips?.length){toast('Model không có animation gốc.');return;}
  sequencer?.stop();restoreBindPose(selected);
  const mixer=selected.userData.mixer;activeAction=mixer.clipAction(selected.userData.originalClips[0]);activeAction.reset().play();status('Đang phát animation gốc');
};
$('stopBtn').onclick=()=>{sequencer?.stop();if(selected?.userData.mixer)selected.userData.mixer.stopAllAction();if(selected)restoreBindPose(selected);status('Đã dừng animation');};
$('generateBtn').onclick=async()=>{
  const prompt=$('motionPrompt').value.trim(),apiKey=localStorage.getItem('mixamoGeminiApiKey')||'';
  if(!selected){toast('Hãy import model trước.');return;}
  if(!prompt){toast('Hãy nhập mô tả chuyển động.');return;}
  if(!apiKey){status('Chưa có Gemini API key','Mở trang Gemini API để thiết lập','warning');toast('Chưa có API key.');return;}
  const rig=describeMixamoRig(selected);
  if(!rig.isMixamo){toast('Model này chưa được nhận diện là Mixamo.');return;}
  const btn=$('generateBtn');btn.disabled=true;btn.textContent='Gemini đang lập kế hoạch…';
  status('Đang phân tích prompt','Gemini chỉ chọn hành động và thời lượng','loading');
  try{
    const plan=await planActions(prompt,apiKey,rig);
    if(!selected.userData.mixer){const {AnimationMixer}=await import('three');selected.userData.mixer=new AnimationMixer(selected);studio.mixers.push(selected.userData.mixer);}
    sequencer?.stop();selected.userData.mixer.stopAllAction();restoreBindPose(selected);
    sequencer=new AnimationSequencer(selected,selected.userData.mixer,(message,state)=>status(message,'Motion Library · '+(plan.summary||''),state||'ready'));
    $('planSummary').textContent=plan.summary||'Chuỗi hành động đã tạo';
    $('planList').replaceChildren();
    plan.actions.forEach((a,i)=>{const li=document.createElement('li');li.textContent=(i+1)+'. '+a.action+' — '+a.duration.toFixed(1)+'s';$('planList').append(li);});
    sequencer.play(plan);
  }catch(error){console.error(error);status('Không tạo được animation',error.message,'error');toast(error.message);}
  finally{btn.disabled=false;btn.textContent='✦ Tạo chuyển động';}
};
$('clearPlanBtn').onclick=()=>{$('planList').replaceChildren();$('planSummary').textContent='Chưa có kế hoạch';};
$('screenshotBtn').onclick=()=>{const a=document.createElement('a');a.download='animation-frame.png';a.href=studio.renderer.domElement.toDataURL('image/png');a.click();};
window.addEventListener('beforeunload',()=>studio.dispose());
listScene();
status('Sẵn sàng','Import FBX / GLB / GLTF để bắt đầu');
