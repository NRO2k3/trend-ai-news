# Xu hướng AI

Trang tin AI bằng tiếng Việt **dành cho dev web**: tin tức, repo GitHub đang hot, công nghệ và công cụ AI dùng được khi làm web, nghiên cứu về code/agent, kỷ lục AI lập trình, và phòng ý tưởng. Thứ gì dev web biết cũng không để làm gì (gọi vốn, kiện tụng, chính trị, chip, robot, tạo ảnh/video, toán học…) đều bị lọc bỏ. Không cần cài thư viện, chỉ cần Node.js 20 trở lên.

```bash
npm start
```

Mở http://localhost:5050 (đổi cổng bằng `PORT=8080 npm start`).

## Trang có gì

Trang chia thành các tab; tab **Tổng quan** tóm tắt mỗi phần vài dòng.

| Tab | Nội dung | Nguồn dữ liệu |
|---|---|---|
| Tin tức | Tin nóng (một sự kiện nhiều báo đưa thì gom thành một cụm), tất cả tin có bộ lọc, công ty/chủ đề được nói tới nhiều | RSS của 14 nguồn bên dưới, bỏ tin rác theo tiêu đề (`JUNK` trong `lib/news.js`) |
| Repo hot | Repo AI hot tuần này; repo AI mới tạo tăng sao nhanh trong 30 ngày | [GitHub Trending](https://github.com/trending), GitHub Search API |
| Công nghệ & công cụ | 19 công nghệ (AI Agent, MCP, RAG…) kèm giải thích và số lần được nhắc; mô hình mới; mô hình mở và ứng dụng đang hot | tính từ các nguồn khác, [OpenRouter](https://openrouter.ai/models), [Hugging Face](https://huggingface.co) |
| Ý tưởng | Dành cho dev web: 19 bài toán thật của nghề web. Tia lửa hôm nay (thứ đang hot ghép với một bài toán thật); bàn ghép bài toán × công nghệ; bản đồ nút thắt chung nối các bài toán; tự chấm điểm và sổ ý tưởng (lưu trong trình duyệt) | Bài toán và nút thắt trong `lib/problems.js`, ghép với dữ liệu các tab khác |
| Nghiên cứu | Paper được thích nhiều nhất | [Hugging Face Papers](https://huggingface.co/papers) |
| AI giỏi tới đâu | Kỷ lục làm web và lập trình: WebDev Arena, CursorBench, SWE-bench Verified, Terminal-Bench, METR | [Epoch AI](https://epoch.ai/benchmarks) |

Tiêu đề, tóm tắt và mô tả tiếng Anh được dịch sang tiếng Việt bằng Google Dịch lúc lấy dữ liệu (`lib/translate.js`); nút "Bản gốc" chuyển về tiếng Anh. Danh sách công nghệ và lời giải thích nằm trong `lib/tech.js`.

Tab **Ý tưởng** nối các bài toán của nghề web với nhau qua *nút thắt chung*, ví dụ "Kiểm thử, xác minh tốn công" gặp ở cả test E2E, review PR, nâng cấp thư viện, kiểm tra a11y và hiệu năng: chọn một bài toán và 1–2 công nghệ sẽ thấy nút thắt nào được gỡ, bài toán nào khác dùng chung được lời giải, công nghệ đó đang được nhắc nhiều cỡ nào, và repo/mô hình có sẵn để làm thử. Thêm bài toán hoặc nút thắt mới trong `lib/problems.js`; người dùng cũng tự thêm bài toán của mình ngay trên trang.

Nguồn tin (sửa trong `lib/news.js`, mảng `SOURCES`):

- Công ty AI: OpenAI, Google DeepMind, Google AI, Hugging Face
- Nền tảng dev (chỉ bài về AI): GitHub Blog, Cloudflare, Vercel
- Báo công nghệ: TechCrunch, The Verge, Ars Technica, The Decoder
- Kỹ thuật: MarkTechPost
- Cộng đồng: Hacker News (bài về AI từ 80 điểm), Simon Willison

Repo, paper và mô hình/ứng dụng Hugging Face cũng được lọc cho dev web (`NOT_DEV`/`DEV_TASKS` trong `lib/repos.js`, `lib/papers.js`, `lib/tools.js`).

## Cấu trúc

```
server.js        máy chủ chạy trên máy: tính /data/<tên>.json trực tiếp
scripts/build.js ghi public/data/*.json để đăng lên host tĩnh
lib/data.js      danh sách các bộ dữ liệu (news, repos, tech, ideas, models, tools, papers, progress)
lib/news.js      danh sách nguồn, gom cụm tin, đếm xu hướng
lib/feed.js      đọc RSS/Atom
lib/models.js    mô hình mới (OpenRouter)
lib/papers.js    paper nổi bật (Hugging Face)
lib/progress.js  kỷ lục benchmark (Epoch AI)
lib/repos.js     repo AI hot (GitHub Trending + Search API)
lib/tools.js     mô hình và ứng dụng đang hot (Hugging Face)
lib/tech.js      công nghệ đang hot, đếm từ repo, tin tức và Hugging Face
lib/problems.js  bài toán thật và nút thắt chung nối chúng với nhau
lib/ideas.js     gắn repo/paper/tin vào bài toán và công nghệ, ghép tia lửa hôm nay
lib/translate.js dịch sang tiếng Việt (Google Dịch, có bộ nhớ đệm)
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
