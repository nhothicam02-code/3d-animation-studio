import * as THREE from 'three';

const ALIASES = {
  hips: ['hips','pelvis'], spine: ['spine'], chest: ['spine2','chest'], neck: ['neck'],
  head: ['head'], leftarm: ['leftarm','leftupperarm'], rightarm: ['rightarm','rightupperarm'],
  leftforearm: ['leftforearm','leftlowerarm'], rightforearm: ['rightforearm','rightlowerarm'],
  leftupleg: ['leftupleg','leftthigh'], rightupleg: ['rightupleg','rightthigh'],
  leftleg: ['leftleg','leftcalf','leftlowerleg'], rightleg: ['rightleg','rightcalf','rightlowerleg'],
  lefthand: ['lefthand'], righthand: ['righthand']
};
const normalize = s => String(s || '').toLowerCase().replace(/^mixamorig[:_\-.]?/,'').replace(/[^a-z0-9]/g,'');
function rigBones(root) {
  const all = [];
  root.traverse(n => { if (n.isBone) all.push(n); });
  const skinned = new Set();
  root.traverse(n => { if (n.isSkinnedMesh && n.skeleton) n.skeleton.bones.forEach(b => skinned.add(b)); });
  const map = new Map();
  for (const [key, names] of Object.entries(ALIASES)) {
    const candidates = all.filter(b => names.includes(normalize(b.name)));
    candidates.sort((a,b) => Number(skinned.has(b))-Number(skinned.has(a)));
    if (candidates[0]) map.set(key, candidates[0]);
  }
  return map;
}
const smooth = t => t*t*(3-2*t);
const pulse = (t, cycles=1) => Math.sin(t*Math.PI*2*cycles);
function motionValue(kind, t, intensity, side=1) {
  const p = Math.PI*2*t;
  switch (kind) {
    case 'walk': return Math.sin(p*1.25)*0.38*intensity*side;
    case 'run': return Math.sin(p*1.8)*0.62*intensity*side;
    case 'wave': return Math.sin(p*2.2)*0.48*intensity;
    case 'jump': return Math.sin(Math.PI*t)*0.45*intensity;
    case 'sit_down': return smooth(t)*0.72*intensity;
    case 'stand_up': return (1-smooth(t))*0.72*intensity;
    case 'turn_left': return smooth(t)*0.55*intensity;
    case 'turn_right': return -smooth(t)*0.55*intensity;
    default: return 0;
  }
}

