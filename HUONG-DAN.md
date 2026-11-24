# Nhân vật tách mesh + đồ skin ôm cơ thể

Chép đè các file này vào repo (giữ nguyên đường dẫn):
- js/character-pack.js   (MỚI)  tách model theo mesh, dựng lại từ json, bind đồ skin
- js/model-loader.js            nhận <tên>.character.json như một nhân vật
- js/character-kit.js           listModels thấy gói; đồ skin bám xương nhân vật
- library.html                  upload: tách mesh, đặt tên nhân vật
- custom.html                   mục "Phần cơ thể" (ẩn mesh bị áo che), đồ skin

## Upload nhân vật
Thư viện → Thêm item → Nhân vật → chọn file glb → (tick "Tách theo từng mesh") → nhập tên (trống = tên file).
Kết quả trên GitHub:
  characters/<tên>.character.json   xương + danh sách mesh
  characters/<tên>/<mesh>.glb       mỗi mesh 1 file
  characters/<tên>/animations.json  clip có sẵn trong model (nếu có)
Các trang khác (studio, apply, motion-lab, index) tự thấy "<tên>.character.json" trong danh sách nhân vật.

## Áo / váy / quần ôm cơ thể
Xuất từ Blender CÙNG armature (tên xương giống nhân vật), cùng pose gốc (T/A-pose), scale 1, KHÔNG xoá xương,
có skin weight. Upload vào danh mục Áo/Quần/Váy... Custom tự nhận khi >= 50% tên xương trùng.
Xương riêng của đồ (vạt áo, dây...) mà nhân vật không có sẽ được giữ và gắn dưới xương cha tương ứng.
Đồ skin chỉnh được Vị trí / Xoay / Tỉ lệ ở bảng bên phải như đồ thường: phép chỉnh áp lên dáng gốc TRƯỚC khi skin nên đồ vẫn biến dạng và chạy theo xương.
- Xoay và tỉ lệ quanh tâm hộp bao của đồ; Vị trí tính theo trục thế giới ở pose gốc.
- Tỉ lệ của đồ skin: 1 = nguyên bản (đồ lưu từ bản cũ tự quy về 1). Nút "Đặt lại" trả về nguyên bản.
- Ô chọn xương bị khoá với đồ skin (đồ bám cả bộ xương).

Đồ không có skin (mũ, tóc, kính, giày...) vẫn gắn cứng vào 1 xương như cũ.

## Giày / tất gắn cứng: tự tách trái – phải
Một file giày chứa cả đôi (không skin) sẽ được tự tách làm hai nửa khi nhập ở trang Custom (mục Giày, Tất):
- "Giày trái" gắn vào xương bàn chân trái, "Giày phải" gắn vào bàn chân phải → mỗi chiếc đi theo chân của nó.
- Tách theo khoảng hở giữa hai chiếc. Nếu hai chiếc dính liền thành một khối thì cắt theo mặt phẳng giữa (chỉ khi hộp bao đủ rộng giống một cặp).
- Nếu file xuất cùng hệ trục với nhân vật (gần xương bàn chân) thì mỗi chiếc nằm đúng chỗ gốc; không thì căn tâm vào xương, chỉnh vị trí ở bảng bên phải như đồ thường.
- Muốn giữ nguyên một mảnh: bỏ tick "Tự tách giày/tất gắn cứng thành trái – phải" trước khi nhập.
- Một chiếc giày đơn, hoặc đồ có skin, không bị tách.
- Dữ liệu lưu vẫn là 1 file giày + 2 piece có trường `split: "l" | "r"`; studio.html dựng lại đúng khi nạp.

File thay đổi: js/pair-split.js (MỚI), js/character-kit.js, custom.html, studio.html.
