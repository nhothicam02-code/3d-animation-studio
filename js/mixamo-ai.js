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

function maxAngleForBone(name) {
  const n = name.toLowerCase();
  if (/hips|root/.test(n)) return 12;
  if (/spine|chest|shoulder/.test(n)) return 28;
  if (/neck|head/.test(n)) return 32;
  if (/upleg|thigh/.test(n)) return 65;
  if (/leg|calf/.test(n)) return 85;
  if (/foot|toe/.test(n)) return 35;
  if (/forearm|hand/.test(n)) return 85;
  if (/arm/.test(n)) return 75;
  if (/finger|thumb/.test(n)) return 40;
  return 35;
}

export function createMixamoAnimation(data, root, basePose = new Map()) {
  if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
    throw new Error('Gemini không trả về dữ liệu keyframe hợp lệ.');
  }
  const boneMap = new Map();
  root.traverse(node => { if (node.isBone) boneMap.set(node.name, node); });
  const requested = new Map(data.tracks.map(item => [item.bone, item]));
  const duration = THREE.MathUtils.clamp(Number(data.duration) || 4, 1, 30);
  const tracks = [];

  for (const [name, bone] of boneMap) {
    const base = (basePose.get(name) || bone.userData.bindQuaternion || bone.quaternion).clone();
    const item = requested.get(name);
    const times = [];
    const values = [];
    const push = (time, quaternion) => {
      times.push(time);
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    };

    if (!item || !Array.isArray(item.keyframes) || item.keyframes.length < 2) {
      push(0, base);
      push(duration, base);
    } else {
      const limit = maxAngleForBone(name);
      const frames = item.keyframes
        .map(frame => ({ ...frame, time: THREE.MathUtils.clamp(Number(frame.time) || 0, 0, duration) }))
        .sort((a, b) => a.time - b.time);
      const safeFrames = [{ time: 0, x: 0, y: 0, z: 0 }];
      for (const frame of frames) {
        if (frame.time <= 0.001) continue;
        safeFrames.push(frame);
      }
      const lastFrame = safeFrames[safeFrames.length - 1];
      if (lastFrame.time < duration - 0.001) {
        safeFrames.push({ time: duration, x: lastFrame.x, y: lastFrame.y, z: lastFrame.z });
      }
      for (const frame of safeFrames) {
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.x) || 0, -limit, limit)),
          THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.y) || 0, -limit, limit)),
          THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(frame.z) || 0, -limit, limit)),
          'XYZ'
        );
        const delta = new THREE.Quaternion().setFromEuler(euler);
        push(frame.time, base.clone().multiply(delta).normalize());
      }
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, values));
  }
  if (!tracks.length) throw new Error('Không có xương nào khớp với rig hiện tại.');
  return new THREE.AnimationClip(data.name || 'AI Motion', duration, tracks);
}
