# Nhép miệng theo mức mở + danh sách keyshape cần chuẩn bị

## 1. Đã làm (hình miệng PNG)

Bộ mới: `faces/mouth/nhep/` — 4 khung, xếp từ khép → mở to:

| File | Mức mở | Ngưỡng tiếng (0..1) |
|---|---|---|
| 01.png | Khép | < 0,10 |
| 02.png | Hé | 0,10 – 0,40 |
| 03.png | Mở vừa | 0,40 – 0,70 |
| 04.png | Mở to | ≥ 0,70 |

Cách chạy: khi nhân vật Custom đang có item **Biểu cảm** (texture) và cùng lúc có item **Giọng đọc (TTS)** của nhân vật đó, lớp Miệng của biểu cảm tự đổi khung theo độ lớn tiếng (cùng envelope mà nhép cũ của Studio đang dùng).
- Lớp miệng của biểu cảm là bộ nhiều khung (≥2) → dùng chính bộ đó, khung đầu = khép, khung cuối = mở to. Bộ `noi` hiện có cũng chạy được.
- Lớp miệng chỉ có 1 khung (cười, buồn…) → khi đang nói tạm đổi sang bộ `nhep`, giữ nguyên vị trí / cỡ / xoay của lớp.
- Muốn thêm bộ miệng nhép riêng: tạo thư mục `faces/mouth/<tên>/01.png…` theo thứ tự khép → mở to, rồi chọn bộ đó cho lớp Miệng.
- Biểu cảm keyshape: nếu model có keyshape `jawOpen` (hoặc `mouthOpen`, `viseme_aa`, `aa`, `A`) thì tự được điều khiển theo mức mở.

File đã sửa: `js/face-runtime.js`, `face-runtime.js`, `js/face-kit.js`, `studio.html`. File mới: 4 PNG.

Giới hạn hiện tại: chỉ đo được **độ lớn tiếng**, chưa nhận ra **âm vị** (a, o, u, m/b/p…). Muốn chọn miệng theo từng âm thì cần thêm bước căn chỉnh âm vị (tiếng Việt) — phần keyshape bên dưới là để chuẩn bị cho bước đó.

## 2. Keyshape cần chuẩn bị trong Blender

Quy ước chung
- Đặt tên **đúng chữ hoa/thường**, không dấu cách. `Left` = bên trái của nhân vật, `Right` = bên phải của nhân vật.
- Giá trị 0 → 1; Basis là mặt trung tính.
- Mỗi keyshape chỉ làm đúng một việc. Cùng tên trên nhiều mesh (mặt, răng, lưỡi) sẽ được điều khiển cùng lúc.
- Xuất **.glb** với tùy chọn Shape Keys bật (Apply Modifiers vẫn bật). Tránh Decimate / Remesh sau khi tạo shape key.
- Tên bắt đầu bằng `brow`, `eye`, `nose`, `mouth`… + `Left`/`Right` thì trang Custom tự gán đúng bộ phận.

### Mắt trái / mắt phải (mỗi bên 1 bộ)
- `eyeBlinkLeft` / `eyeBlinkRight` — nhắm hẳn
- `eyeSquintLeft` / `eyeSquintRight` — nheo (cười mắt, giận)
- `eyeWideLeft` / `eyeWideRight` — trợn to
- `eyeHappyLeft` / `eyeHappyRight` — mắt cười ^ ^ (tùy chọn)
- `eyeSadLeft` / `eyeSadRight` — mí rũ xuống ngoài (tùy chọn)
- `eyeLookUpLeft`, `eyeLookDownLeft`, `eyeLookInLeft`, `eyeLookOutLeft` (+ Right) — nhìn (tùy chọn)

### Lông mày trái / phải
- `browDownLeft` / `browDownRight` — cau xuống (giận)
- `browInnerUpLeft` / `browInnerUpRight` — đầu mày nhướng (buồn, lo)
- `browOuterUpLeft` / `browOuterUpRight` — đuôi mày nhướng (ngạc nhiên)

### Mũi
- `noseSneerLeft` / `noseSneerRight` — nhăn mũi
- `nostrilFlare` — phập phồng lỗ mũi (tùy chọn)

### Miệng — biểu cảm
- `mouthSmileLeft` / `mouthSmileRight`
- `mouthFrownLeft` / `mouthFrownRight`
- `mouthStretchLeft` / `mouthStretchRight` (tùy chọn)
- `mouthPucker` — chu môi

### Miệng — nhép (làm riêng, không lẫn với biểu cảm)
Mức mở (dùng được ngay):
- `jawOpen` — 0 khép → 1 mở to. Đây là keyshape bắt buộc.

Âm vị (dùng cho bước nhận dạng âm sau này, môi mở nhưng hàm đứng yên):
- `viseme_aa` — a, ă, â
- `viseme_E` — e, ê
- `viseme_I` — i, y
- `viseme_O` — o, ô, ơ
- `viseme_U` — u, ư
- `viseme_MBP` — m, b, p (môi khép chặt)
- `viseme_FV` — f/ph, v (răng trên chạm môi dưới)
- khoảng nghỉ = Basis, không cần shape key

Gợi ý bước làm: làm `jawOpen` trước → thử nhép → rồi mới làm 7 viseme.
