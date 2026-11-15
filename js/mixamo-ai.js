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
  root.traverse(node => {
    if (node.isBone) boneMap.set(node.name, node);
  });

  const duration = THREE.MathUtils.clamp(Number(data.duration) || 4, 1, 30);
  const tracks = [];
  const unmatched = [];

  // Chỉ animate các xương Gemini thực sự yêu cầu.
  // Không tạo track tĩnh cho toàn bộ skeleton vì chúng có thể khóa/chồng
  // chuyển động của các xương khác trong rig.
  for (const item of data.tracks) {
    if (!item || typeof item.bone !== 'string' || !Array.isArray(item.keyframes)) continue;
    const bone = boneMap.get(item.bone);
    if (!bone) {
      unmatched.push(item.bone);
      continue;
    }
    if (item.keyframes.length < 2) continue;

    const base = (basePose.get(item.bone) || bone.userData.bindQuaternion || bone.quaternion).clone();
    const limit = maxAngleForBone(item.bone);
    const frames = item.keyframes
      .map(frame => ({
        time: THREE.MathUtils.clamp(Number(frame.time) || 0, 0, duration),
        x: Number(frame.x) || 0,
        y: Number(frame.y) || 0,
        z: Number(frame.z) || 0
      }))
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

    const times = [];
    const values = [];
    for (const frame of safeFrames) {
      const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(frame.x, -limit, limit)),
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(frame.y, -limit, limit)),
        THREE.MathUtils.degToRad(THREE.MathUtils.clamp(frame.z, -limit, limit)),
        'XYZ'
      );
      const delta = new THREE.Quaternion().setFromEuler(euler);
      const quaternion = base.clone().multiply(delta).normalize();
      times.push(frame.time);
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', times, values));
  }

  if (!tracks.length) {
    const detail = unmatched.length ? ' Tên xương không khớp: ' + unmatched.join(', ') : '';
    throw new Error('Không có keyframe nào khớp với xương của model.' + detail);
  }

  return new THREE.AnimationClip(data.name || 'AI Motion', duration, tracks);
}
