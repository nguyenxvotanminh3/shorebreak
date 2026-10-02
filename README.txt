SHOREBREAK 4.1 — SURF OR SPLAT

Game lướt sóng 3D chạy vô tận. Né chướng ngại, bật sóng và biểu diễn trên ván để tăng điểm. Không có giới hạn 90 giây; nhấn P, chọn Chốt điểm lượt này khi muốn kết thúc.

ĐIỀU KHIỂN
A / D hoặc ← / →: nghiêng và né trái phải.
W hoặc ↑: lấy đà khi xuống mặt sóng.
Space: giữ để nén ván, thả để nhảy. Nhảy khi có tốc độ và gần đỉnh sóng sẽ cao hơn.
Giữ E trên không: aura farming với ba tư thế luân phiên — Chào sóng, Sky King, Chiến thắng. Bay qua chướng ngại trong tư thế này để nhận điểm aura.
Thả hướng trước khi tiếp nước để đáp đẹp. S hoặc ↓: giảm tốc. P / Esc: tạm dừng.
Điện thoại: dùng nút trái, phải, lấy đà, bật sóng và AURA.

LƯU Ý KHI CHƠI
Âm thanh mặc định tắt; nhấn nút ♪ ở góc trên để bật.
Khi chuyển tab hoặc rời cửa sổ, game tự tạm dừng. Quay lại rồi nhấn P / Esc hoặc LƯỚT TIẾP để chơi tiếp.
Để lưu kỷ lục, nhấn P / Esc rồi chọn Chốt điểm lượt này trước khi đóng trang. Về bờ hoặc Bắt đầu lại không chốt điểm lượt đang chơi.
Kỷ lục và mức đồ họa được lưu bằng localStorage của trình duyệt, không đồng bộ giữa thiết bị hoặc địa chỉ truy cập. Xóa dữ liệu trang sẽ xóa các thiết lập này.

ĐƯỜNG ĐUA
Máy nghiền, cổng cưa, búa dập, kaiju vung tay/quét đuôi và bốn loài sinh vật biển. Các máy luôn có lối vòng hai bên. Cổng cưa và búa có nhịp mở; máy nghiền thấp có thể nhảy qua. Mật độ tăng dần theo quãng đường.
Va chạm làm 10 mảnh cơ thể thật cùng ván văng, xoay và rơi xuống nước, với giọt đỏ hoạt hình. Hồi sinh sau 2,4 giây, có thêm 2,4 giây bảo vệ để tiếp tục chơi.
Chướng ngại dùng pool 12 đối tượng, liên tục được đưa ra phía trước. Không tích lũy thêm mesh theo chiều dài lượt chơi.
Cảnh xa có du thuyền, thuyền buồm, tàu container chạy ngang, wake, đảo cọ và hải đăng.

ĐỒ HỌA VÀ MÔ HÌNH
Three.js, biển shader đồng bộ công thức vật lý, nhân vật MakeHuman CC0 với 52 xương và IK giữ chân trên ván. Máy, quái vật, tàu và đảo là mô hình procedural nguyên bản. Giấy phép đi kèm trong assets/ và vendor/.
Đồ họa tự thích nghi, có ba mức thủ công trong Cài đặt. Cần WebGL 2 và tăng tốc đồ họa. Hiệu năng còn phụ thuộc thiết bị và trình duyệt.
Đây là vật lý game và hoạt ảnh procedural, không phải mô phỏng chất lỏng đầy đủ hay motion capture.

CHẠY MÃ NGUỒN
Không cần cài dependencies hay build.
Trong checkout: python3 -m http.server 4173 --directory dist
Trong bản ZIP phẳng có server.cjs: node server.cjs
Mở http://127.0.0.1:4173/ — không mở index.html trực tiếp bằng file://.

CÁC MODULE
physics.js: bước vật lý 120 Hz, nhảy, hồi sinh và aura.
surfer.js: người có bộ xương, IK và ba tư thế biểu diễn.
gauntlet.js / collision.js: đường đua vô tận và va chạm theo đường quét.
machines.js / kaiju.js / creatures.js / swimming.js: mô hình, hitbox và hoạt ảnh.
crash-fx.js / aura.js: hiệu ứng tái sử dụng.
seascape.js / water.js: tàu thuyền, cảnh xa và mặt biển.
game.js / index.html / style.css: vòng chơi, camera, điều khiển và giao diện.
