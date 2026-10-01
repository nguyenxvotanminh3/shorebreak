SHOREBREAK — Lướt sóng tự do

Mở game và bấm RA BIỂN. Có hai chế độ: phiên 90 giây tính điểm hoặc lướt tự do không giới hạn.

ĐIỀU KHIỂN
A / D hoặc mũi tên trái / phải: nghiêng ván.
W hoặc mũi tên lên: lấy đà khi xuống mặt sóng.
Space: giữ để nén ván, thả gần đỉnh sóng để bật lên.
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
game.js — vòng chơi, vật lý, âm thanh và hiệu năng
water.js — shader biển và công thức mặt sóng
surfer.js — ván, người chơi và tư thế
vendor/ — Three.js và giấy phép MIT
RESEARCH.txt — cơ sở nghiên cứu, lựa chọn kỹ thuật và giới hạn

Mô hình nước ưu tiên cảm giác và tốc độ: có sóng hình học, phản chiếu bầu trời, Fresnel, bọt và vệt ván; chưa mô phỏng sóng cuộn thành ống hay chất lỏng đầy đủ.
