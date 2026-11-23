# Tích Lũy — AI Receipt Ledger cho SME Việt Nam

Ứng dụng web local-first giúp người dùng Việt Nam chụp hóa đơn, OCR ngay trong trình duyệt và chuyển thành sổ chi dễ theo dõi.

## Cam kết zero-cost và riêng tư

- Không dùng API trả phí, không gửi ảnh hóa đơn lên máy chủ.
- OCR chạy hoàn toàn trong trình duyệt bằng Tesseract.js.
- Dữ liệu chỉ lưu trong `localStorage` của trình duyệt.
- Tài nguyên OCR được vendored trong bản build và có thể cache để dùng offline.
- Deploy bằng GitHub Pages, public repository, không cần server trả phí.

## Tính năng MVP

1. Chụp hoặc kéo thả ảnh JPG/PNG/WebP.
2. OCR song ngữ Việt–Anh, có progress rõ ràng.
3. Parser tự nhận diện cửa hàng, ngày, tổng tiền, thuế, số hóa đơn, phương thức thanh toán và nhóm chi.
4. Chỉnh sửa trước khi lưu vào sổ chi.
5. Dashboard tháng, biểu đồ nhóm chi, tìm kiếm và lọc.
6. Xuất CSV/JSON, nhập lại bản sao lưu JSON.
7. PWA cài được, giao diện responsive, hỗ trợ bàn phím và reduced motion.

## Chạy local

```bash
npm install
npm run check
npx serve dist
```

Mở địa chỉ do `serve` hiển thị. OCR cần lần đầu tải Worker/Core và dữ liệu ngôn ngữ; các tài nguyên này đã được đóng gói cục bộ trong bản build.

## Kiểm thử

```bash
npm test
npm run build
```

## Kiến trúc

- `src/parser.js`: parser hóa đơn thuần, không phụ thuộc DOM.
- `src/storage.js`: schema, migration và lưu trữ cục bộ.
- `src/ocr.js`: worker Tesseract.js, lifecycle và tiến độ.
- `src/app.js`: state, render, accessibility và tương tác.
- `src/styles.css`: design system responsive.
- `scripts/build.mjs`: đóng gói static site vào `dist/`.
