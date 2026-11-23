# Tích Lũy — AI Receipt Ledger cho SME Việt Nam

Ứng dụng web **local-first** giúp người dùng Việt Nam chụp hóa đơn, OCR ngay trong trình duyệt và chuyển thành sổ chi dễ theo dõi. Dự án do OMNI Company xây dựng và triển khai với chi phí vận hành **0 đồng** trên GitHub Pages.

## Vì sao niche này phù hợp?

- Nhu cầu rõ: SME Việt Nam thường thu chi bằng hóa đơn bán lẻ nhưng nhập liệu thủ công tốn thời gian.
- Không cần backend, database trả phí hay API AI trả phí.
- Dữ liệu tài chính nhạy cảm: xử lý trong máy giúp giảm rủi ro và chi phí.
- Có thể kiểm chứng ngay bằng hóa đơn mẫu, không cần tài khoản hoặc API key.

## Cam kết zero-cost và riêng tư

- **Không upload ảnh:** OCR chạy bằng Web Worker và WASM ngay trong trình duyệt.
- **Không API trả phí:** không cần API key, backend hay dịch vụ dữ liệu trả phí.
- **Không tracking:** không gửi analytics, hồ sơ hay nội dung sổ chi ra ngoài.
- **Dữ liệu trên máy:** sổ chi được lưu trong `localStorage`; ảnh không được lưu trong sổ chi.
- **Offline sau lần tải đầu:** Worker, WASM và mô hình `vie`/`eng` là tài nguyên cục bộ; service worker cache sẵn toàn bộ để OCR tiếp tục hoạt động khi mất mạng.
- **Deploy miễn phí:** GitHub Pages phục vụ bản static từ nhánh `main`.

> OCR có thể nhầm với hóa đơn mờ, chữ viết tay hoặc bản in kém. Ứng dụng luôn để người dùng kiểm tra và sửa dữ liệu trước khi lưu.

## Tính năng MVP

1. Chụp ảnh bằng camera hoặc kéo–thả JPG, PNG, WebP; giới hạn 12 MB.
2. OCR song ngữ Việt–Anh hoàn toàn cục bộ, có progress và nút hủy.
3. Parser tự nhận diện cửa hàng, ngày, tổng tiền, thuế, số hóa đơn, phương thức thanh toán và nhóm chi.
4. Form kiểm tra/chỉnh sửa trước khi lưu; có hóa đơn mẫu để dùng thử ngay.
5. Sổ chi `localStorage` có schema, migration, kiểm tra dữ liệu và xử lý quota/corruption.
6. Dashboard tháng, biểu đồ nhóm chi, tìm kiếm và lọc theo tháng/nhóm.
7. Sửa, xóa, xuất CSV có BOM và xuất/nhập bản sao lưu JSON.
8. PWA cài được, giao diện sáng/tối, responsive, hỗ trợ bàn phím và reduced motion.
9. CSV được bảo vệ khỏi công thức spreadsheet; nhập JSON là atomic, không import một phần.

## Chạy local

Yêu cầu Node.js **22.6+**.

```bash
npm ci
npm run check
npm run serve
```

Mở `http://127.0.0.1:4175`. Lệnh `npm start` sẽ build rồi chạy server tĩnh.

### Kiểm thử

```bash
npm test       # parser, storage, CSV và build invariants
npm run build  # tạo thư mục dist/ sẵn sàng deploy
npm run check  # chạy cả test và build
```

## Deploy GitHub Pages

Repository đã có workflow `.github/workflows/deploy-pages.yml`:

1. Push commit lên nhánh `main`.
2. Workflow chạy `npm ci` và `npm run check`.
3. Artifact `dist/` được upload và deploy bằng GitHub Pages.

Trong **Settings → Pages**, chọn **GitHub Actions** làm nguồn deploy. URL thường có dạng:

```text
https://qkHUS.github.io/tich-luy-receipt-ledger/
```

Mọi đường dẫn trong bản build là tương đối, nên ứng dụng vẫn hoạt động đúng ở cả custom domain và `/<repo>/`.

## Kiến trúc

```text
src/
├── index.html              # static shell + accessible controls
├── styles.css              # design system, responsive, dark mode
├── app.js                  # state, rendering, validation và tương tác
├── ocr.js                  # lifecycle Tesseract worker, progress, cancel
├── parser.js               # parser thuần cho OCR text Việt/Anh
├── storage.js              # schema, migration, localStorage, import/export
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # app-shell + OCR asset precache offline
├── icons/                  # icon local
└── vendor/tessdata/        # mô hình ngôn ngữ nén, dùng khi build
scripts/
├── build.mjs               # đóng gói dist/ + kiểm tra offline invariants
└── serve.mjs               # static server không dependency
```

`client` không dùng framework. Runtime chỉ dùng API trình duyệt và các asset được vendored.

## Quyền riêng tư và dữ liệu

- Xóa dữ liệu: xóa một hóa đơn trong danh sách hoặc xóa site data của trình duyệt.
- Sao lưu: nút **Sao lưu JSON** tạo file chứa toàn bộ sổ chi.
- Khôi phục: nút **Nhập JSON** kiểm tra, báo số bản ghi hợp lệ và chỉ ghi sau khi người dùng xác nhận.
- Mã hóa: dữ liệu không được mã hóa ở tầng ứng dụng; bảo vệ dữ liệu cuối cùng phụ thuộc vào thiết bị và hồ sơ trình duyệt.

## Trình duyệt được hỗ trợ

- Chrome/Edge 109+
- Firefox 115+
- Safari 16.4+

Máy cần hỗ trợ WebAssembly SIMD và Web Worker. Mô hình Việt–Anh cùng core OCR chiếm khoảng 19 MB nén; lần tải đầu sẽ mất thời gian để service worker tạo cache offline.

## Giấy phép

Mã nguồn dùng MIT. Tesseract.js, tesseract.js-core và dữ liệu Tesseract dùng Apache License 2.0. Xem `THIRD_PARTY_NOTICES.md`.
