import { getNews } from './news.js';
import { getRepos } from './repos.js';
import { getTools } from './tools.js';
import { cached } from './util.js';

const DAY = 86400e3;

// Technologies a newcomer keeps hearing about, explained in plain Vietnamese.
// Each is counted across hot repos, this week's news and trending Hugging Face items.
// `can` is what the technology lets you do, phrased to fit "Dùng … để …?" on the ideas tab.
export const TECH = [
  { id: 'agent', name: 'AI Agent (tác nhân AI)', can: 'tác nhân AI tự làm nhiều bước liên tiếp', what: 'AI tự lên kế hoạch, dùng công cụ và làm nhiều bước liên tiếp để hoàn thành việc thay bạn.', re: /\b(agents?|agentic|multi-agent)\b/i },
  { id: 'coding', name: 'AI lập trình', can: 'AI tự viết, sửa và kiểm tra code', what: 'AI viết, sửa và kiểm tra code; ví dụ Claude Code, Codex, Cursor, Copilot.', re: /\b(coding|coder|code (?:review|generation|assistant)|claude code|codex|cursor|copilot|vibe[- ]coding)\b/i },
  { id: 'mcp', name: 'MCP', can: 'AI kết nối thẳng vào phần mềm, dữ liệu sẵn có (MCP)', what: 'Chuẩn chung để AI kết nối với công cụ và dữ liệu bên ngoài như Google Drive, cơ sở dữ liệu, trình duyệt.', re: /\b(mcp|model context protocol)\b/i },
  { id: 'rag', name: 'RAG (tra cứu tài liệu)', can: 'AI tra đúng tài liệu riêng rồi mới trả lời (RAG)', what: 'AI tìm trong tài liệu của bạn trước rồi mới trả lời, nên trả lời đúng theo dữ liệu riêng.', re: /\b(rag|retrieval[- ]augmented|knowledge bases?|vector (?:db|database|search)|embeddings?)\b/i },
  { id: 'local', name: 'Chạy AI trên máy cá nhân', can: 'AI chạy ngay trên máy, không cần Internet', what: 'Tải mô hình về chạy ngay trên laptop/PC, không cần Internet hay trả phí (Ollama, llama.cpp…).', re: /\b(ollama|llama\.cpp|gguf|mlx|on[- ]device|local[- ](?:llms?|ai|models?)|offline|lm studio)\b/i },
  { id: 'open', name: 'Mô hình mã nguồn mở', can: 'mô hình mở tự cài trên máy chủ của mình', what: 'Mô hình được công bố công khai, ai cũng tải về dùng và chỉnh sửa được (Qwen, DeepSeek, Llama, Gemma…).', re: /\b(open[- ](?:source|weights?)|qwen[\w.-]*|deepseek|llama[\w.-]*|mistral|gemma|kimi|glm[\w.-]*)\b/i },
  { id: 'finetune', name: 'Tinh chỉnh mô hình', can: 'mô hình được dạy riêng dữ liệu chuyên ngành', what: 'Dạy thêm cho một mô hình có sẵn để làm thật tốt một việc riêng (fine-tuning, LoRA).', re: /\b(fine-?tun\w*|lora|qlora|post-?training|distill\w*|rlhf|grpo)\b/i },
  { id: 'image', name: 'Tạo và sửa ảnh', can: 'AI tạo và sửa ảnh theo mô tả', what: 'AI vẽ hoặc chỉnh ảnh theo mô tả bằng chữ.', re: /\b(text-to-image|image[- ](?:generation|editing|edit)|diffusion|comfyui|flux|midjourney)\b/i },
  { id: 'video', name: 'Tạo video', can: 'AI làm video từ chữ hoặc ảnh', what: 'AI làm video từ đoạn mô tả hoặc từ một bức ảnh.', re: /\b(video[- ](?:generation|gen|models?)|text-to-video|image-to-video|sora|veo|wan[\d.]*)\b/i },
  { id: 'voice', name: 'Giọng nói', can: 'AI nghe và nói tự nhiên như người', what: 'AI nghe và chép lời, hoặc đọc văn bản bằng giọng như người thật.', re: /\b(tts|text-to-speech|speech|voice|asr|whisper)\b/i },
  { id: 'computer', name: 'AI tự dùng máy tính', can: 'AI tự thao tác máy tính, trình duyệt như người', what: 'AI tự nhìn màn hình, bấm chuột, gõ phím để thao tác trên web hoặc phần mềm.', re: /\b(computer[- ]use|browser[- ](?:use|agents?|automation)|gui[- ]agents?|web[- ]agents?)\b/i },
  { id: 'multimodal', name: 'Hiểu cả ảnh và chữ', can: 'AI nhìn được ảnh, video và hiểu tài liệu', what: 'Một mô hình hiểu được nhiều loại dữ liệu cùng lúc: chữ, ảnh, âm thanh, video.', re: /\b(multimodal|multi-modal|vision[- ]language|vlms?|image-text-to-text|any-to-any)\b/i },
  { id: 'reasoning', name: 'Suy luận nhiều bước', can: 'AI suy luận nhiều bước trước khi trả lời', what: 'Mô hình “suy nghĩ” trước khi trả lời nên giỏi toán, code và các bài khó.', re: /\b(reasoning|chain[- ]of[- ]thought|thinking)\b/i },
  { id: 'inference', name: 'Chạy mô hình nhanh, rẻ', can: 'mô hình chạy nhanh, rẻ trên phần cứng yếu', what: 'Phần mềm giúp chạy mô hình nhanh hơn và tốn ít GPU hơn (vLLM, SGLang, lượng tử hóa).', re: /\b(inference|vllm|sglang|tensorrt|quantiz\w*|serving)\b/i },
  { id: 'robot', name: 'Robot và AI vật lý', can: 'robot, thiết bị do AI điều khiển', what: 'AI điều khiển robot và máy móc ngoài đời thật.', re: /\b(robot\w*|humanoids?|embodied)\b/i },
  { id: 'memory', name: 'Bộ nhớ cho AI', can: 'AI nhớ từng người dùng qua nhiều lần trò chuyện', what: 'Giúp AI nhớ thông tin của bạn qua nhiều cuộc trò chuyện.', re: /\b(memory|context engineering)\b/i },
  { id: 'automation', name: 'Tự động hóa công việc', can: 'chuỗi công việc tự động có AI ở giữa', what: 'Nối AI vào chuỗi bước công việc để tự chạy (n8n, workflow, skill).', re: /\b(workflows?|automation|n8n|zapier|skills?)\b/i },
  { id: 'ocr', name: 'Đọc tài liệu (OCR)', can: 'AI đọc chữ trong ảnh chụp, giấy tờ, PDF', what: 'AI đọc PDF, ảnh chụp giấy tờ và chuyển thành chữ có cấu trúc.', re: /\b(ocr|document (?:parsing|understanding)|pdfs?)\b/i },
  { id: 'safety', name: 'An toàn và bảo mật AI', can: 'lớp kiểm soát chặn AI trả lời sai, làm bậy', what: 'Ngăn AI bị lừa, bị lạm dụng hoặc làm điều có hại.', re: /\b(safety|alignment|jailbreak\w*|guardrails?|red[- ]team\w*|prompt injection)\b/i },
];

