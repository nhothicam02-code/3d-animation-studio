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
Đồ không có skin (mũ, tóc, kính, giày...) vẫn gắn cứng vào 1 xương như cũ.
