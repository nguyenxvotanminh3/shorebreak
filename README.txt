SHOREBREAK — Lướt sóng tự do

Mở game và bấm RA BIỂN. Có hai chế độ: phiên 90 giây tính điểm hoặc lướt tự do không giới hạn.

ĐIỀU KHIỂN
A / D hoặc mũi tên trái / phải: nghiêng ván.
W hoặc mũi tên lên: lấy đà khi xuống mặt sóng.
Space: giữ để nén ván, thả trên mặt sóng để bật lên.
Vừa nghiêng vừa thả Space: air reverse 360°.
Thả hướng trước khi tiếp nước để giữ ván thẳng và được thưởng.
S hoặc mũi tên xuống: giảm tốc.
Esc / P: tạm dừng.
Điện thoại: dùng các nút chạm trên màn hình.

MẸO
Carve theo đường chữ S để lấy tốc độ và nối combo. Đừng giữ một hướng quá lâu: bạn sẽ ra khỏi mặt sóng. Khi chỉ bật nhẹ, hãy lên gần đỉnh sóng hơn và giữ đủ tốc độ. Kỷ lục được lưu riêng trên trình duyệt hiện tại.

ĐỒ HỌA
Mặc định tự thích nghi; có ba mức thủ công trong Cài đặt. Nếu thiết bị nóng hoặc chạy chậm, chọn Tiết kiệm. Cần trình duyệt hỗ trợ WebGL 2 và bật tăng tốc đồ họa.

CHẠY MÃ NGUỒN
Không cần cài dependencies hay build. Có Node.js thì chạy:
  node server.cjs
Sau đó mở http://127.0.0.1:4173/
Dừng máy chủ bằng Ctrl+C. Không mở index.html trực tiếp bằng file:// vì game dùng JavaScript modules.

THƯ MỤC
index.html — giao diện và hướng dẫn
style.css — giao diện thích nghi điện thoại/máy tính
game.js — vòng chơi, âm thanh, nội suy chuyển động và hiệu năng
physics.js — vật lý cố định 120 Hz, quán tính, bật sóng, tiếp nước
hazards.js / creatures.js — sinh vật biển, né và va chạm
water.js — shader biển và công thức mặt sóng
surfer.js — ván và điều khiển bộ xương bằng IK
assets/ — nhân vật người 3D, texture và giấy phép CC0
vendor/ — Three.js và giấy phép MIT
RESEARCH.txt — cơ sở nghiên cứu, lựa chọn kỹ thuật và giới hạn

Mô hình nước ưu tiên cảm giác và tốc độ: có sóng hình học, phản chiếu bầu trời, Fresnel, bọt và vệt ván; chưa mô phỏng sóng cuộn thành ống hay chất lỏng đầy đủ.

BẢN NÂNG CẤP 2.0
Nhân vật MakeHuman liền mạch với 52 xương, khuôn mặt, bàn tay/ngón tay, chân và wetsuit. Hoạt ảnh procedural gồm nén, duỗi khi bật, co chân/giữ rail, mở người chuẩn bị đáp và nén gối khi tiếp nước. Tham khảo ảnh và hướng dẫn VĐV chuyên nghiệp, không phải motion capture.
Cá mập, Kraken, thủy quái và sứa là chướng ngại vật có va chạm. Né trái/phải hoặc bật qua sinh vật thấp; có cảnh báo khoảng cách và điểm thưởng.
Bài kiểm tra full charge trên mặt sóng đạt khoảng 4,6 m và 1,9 giây trên không. Đây là thông số thiết kế game; không phải đo đạc vận động viên.