// Rotation deltas are authored in character space and converted through the exact
// bind-pose parent chain to each bone's local quaternion.
export function createMotionClip(root, actionName, duration, intensity=1) {
  const bones = rigBones(root);
  const supported = ['idle','walk','run','wave','jump','turn_left','turn_right','sit_down','stand_up'];
  if (!supported.includes(actionName)) throw new Error('Chưa hỗ trợ động tác: '+actionName);
  root.updateMatrixWorld(true);
  const rootWorldQ = new THREE.Quaternion();
  root.getWorldQuaternion(rootWorldQ);
  const rootWorldInv = rootWorldQ.clone().invert();
  const getParentWorldRest = bone => {
    const q = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(q);
    return q;
  };
  const targets = [];
  const add = (key, axis, valueFn, side=1) => {
    const bone = bones.get(key); if (bone) targets.push({bone, axis:new THREE.Vector3(...axis), valueFn, side});
  };
  const locomotion = actionName === 'walk' || actionName === 'run';
  if (locomotion) {
    add('hips',[1,0,0],t=>Math.sin(t*Math.PI*2*(actionName==='run'?1.8:1.25))*0.045*intensity);
    add('spine',[1,0,0],t=>Math.sin(t*Math.PI*2*(actionName==='run'?1.8:1.25)+Math.PI)*0.035*intensity);
    for (const side of [-1,1]) {
      const left = side === 1;
      const leg = left ? 'leftupleg' : 'rightupleg';
      const knee = left ? 'leftleg' : 'rightleg';
      const arm = left ? 'rightarm' : 'leftarm';
      const fore = left ? 'rightforearm' : 'leftforearm';
      add(leg,[1,0,0],t=>Math.sin(t*Math.PI*2*(actionName==='run'?1.8:1.25))*0.42*intensity*side);
      add(knee,[1,0,0],t=>Math.max(0,Math.sin(t*Math.PI*2*(actionName==='run'?1.8:1.25)+Math.PI/2))*0.62*intensity);
      add(arm,[1,0,0],t=>-Math.sin(t*Math.PI*2*(actionName==='run'?1.8:1.25))*0.32*intensity*side);
      add(fore,[1,0,0],t=>0.12*intensity);
    }
  } else if (actionName === 'wave') {
    add('leftarm',[1,0,0],()=>-0.9*intensity);
    add('leftarm',[0,0,1],()=>-0.25*intensity);
    add('leftforearm',[1,0,0],t=>-0.35+Math.sin(t*Math.PI*4)*0.5*intensity);
    add('lefthand',[0,1,0],t=>Math.sin(t*Math.PI*4)*0.18*intensity);
  } else if (actionName === 'jump') {
    add('hips',[1,0,0],t=>Math.sin(Math.PI*t)*0.08*intensity);
    add('leftupleg',[1,0,0],t=>-Math.sin(Math.PI*t)*0.24*intensity);
    add('rightupleg',[1,0,0],t=>-Math.sin(Math.PI*t)*0.24*intensity);
    add('leftarm',[1,0,0],t=>-Math.sin(Math.PI*t)*0.75*intensity);
    add('rightarm',[1,0,0],t=>-Math.sin(Math.PI*t)*0.75*intensity);
  } else if (actionName === 'sit_down' || actionName === 'stand_up') {
    const sign = actionName === 'sit_down' ? 1 : -1;
    add('hips',[1,0,0],t=>sign*smooth(t)*0.08*intensity);
    add('leftupleg',[1,0,0],t=>sign*smooth(t)*0.95*intensity);
    add('rightupleg',[1,0,0],t=>sign*smooth(t)*0.95*intensity);
    add('leftleg',[1,0,0],t=>sign*smooth(t)*1.05*intensity);
    add('rightleg',[1,0,0],t=>sign*smooth(t)*1.05*intensity);
    add('spine',[1,0,0],t=>-sign*smooth(t)*0.12*intensity);
  } else if (actionName === 'turn_left' || actionName === 'turn_right') {
    add('hips',[0,1,0],t=>motionValue(actionName,t,intensity));
    add('spine',[0,1,0],t=>motionValue(actionName,t,intensity)*0.35);
  } else if (actionName === 'idle') {
    add('spine',[1,0,0],t=>Math.sin(t*Math.PI*2)*0.018*intensity);
    add('head',[0,1,0],t=>Math.sin(t*Math.PI*2)*0.025*intensity);
  }

  if (!targets.length) throw new Error('Không tìm thấy các xương cần thiết cho động tác '+actionName+'. Kiểm tra rig Mixamo và tên xương.');
  const times = Array.from({length: actionName==='walk'||actionName==='run'||actionName==='idle'||actionName==='wave'?17:9},(_,i)=>duration*i/(actionName==='walk'||actionName==='run'||actionName==='idle'||actionName==='wave'?16:8));
  const tracks = [];
  for (const target of targets) {
    const bone = target.bone;
    const restLocal = bone.quaternion.clone();
    const parentWorld = getParentWorldRest(bone);
    const parentInv = parentWorld.clone().invert();
    const charAxisWorld = target.axis.clone().applyQuaternion(rootWorldQ).normalize();
    const localAxis = charAxisWorld.clone().applyQuaternion(parentInv).normalize();
    const values = [];
    for (const time of times) {
      const t = time/duration;
      const angle = target.valueFn(t, intensity, target.side);
      const delta = new THREE.Quaternion().setFromAxisAngle(localAxis, angle);
      const q = delta.multiply(restLocal).normalize();
      values.push(q.x,q.y,q.z,q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(bone.uuid+'.quaternion',times,values));
  }
  return new THREE.AnimationClip(actionName,duration,tracks);
}
