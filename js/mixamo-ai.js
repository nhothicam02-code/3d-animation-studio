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
  const boneSet = new Set();
  root.traverse(node => { if (node.isBone) boneSet.add(node.name); });
  const tracks = [];
  for (const item of data.tracks) {
    if (!boneSet.has(item.bone) || !Array.isArray(item.keyframes) || item.keyframes.length < 2) continue;
    const frames = [...item.keyframes].sort((a, b) => a.time - b.time);
    const times = [];
    const values = [];
    for (const frame of frames) {
      const time = Math.max(0, Number(frame.time) || 0);
      const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.x) || 0, -180, 180)),
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.y) || 0, -180, 180)),
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.z) || 0, -180, 180)),
        'XYZ'
      );
      const q = new THREE.Quaternion().setFromEuler(euler);
      times.push(time); values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(item.bone + '.quaternion', times, values));
  }
  if (!tracks.length) throw new Error('Không có xương nào khớp với rig hiện tại.');
  const duration = THREE.MathUtils.clamp(Number(data.duration) || 4, 1, 30);
  return new THREE.AnimationClip(data.name || 'AI Motion', duration, tracks);
}
