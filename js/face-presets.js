import {guessPart} from './face-kit.js';

/* ============================================================
   Biểu cảm keyshape MẪU, dựng từ danh sách keyshape chuẩn (xem HUONG-DAN-NHEP-MIENG-VA-KEYSHAPE.md).
   Mỗi track: tên keyshape → số (giữ nguyên giá trị) hoặc [[giâyt, giátrị], …].
   Tên không có trên model sẽ được thay bằng tên gần nghĩa (ALT) hoặc bỏ qua — nên mẫu vẫn chạy trên model thiếu keyshape.
   ============================================================ */

const LR = (n, v) => ({[n + 'Left']: v, [n + 'Right']: v});
const BLINK = D => LR('eyeBlink', [[0, 0], [D - 0.4, 0], [D - 0.28, 1], [D - 0.16, 0], [D, 0]]);   // chớp mắt một lần mỗi vòng
const TALK = [[0, 0.1], [0.12, 0.55], [0.26, 0.2], [0.4, 0.7], [0.55, 0.15], [0.7, 0.5], [0.85, 0.1], [1, 0.1]];
const VIS = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U', 'viseme_MBP', 'viseme_FV'];

export const KS_PRESETS = [
  {id: 'binh-thuong', name: 'Bình thường (chớp mắt)', dur: 3, tracks: {...BLINK(3)}},
  {id: 'vui', name: 'Vui', dur: 3, tracks: {...LR('mouthSmile', 0.8), ...LR('eyeHappy', 0.7), ...LR('eyeSquint', 0.25), ...LR('browOuterUp', 0.2), jawOpen: 0.1, ...BLINK(3)}},
  {id: 'cuoi-lon', name: 'Cười lớn', dur: 0.9, tracks: {...LR('mouthSmile', 1), ...LR('eyeHappy', 1), ...LR('eyeSquint', 0.8), ...LR('browOuterUp', 0.3),
    jawOpen: [[0, 0.35], [0.15, 0.8], [0.3, 0.35], [0.45, 0.8], [0.6, 0.35], [0.75, 0.8], [0.9, 0.35]]}},
  {id: 'cuoi-nguong', name: 'Cười ngượng', dur: 3, tracks: {...LR('mouthSmile', 0.5), ...LR('eyeSquint', 0.35), ...LR('browInnerUp', 0.45), ...LR('eyeLookDown', 0.4), ...BLINK(3)}},
  {id: 'buon', name: 'Buồn', dur: 3, tracks: {...LR('mouthFrown', 0.75), ...LR('browInnerUp', 0.9), ...LR('eyeSad', 0.8), ...LR('eyeLookDown', 0.3), ...LR('eyeBlink', [[0, 0.12], [2.5, 0.12], [2.7, 1], [2.9, 0.12], [3, 0.12]])}},
  {id: 'gian', name: 'Giận', dur: 3, tracks: {...LR('browDown', 1), ...LR('eyeSquint', 0.5), ...LR('noseSneer', 0.6), ...LR('mouthFrown', 0.5), jawOpen: 0.08, ...BLINK(3)}},
  {id: 'ngac-nhien', name: 'Ngạc nhiên', dur: 2, tracks: {...LR('browInnerUp', 1), ...LR('browOuterUp', 1), ...LR('eyeWide', 1), jawOpen: [[0, 0], [0.2, 0.8], [2, 0.8]], mouthPucker: 0.2}},
  {id: 'nhay-mat', name: 'Nháy mắt (trái)', dur: 2, tracks: {eyeBlinkLeft: [[0, 0], [0.8, 0], [0.9, 1], [1.4, 1], [1.5, 0], [2, 0]], ...LR('mouthSmile', 0.7), browOuterUpRight: 0.3, eyeSquintLeft: 0.4}},
  {id: 'chu-moi', name: 'Chu môi / hôn', dur: 3, tracks: {mouthPucker: 1, ...LR('eyeSquint', 0.3), ...LR('browOuterUp', 0.3), ...BLINK(3)}},
  {id: 'dang-noi', name: 'Đang nói (nhép mẫu)', dur: 1, tracks: {jawOpen: TALK, ...LR('mouthSmile', 0.1)}},
  {id: 'thu-nhep', name: 'Thử nhép: a e i o u m f', dur: 3.5, tracks: Object.fromEntries(VIS.map((n, i) => [n, [[Math.max(0, i * 0.5 - 0.25), 0], [i * 0.5, 1], [i * 0.5 + 0.25, 0]]]))}
];

/** Tên thay thế khi model không có đúng tên chuẩn (ARKit / Studio cũ). */
const ALT = {
  jawOpen: ['mouthOpen', 'aa', 'A'],
  browInnerUpLeft: ['browInnerUp'], browInnerUpRight: ['browInnerUp'],
  browOuterUpLeft: ['browOuterUp'], browOuterUpRight: ['browOuterUp'],
  browDownLeft: ['browDown', 'Angry'], browDownRight: ['browDown', 'Angry'],
  mouthSmileLeft: ['mouthSmile', 'Happy', 'happy'], mouthSmileRight: ['mouthSmile', 'Happy', 'happy'],
  mouthFrownLeft: ['mouthFrown', 'Sad', 'sad'], mouthFrownRight: ['mouthFrown', 'Sad', 'sad'],
  eyeBlinkLeft: ['eyeBlink', 'Blink', 'blink'], eyeBlinkRight: ['eyeBlink', 'Blink', 'blink'],
  eyeWideLeft: ['eyeWide'], eyeWideRight: ['eyeWide'],
  eyeSquintLeft: ['eyeSquint'], eyeSquintRight: ['eyeSquint'],
  noseSneerLeft: ['noseSneer'], noseSneerRight: ['noseSneer']
};

/**
 * Tạo biểu cảm keyshape từ mẫu. morphs = danh sách keyshape của model (rỗng nếu chưa biết → giữ tên chuẩn).
 * Trả {expr, missing} — missing là các keyshape chuẩn mà model không có (và cũng không có tên thay thế).
 */
export function buildPreset(p, morphs, id) {
  const have = new Set(morphs || []), any = have.size > 0, used = new Set(), missing = [];
  const expr = {id, name: p.name, mode: 'keyshape', loop: true, duration: p.dur, ease: p.ease || 'smooth', parts: {}, tracks: {}};
  for (const [canon, v] of Object.entries(p.tracks)) {
    const name = !any ? canon : [canon, ...(ALT[canon] || [])].find(n => have.has(n) && !used.has(n));
    if (!name) { if (!ALT[canon] || ![canon, ...ALT[canon]].some(n => used.has(n))) missing.push(canon); continue; }
    used.add(name);
    const keys = Array.isArray(v) ? v.map(([t, x]) => ({t: Math.round(t * 1000) / 1000, v: x})) : [{t: 0, v}];
    const part = guessPart(name);
    expr.tracks[name] = part ? {part, keys} : {keys};
  }
  return {expr, missing};
}
