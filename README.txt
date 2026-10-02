SHOREBREAK — VỰC LẶNG / first-person underwater prototype

Một chuyến khảo sát đại dương góc nhìn thứ nhất. Khởi đầu bên phao nghiên cứu,
lặn qua rừng tảo và tàn tích Trạm Chuông để tìm ba tín hiệu ở đáy vực Nacre.
Bối cảnh, giao diện, hình học môi trường và sinh vật được làm riêng cho dự án.
Lấy cảm hứng từ cảm giác cô độc, quản lý oxy và khám phá của game lặn; không
sử dụng nhân vật, giao diện, bản đồ, âm thanh hay tài sản của Subnautica.

CHẠY TRÊN WEB
Không cài dependencies, không build, không dịch vụ bên ngoài.
1. Cài Node.js nếu máy chưa có.
2. Trong thư mục này: node server.cjs
3. Mở http://127.0.0.1:4173/ trong trình duyệt có WebGL 2.
Hoặc: python3 -m http.server 4173 --directory dist
Không mở index.html bằng file:// vì trình duyệt chặn ES modules/GLB.
Có thể đưa toàn bộ dist/ lên dịch vụ static HTTPS khi muốn xuất bản.
Bản này chưa được push, merge hay triển khai lên website công khai.

ĐIỀU KHIỂN
W / A / S / D: bơi theo hướng nhìn; di chuyển có quán tính nhẹ.
Chuột: nhìn quanh khi khóa con trỏ. Nếu trình duyệt từ chối khóa, kéo chuột
trên cảnh hoặc dùng phím mũi tên. Nút Khóa chuột cho phép thử lại chủ động.
Space: nổi lên. Ctrl hoặc C: lặn xuống. Shift: bơi nhanh, tốn oxy hơn.
Giữ E: quét khối dữ liệu ở gần, trong tầm nhìn, liên tục 2,5 giây.
F: đèn pin. Q: sonar, hiện mục tiêu xa và xung âm; hồi sau 9 giây.
P / Esc: tạm dừng. Trình duyệt mất focus/chuyển tab cũng tạm dừng.
Điện thoại: nút trái để di chuyển, vuốt vùng cảnh trống để nhìn, các nút
Lên/Xuống/Quét/Nhanh bên phải. Đèn và sonar có nút riêng.

VÒNG KHÁM PHÁ
Ba điểm khảo sát: Bãi Kính, Trạm Chuông, Khe Thở. Vòng sáng xanh đánh dấu mẫu.
Tổng bình khí 150 giây cơ bản; lặn sâu và bơi nhanh làm tiêu hao nhiều hơn.
Nổi lên mặt nước hoặc vào túi khí dưới chuông lặn để nạp oxy và hồi thể trạng.
Không cần đi hết trong một lần: quay về sát phao trên mặt nước để gửi mẫu.
Mẫu đã gửi và độ sâu kỷ lục lưu trong localStorage của trình duyệt này.
Sinh vật lớn gây thương tích nếu chạm gần. Hết oxy bắt đầu làm giảm thể trạng.
Khi thể trạng cạn, dây cứu hộ kéo bạn về phao; chỉ mẫu CHƯA gửi bị mất.
Có thể gọi cứu hộ thủ công ở menu tạm dừng, chịu cùng hậu quả.
Gửi đủ ba mẫu là hoàn tất chuyến khảo sát, sau đó vẫn tự do khám phá.
Đèn pin hiện chỉ là công cụ chiếu sáng. Sinh vật tuần tra có va chạm nguy hiểm;
đây chưa phải AI săn mồi, sinh thái mô phỏng hoặc game sinh tồn hoàn chỉnh.

ÂM THANH / TÍNH TIỆN DỤNG
Âm thanh mặc định tắt, bật chủ động ở thanh trên. Âm nền, nhịp thở và sonar
được tổng hợp tại máy, không có file nhạc bên ngoài. Tạm dừng sẽ tắt tiếng.
Cài đặt có độ nhạy, âm lượng, giảm rung và ba mức đồ họa. Tự động khởi đầu
Cân bằng trên máy tính, Tiết kiệm trên thiết bị chạm; chỉ hạ sau khi chậm kéo dài.
Tiến độ/cài đặt không đồng bộ, chỉ có ở thiết bị và địa chỉ trang hiện tại.

TỐI ƯU CỤ THỂ
- 48 ô địa hình, tổng 55.296 tam giác nền; cắt ô ngoài khoảng nhìn
- Đá, san hô, tảo, quạt biển, bọt biển và cá nhỏ được instancing
- 450 / 850 / 1.350 hạt nước; một bộ đệm và chuyển động shader
- Tối đa 60 / 125 / 210 cá nhỏ trên toàn bản đồ theo Tiết kiệm/Cân bằng/Cao
- DPR tối đa 0,8 / 1,2 / 1,6; không bloom, không shadow map, không hậu kỳ nặng
- Ba sinh vật lớn có LOD thật; tải gần khu vực, ẩn ngoài khoảng cách quy định
- Bản chi tiết chỉ tải ở mức Cao khi đến gần; model animation chỉ cập nhật khi hiện
- Shader caustics dùng chung, không tạo mesh/material/texture mới trong vòng lặp
- HUD cập nhật 10 lần/giây; vật lý bước cố định 90 Hz
Chi tiết ngân sách từng model nằm trong dist/assets/abyss/ASSET-MANIFEST.json.
Không có hệ thống streaming địa hình từ server: ô cảnh được dựng một lần rồi
culling. Các model LOD tải theo khoảng cách và giữ lại để tránh tải lặp.
Chưa đo GPU/FPS trên trình duyệt thật hoặc điện thoại, không bảo đảm tốc độ.

CẤU TRÚC
index.html / abyss.css: giao diện visor, menu và điều khiển chạm.
abyss.js: vòng đời ứng dụng, first-person camera, audio, HUD, lưu cục bộ.
abyss-sim.js: vật lý, oxy, quét mẫu, thương tích, cứu hộ, gửi dữ liệu.
abyss-input.js: tách bàn phím và nhiều pointer, xử lý huỷ và đối kháng.
abyss-world.js: địa hình, tàn tích, collider, môi trường và các quality tier.
abyss-life.js: cá bầy, tải GLB/LOD, skeleton animation và tuần tra sinh vật.
Bản lướt sóng cũ vẫn còn ở /surf-legacy.html cùng modules cũ để giữ công sức
trước đó. Chúng không chạy trong chuyến lặn mới.

KIỂM TRA
node --test tests/*.test.mjs
Đọc TESTING.txt để phân biệt những gì đã kiểm bằng code và kiểm trình duyệt
vẫn bị chặn. Bản prototype có nguồn mở để chỉnh sửa, chưa phải bản phát hành
đã qua QA đa thiết bị.