// Ids of the technologies a piece of text talks about.
export const techIds = (text) => TECH.filter((t) => t.re.test(text)).map((t) => t.id);

export const getTech = cached(60 * 60e3, async () => {
  const [news, repos, tools] = await Promise.all([
    getNews(),
    getRepos().catch(() => ({ trending: [], rising: [] })),
    getTools().catch(() => ({ models: [], spaces: [] })),
  ]);
  const week = news.items.filter((it) => Date.now() - Date.parse(it.date) <= 7 * DAY);
  const repoList = [...repos.trending, ...repos.rising];
  const hfList = [...tools.models.map((m) => ({ ...m, text: `${m.id} ${m.task ?? ''} ${m.tags.join(' ')}` })), ...tools.spaces.map((s) => ({ ...s, text: `${s.id} ${s.title} ${s.description} ${s.tags.join(' ')}` }))];

  const techs = TECH.map(({ re, ...t }) => {
    const repoHits = repoList.filter((r) => re.test(`${r.name.replace(/[/_-]/g, ' ')} ${r.description} ${(r.topics ?? []).join(' ')}`));
    const newsHits = week.filter((it) => re.test(`${it.title} ${it.summary}`));
    const hfHits = hfList.filter((h) => re.test(h.text.replace(/[/_-]/g, ' ')));
    return {
      ...t,
      repos: repoHits.length,
      news: newsHits.length,
      hf: hfHits.length,
      total: repoHits.length + newsHits.length + hfHits.length,
      examples: repoHits.slice(0, 3).map((r) => ({ name: r.name, url: r.url })),
      headline: newsHits[0] ? { title: newsHits[0].title, titleVi: newsHits[0].titleVi, url: newsHits[0].url, source: newsHits[0].sourceName } : null,
    };
  })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);

  return { generatedAt: new Date().toISOString(), techs };
});
