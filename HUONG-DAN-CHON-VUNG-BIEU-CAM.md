# Tự sinh biểu cảm từ 6 vùng mặt

Trang **Custom → Biểu cảm → tab 🦴 Keyshape** có thêm khung **🎯 Tự sinh biểu cảm từ vùng mặt**.

## Cách dùng
1. Chọn nhân vật gốc, mở tab **Keyshape**.
2. Bấm ô **Mày trái** rồi chạm lên đúng chỗ đó trên mặt nhân vật. Trang tự chuyển sang ô kế tiếp: Mày phải → Mắt trái → Mắt phải → Mũi → Miệng. (Nhân vật tự về T-pose khi chọn.)
3. Chọn một ô đã đặt rồi kéo thanh **Cỡ vùng** để vòng màu vừa quanh bộ phận (đơn vị: % chiều cao đầu), sau đó chỉnh **hình dạng** (rộng/cao/sâu/xoay/cong — xem mục bên dưới). Bấm lại ô đang chọn để dừng chọn.
4. Bấm **⚡ Tạo biểu cảm**. Trang sẽ:
   - sinh shape key trên mesh mặt (tên chuẩn ARKit: `eyeBlinkLeft`, `browDownRight`, `mouthSmileLeft`, `jawOpen`…, tối đa 24 key);
   - tạo 10 biểu cảm Keyshape mẫu: Bình thường, Vui, Cười lớn, Cười ngượng, Buồn, Giận, Ngạc nhiên, Nháy mắt, Chu môi, Đang nói;
   - lưu nhân vật lên GitHub (bỏ tick nếu muốn lưu sau).
5. Trong Studio, thêm item **Biểu cảm** và chọn các biểu cảm này như bình thường. Nhép miệng tự dùng `jawOpen`.

Tối thiểu cần: 2 mắt (hoặc 2 mày) và mũi hoặc miệng. Thiếu vùng nào thì các shape key của vùng đó không được tạo.

## Chỉnh hình dạng vùng (mới)
Vùng không còn bắt buộc là hình cầu. Chọn một ô đã đặt rồi mở khung **📐 Hình dạng vùng**; vòng màu trên mặt đổi hình theo thời gian thực:

| Thanh | Tác dụng | Hay dùng cho |
|---|---|---|
| **Rộng** | kéo giãn theo chiều ngang của vùng | miệng, lông mày (dài) |
| **Cao** | kéo giãn theo chiều dọc | mắt to tròn / mắt hẹp |
| **Sâu** | độ dày theo chiều trước–sau; nhỏ lại để không “ăn” sang mặt sau, lưỡi, răng | mọi vùng |
| **Xoay** | nghiêng vùng trong mặt phẳng mặt (−90°…90°) | lông mày xếch, mắt xếch |
| **Cong** | uốn vùng thành cung: **+ = vòm ∩** (lông mày), **− = vòm ∪** (miệng cười) | lông mày, miệng |
| **Độ mềm viền** | thấp = lõi rộng, viền gắt; cao = giảm dần từ tâm | tránh bị “lộ mép” vùng |
| **Lực chuyển động** | nhân độ dời của mọi shape key của vùng | biểu cảm yếu / quá đà |

- **↔ Đối xứng sang bên kia**: sao chép cỡ + hình dạng sang vùng đối diện (mày trái ↔ mày phải, mắt trái ↔ mắt phải), góc xoay tự lật dấu. Tâm vùng bên kia giữ nguyên.
- **↺ Hình mặc định**: đưa bộ phận đang chọn về hình mặc định.
- Chạm lại lên mặt để **dời tâm** thì hình đã chỉnh được giữ nguyên.
- Mặc định mới: mày/mắt/mũi/miệng là elip dẹt (không còn cầu). Nhân vật **đã lưu trước đây không đổi gì** (không có trường hình dạng = quả cầu như cũ).
- Chuyển động dựa theo hệ trục của vùng: vùng càng cao thì độ dời dọc càng lớn, xoay vùng thì hướng nhắm mắt/nhếch mép xoay theo. Hình đã chỉnh xong cần bấm lại **⚡ Tạo biểu cảm** để dựng lại shape key.
- Dữ liệu lưu thêm vài số mỗi vùng (chỉ ghi trường khác mặc định) trong `faceRegions.regions.<vùng>`: `sx, sy, sz, rot, bend, soft, amp`.

## Vì sao render nhanh
- Chỉ lưu **tâm + bán kính + pháp tuyến** của 6 vùng (~1 KB) vào `characters/custom/<id>.json` → `faceRegions`. Không lưu dữ liệu morph nặng.
- Lúc nạp nhân vật, shape key được dựng lại **một lần** (vài chục ms với ~160k đỉnh; mỗi vùng chỉ quét đỉnh một lần).
- Studio chỉ dựng **những shape key mà biểu cảm của nhân vật thật sự dùng** (+ `jawOpen` cho nhép) → ít bộ nhớ GPU hơn.
- Shape key chỉ nằm trên **một mesh mặt**. Biểu cảm sinh ra là loại Keyshape (vài track số) nên mỗi khung hình chỉ nội suy số và ghi `morphTargetInfluences` — không vẽ canvas, không upload texture như biểu cảm Texture.
- Nhiều bản sao nhân vật dùng chung một file model thì dùng chung geometry; nếu hai nhân vật có vùng khác nhau, mesh được tách geometry riêng để không lẫn.

## Lưu ý
- Nếu bật **Làm mượt (smooth)** trong Studio, three.js tạo geometry không chỉ mục (nhiều đỉnh hơn) nên shape key tốn bộ nhớ hơn. Nếu máy yếu, tắt làm mượt hoặc dùng ít biểu cảm khác nhau.
- Đổi nhân vật gốc (ô chọn model) sẽ bỏ 6 vùng, vì vùng gắn với mesh của model cũ.
- Bấm **Xóa vùng** sẽ xóa vùng + shape key sinh ra; biểu cảm đã tạo vẫn còn nhưng không có key để chạy.
- Bấm ⚡ lần nữa sau khi chỉnh vùng sẽ dựng lại shape key và ghi đè các biểu cảm mẫu đã sinh (giữ nguyên id nên cảnh Studio không mất liên kết). Biểu cảm bạn tự tạo trùng tên với mẫu thì không bị ghi đè.

## File thay đổi
`custom.html` (khung chọn vùng) · `js/face-runtime.js` và `face-runtime.js` (Studio dựng shape key khi nạp) · **mới:** `js/face-regions.js`.
Chỉnh công thức từng shape key (độ mạnh nhắm mắt, nụ cười…) trong mảng `DEFS` của `js/face-regions.js`.
