LATEST REVISION: dynamic-sea-v8
Biển chuyển dần theo chu kỳ bốn phút: êm → vừa → động → vừa → êm.
Sóng dài/ngắn, bọt đầu sóng, gió, mây và ánh sáng thay đổi đồng bộ.
Trạng thái biển hiện dưới đồng hồ độ sâu. /sea-review.html có ba pha so sánh.
Xem DYNAMIC-SEA.md để biết phạm vi mô phỏng và giới hạn kiểm tra.

PREVIOUS REVISION: island-ecosystem-v7
Swim to the marked sandy shore of Đảo Vân, wade onto land and follow the
forest trail to its54m summit; return to the water without teleporting.
The smaller15m islet is also accessible. See ISLAND-EXPLORATION.md.
/ink-review.html and /island-review.html offer isolated inspection controls.

PREVIOUS LOCAL REVISION: kraken-ink-v6
The Kraken now uses a defensive siphon plume and articulated jet escape when
a diver approaches. See INK-DEFENSE.md; /ink-review.html offers fixed-time
inspection controls. This ink stage has not received actual browser pixel QA.

PREVIOUS LOCAL REVISION: dive-tools-v5
Active-turn steering, finite-range sonar echoes, centered shadowed flashlight,
and strict cross-platform numerical fixtures. See DIVE-TOOLS.txt and
MAC-V4-NUMERIC-QA.md. Settings shows the build label to distinguish old servers.

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
Toàn bộ bản hiện tại được chuẩn bị để cập nhật draft PR #3 và Site hiện có.
URL chính thức: https://shorebreak-surf.worknguyenvotanminh.chatgpt.site
Xem nhãn dynamic-sea-v8 trong Cài đặt để xác định bản đang chạy.
Tình trạng triển khai được báo riêng sau khi dịch vụ xác nhận thành công.
https://github.com/nguyenxvotanminh3/shorebreak/pull/3

ĐIỀU KHIỂN
W / A / S / D: bơi theo hướng nhìn; thả hướng sẽ dừng mượt trong khoảng 0,3 giây.
Chuột: nhìn quanh khi khóa con trỏ. Nếu trình duyệt từ chối khóa, kéo chuột
trên cảnh hoặc dùng phím mũi tên. Nút Khóa chuột cho phép thử lại chủ động.
Space: nổi lên. Ctrl hoặc C: lặn xuống. Shift: bơi nhanh, tốn oxy hơn.
Giữ E: quét khối dữ liệu ở gần, trong tầm nhìn; giữ đủ 2,5 giây để hoàn tất.
Khi nhả E hoặc mất mục tiêu, tiến độ quét giảm dần; đổi mục tiêu sẽ đặt lại.
F: đèn pin. Q: sonar trong 140 m, báo khoảng cách/hướng/độ sâu theo hồi âm;
hồi sau 9 giây. Dấu sinh vật là vị trí lúc quét và phai sau 5 giây.
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
có trạng thái bơi, tăng tốc, đổi hướng và phản ứng khi người lặn đến gần.
Đây chưa phải AI săn mồi, mô phỏng chất lỏng/sinh thái đầy đủ hay game sinh tồn hoàn chỉnh.

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
- DPR tối đa 0,8 / 1,2 / 1,6; không bloom/hậu kỳ nặng; một shadow map đèn pin có giới hạn
- Ba sinh vật lớn có LOD thật; tải gần khu vực, ẩn ngoài khoảng cách quy định
- Bản chi tiết chỉ tải ở mức Cao khi đến gần; model animation chỉ cập nhật khi hiện
- Shader caustics dùng chung, không tạo mesh/material/texture mới trong vòng lặp
- HUD cập nhật 10 lần/giây; vật lý bước cố định 90 Hz
Chi tiết ngân sách từng model nằm trong dist/assets/abyss/ASSET-MANIFEST.json.
Không có hệ thống streaming địa hình từ server: ô cảnh được dựng một lần rồi
culling. Các model LOD tải theo khoảng cách và giữ lại để tránh tải lặp.
Bản nền trước khi thêm tay đã chạy Chrome/WebGL2 thật trên Apple M2: mẫu rAF 7 giây ở một góc nhìn đạt
khoảng 55,4 / 57,0 / 57,9 FPS (Cao / Cân bằng / Tiết kiệm). Đây không phải đo
GPU hoặc toàn bản đồ; chưa thử điện thoại và không bảo đảm 60 FPS ổn định.

