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

## Vật lý vải (váy, áo choàng, khăn, vạt áo…)
Trang Custom → chọn một món → tick "🧵 Vật lý vải (áp dụng cả bộ)". Thông số lưu theo bộ (trường `phys` trong json nhân vật) và studio.html tự chạy khi dựng cảnh, kể cả lúc xuất video.
- Đồ CỨNG (không skin, vd váy dạng mesh): lưới hạt 16×6 bám vào eo, mô phỏng lò xo + ràng buộc khoảng cách + va chạm đùi/cẳng chân/hông; độ lệch được nội suy lên toàn bộ đỉnh trong vertex shader nên mesh nặng vẫn mượt. Lưới hình trụ quanh tâm hộp bao, hợp váy / áo choàng / khăn; hàng trên cùng ghim cứng.
- Đồ SKIN có xương riêng (vạt váy, dây, đuôi áo): các xương riêng đó đung đưa kiểu spring-bone. Đồ skin không có xương riêng chưa mô phỏng được: thêm xương vạt trong Blender rồi xuất lại.
- Thông số: Độ cứng (kéo về dáng gốc), Độ nặng (trọng lực), Cản gió, Biên độ tối đa (cm), Va chạm chân/hông. "Thả lại vải" đặt về dáng gốc.
- Kéo thanh thời gian / đổi cảnh nhảy xa → vải tự đặt lại. Bóng đổ và chọn bằng chuột vẫn theo dáng gốc (chưa theo vải).
- Gọi trong code: `K.stepPhysics(dt)` mỗi khung hình sau khi cập nhật animation (custom.html, studio.html đã gọi).

File thay đổi: js/cloth-physics.js (MỚI), js/character-kit.js, custom.html, studio.html.

## Vật lý tóc và đuôi
Dùng chung ô "🧵 Vật lý vải / tóc / đuôi" ở trang Custom. Bộ thuộc danh mục **Tóc** hoặc **Đuôi** tự dùng kiểu **Chuỗi**; muốn dùng cho dải / dây / khăn dài ở danh mục khác thì chọn "Kiểu mô phỏng → Chuỗi". Thông số lưu theo bộ (`phys` trong json nhân vật, thêm `mode`, `sway`, `flip`), studio.html tự chạy, kể cả lúc xuất video.
- Đồ CỨNG (tóc đuôi ngựa, tóc dài, đuôi mèo / cáo / quỷ, hoặc file nhập không skin): tìm trục dài của mesh, đặt chuỗi 10 hạt dọc trục đó. Đầu gần xương gắn hơn là GỐC (ghim cứng), ngọn mềm dần; mỗi đỉnh được xoay + dời theo hạt gần nó trong vertex shader nên mesh nặng vẫn mượt. Độ dài chuỗi không giãn.
- Va chạm với đầu, cổ, thân, tay, hông và chân (tóc không xuyên vai / lưng, đuôi không xuyên đùi).
- **Vẫy / bay nhẹ tự nhiên**: lực ngang theo sin (đuôi ~1,3 Hz, tóc ~0,7 Hz) để đuôi vẫy, tóc đung đưa kể cả khi nhân vật đứng yên. Mặc định 0%.
- **Đảo đầu gốc**: đồ nhập từ file có thể bị ghim nhầm đầu (tóc buộc vào ngọn thay vì chân tóc) → bấm để đổi.
- Mảnh quá tròn / ngắn (mũ tóc ôm đầu, đuôi thỏ pompom) tự đứng yên, giao diện có ghi chú.
- Đồ SKIN có xương riêng (xương tóc, xương đuôi): spring-bone như cũ nhưng ngọn mềm hơn gốc, có va chạm đầu / thân / tay và vẫy tự nhiên. Đồ skin không có xương riêng chưa mô phỏng được: thêm chuỗi xương tóc / đuôi trong Blender rồi xuất lại.
- Mặc định cho tóc / đuôi: Độ cứng 30%, Cản gió 6%, Biên độ 50 cm (kiểu Lưới vải giữ mặc định cũ). Đổi kiểu mô phỏng thì thông số về mặc định của kiểu mới.
- Bóng đổ và chọn bằng chuột vẫn theo dáng gốc; pháp tuyến chưa uốn theo nên khi vẫy mạnh ánh sáng hơi phẳng.
- Kéo thanh thời gian / đổi cảnh nhảy xa → tóc và đuôi tự đặt lại. Gọi trong code vẫn là `K.stepPhysics(dt)` mỗi khung hình.
- Kiểm thử lõi mô phỏng (không cần trình duyệt): `node tests/strand-core.test.mjs`.

File thay đổi: js/strand-core.js (MỚI), js/cloth-physics.js, js/character-kit.js, custom.html, tests/strand-core.test.mjs (MỚI). studio.html không cần sửa.
