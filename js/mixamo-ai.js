import * as THREE from 'three';

export function describeMixamoRig(root) {
  const bones = [];
  root.traverse(node => {
    if (node.isBone) bones.push(node.name);
  });
  const isMixamo = bones.some(name => /mixamorig/i.test(name)) ||
    (bones.some(name => /Hips/i.test(name)) && bones.some(name => /Spine/i.test(name)) && bones.some(name => /LeftArm/i.test(name)));
  return { bones, isMixamo };
}

export function createMixamoAnimation(data, root) {
  if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
    throw new Error('Gemini không trả về dữ liệu keyframe hợp lệ.');
  }
  const boneMap = new Map();
  root.traverse(node => { if (node.isBone) boneMap.set(node.name, node); });
  const tracks = [];
  for (const item of data.tracks) {
    const bone = boneMap.get(item.bone);
    if (!bone || !Array.isArray(item.keyframes) || item.keyframes.length < 2) continue;
    const frames = [...item.keyframes].sort((a, b) => a.time - b.time);
    const times = [];
    const values = [];
    let lastTime = -1;
    for (const frame of frames) {
      const time = Math.max(0, Number(frame.time) || 0);
      if (time <= lastTime) continue;
      lastTime = time;
      const offset = new THREE.Euler(
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.x) || 0, -120, 120)),
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.y) || 0, -120, 120)),
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.z) || 0, -120, 120)),
        'XYZ'
      );
      const delta = new THREE.Quaternion().setFromEuler(offset);
      const bindQuaternion = bone.userData.bindQuaternion || bone.quaternion;\n      const q = bindQuaternion.clone().multiply(delta).normalize();
      times.push(time); values.push(q.x, q.y, q.z, q.w);
    }
    if (times.length >= 2) tracks.push(new THREE.QuaternionKeyframeTrack(item.bone + '.quaternion', times, values));
  }
  if (!tracks.length) throw new Error('Không có xương nào khớp với rig hiện tại.');
  const duration = THREE.MathUtils.clamp(Number(data.duration) || 4, 1, 30);
  return new THREE.AnimationClip(data.name || 'AI Motion', duration, tracks);
}
