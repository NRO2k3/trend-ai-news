# Xu hướng AI

Trang tổng hợp để xem thế giới AI đang chạy tới đâu: tin tức, mô hình mới, nghiên cứu nổi bật và kỷ lục benchmark. Không cần cài thư viện, chỉ cần Node.js 20 trở lên.

```bash
npm start
```

Mở http://localhost:5050 (đổi cổng bằng `PORT=8080 npm start`).

## Trang có gì

| Phần | Nguồn dữ liệu | Tự làm mới |
|---|---|---|
| Thế giới AI đang ở đâu: kỷ lục GPQA, FrontierMath, SWE-bench, Terminal-Bench, METR | [Epoch AI](https://epoch.ai/benchmarks) | 12 giờ |
| Tin nóng: một sự kiện được nhiều nguồn cùng đưa thì gom thành một cụm | RSS của 16 nguồn bên dưới | 15 phút |
| Dòng tin: lọc theo loại nguồn, thời gian, từ khóa; nút "Dịch" mở bản dịch tiếng Việt | như trên | 15 phút |
| Được nhắc nhiều nhất: công ty/chủ đề nào đang nóng tuần này so với tuần trước | tính từ tin | 15 phút |
| Mô hình mới ra mắt | [OpenRouter](https://openrouter.ai/models) | 1 giờ |
| Nghiên cứu nổi bật | [Hugging Face Daily Papers](https://huggingface.co/papers) | 1 giờ |

Nguồn tin (sửa trong `lib/news.js`, mảng `SOURCES`):

- Phòng lab: OpenAI, Google DeepMind, Google AI, Hugging Face, NVIDIA
- Báo chí: TechCrunch, The Verge, MIT Technology Review, Ars Technica, Wired, The Decoder
- Nghiên cứu: MarkTechPost, Import AI
- Cộng đồng: Hacker News (bài về AI từ 80 điểm), Simon Willison
- Việt Nam: VnExpress Số hóa (lọc bài liên quan AI)

## Cấu trúc

```
server.js        máy chủ chạy trên máy: tính /data/<tên>.json trực tiếp
scripts/build.js ghi public/data/*.json để đăng lên host tĩnh
lib/data.js      danh sách các bộ dữ liệu (news, models, papers, progress)
lib/news.js      danh sách nguồn, gom cụm tin, đếm xu hướng
lib/feed.js      đọc RSS/Atom
lib/models.js    mô hình mới (OpenRouter)
lib/papers.js    paper nổi bật (Hugging Face)
lib/progress.js  kỷ lục benchmark (Epoch AI)
public/          giao diện
```

Khi chạy trên máy, bấm "Làm mới" sẽ lấy lại dữ liệu ngay, bỏ qua bộ nhớ đệm.

## Đăng miễn phí lên GitHub Pages

Không cần máy chủ: GitHub Actions chạy `scripts/build.js` mỗi 30 phút rồi đăng thư mục `public/` lên GitHub Pages (workflow: `.github/workflows/pages.yml`).

1. Tạo repo **công khai** trên GitHub (ví dụ `trend-ai-news`), rồi đẩy code lên nhánh `main`.
2. Vào **Settings → Pages**, mục **Source** chọn **GitHub Actions**.
3. Vào tab **Actions**, chọn workflow "Cập nhật và đăng trang", bấm **Run workflow**.
4. Trang sẽ có ở `https://<tên-tài-khoản>.github.io/trend-ai-news/`.

Lịch 30 phút của GitHub có thể trễ vài phút. Nếu một nguồn dữ liệu lỗi, bản build giữ lại dữ liệu cũ của phần đó; nếu tất cả đều lỗi thì trang đang chạy được giữ nguyên.