TAY NGƯỜI LẶN
Hai tay/găng và ống tay đồ lặn được gắn vào camera, có xương và bốn clip
Blender: nghỉ, bơi, bơi nhanh và quét mẫu. Nhịp tay theo chuyển động đã xử lý
va chạm; không tiếp tục bơi khi chỉ giữ hướng vào tường/mặt nước. Chuyển tư
thế mượt, dừng theo menu, giữ tỷ lệ giải phẫu trên màn hình hẹp và dùng độ sâu
3D thật để vật thể có thể che tay. Xem PLAYER-ARMS.txt để biết kiểm tra riêng.

CẤU TRÚC
index.html / abyss.css: giao diện visor, menu và điều khiển chạm.
abyss.js: vòng đời ứng dụng, first-person camera, audio, HUD, lưu cục bộ.
abyss-sim.js: vật lý, oxy, quét mẫu, thương tích, cứu hộ, gửi dữ liệu.
abyss-arms.js: tay góc nhìn thứ nhất, blend clip, thu tay khi gần vật cản.
abyss-input.js: tách bàn phím và nhiều pointer, xử lý huỷ và đối kháng.
abyss-world.js: địa hình, tàn tích, collider, môi trường và các quality tier.
abyss-water.js: mặt nước nhìn từ dưới, sóng/ánh sáng và hấp thụ màu theo đường nhìn.
abyss-life.js / abyss-locomotion.js: bơi/tăng tốc/đổi hướng, GLB/LOD và pha đồng bộ.
abyss-shark-motion.js / abyss-kraken-motion.js / abyss-warden-motion.js: khớp theo loài.
abyss-jellyfish.js: chuông sứa biến dạng, co/giãn và xúc tu trễ theo chuyển động.
Bản lướt sóng cũ vẫn còn ở /surf-legacy.html cùng modules cũ để giữ công sức
trước đó. Chúng không chạy trong chuyến lặn mới.

KIỂM TRA
node --test tests/*.test.mjs
Đọc TESTING.txt và MAC-QA.md để phân biệt kiểm tra tự động, những gì đã chạy
trên Mac thật và các giới hạn còn lại. Bản prototype có nguồn để chỉnh sửa,
chưa phải bản phát hành đã qua QA đa thiết bị.

CẬP NHẬT SINH VẬT VÀ THẢM THỰC VẬT
Kraken đã có chu kỳ duỗi dài → thu/cuộn từng đoạn xúc tu, kiểm tra bằng ảnh
WebGL thật ở cùng góc nhìn. Sứa có pha co, mở lại và lướt; các đoạn tua có độ
trễ khác nhau. Chuyển động liên tục toàn chu kỳ vẫn cần kiểm tra video thêm.
Bản nhánh mới tích hợp sáu mẫu thực vật Blender có LOD/instancing, Kraken được
chỉnh bề mặt và trọng số giác hút, cùng atlas mô sứa. Đọc REEF-ART.txt và
MOTION-MAC-QA.md: ảnh Blender và kiểm tra tự động không thay cho kiểm tra hình
ảnh trong game của bản đồ hoạ mới.

GIÀN KHOAN SÂU / 07
Khu phía Nam mới có giàn khoan khổng lồ và lối vào ở độ sâu khoảng109m.
Tìm dấu “GIÀN KHOAN /07”, bơi vào khoang ướt, nhìn bảng bên trái rồi nhấnE.
Cửa ngoài đóng → nước hạ xuống → cửa trong mở; bạn chuyển sang đi bộ và nạp
khí trong tiền sảnh, hành lang, phòng điều khiển và phòng máy. Khi quay lại,
bảng bên phải bơm nước vào và mở cửa biển. R quay về phía an toàn trước đó.
Đừng đứng ở ngưỡng cửa khi muốn chạy chu trình. Không có dịch chuyển tức thời.
Đọc RIG-IMPLEMENTATION.md để xem cơ chế, giới hạn và kiểm tra. Bản này đã qua
kiểm tra mã/va chạm và xem render Blender, chưa qua kiểm tra WebGL thực tế của
riêng giàn khoan. Kết quả cũ không thay cho kiểm tra hình ảnh bản cập nhật mới.
