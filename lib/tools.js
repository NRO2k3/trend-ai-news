import { translate } from './translate.js';
import { cached, fetchJSON, truncate } from './util.js';

// Hugging Face task ids → what the model does, in plain Vietnamese.
export const TASKS = {
  'text-generation': 'Chatbot, viết văn bản',
  'image-text-to-text': 'Hiểu ảnh và chữ',
  'text-to-image': 'Tạo ảnh từ chữ',
  'image-to-image': 'Sửa ảnh',
  'image-to-video': 'Tạo video từ ảnh',
  'text-to-video': 'Tạo video từ chữ',
  'text-to-speech': 'Đọc chữ thành giọng nói',
  'automatic-speech-recognition': 'Nghe và chép lời',
  'image-to-3d': 'Tạo mô hình 3D',
  'text-to-3d': 'Tạo mô hình 3D',
  'feature-extraction': 'Tìm kiếm theo nghĩa',
  'sentence-similarity': 'So sánh nghĩa câu',
  'any-to-any': 'Đa năng: chữ, ảnh, âm thanh',
  'text-to-audio': 'Tạo âm thanh, nhạc',
  'audio-text-to-text': 'Hiểu âm thanh',
  'image-classification': 'Phân loại ảnh',
  'object-detection': 'Nhận diện vật thể',
  'image-segmentation': 'Tách vật thể trong ảnh',
  'depth-estimation': 'Đo độ sâu ảnh',
  translation: 'Dịch thuật',
  robotics: 'Điều khiển robot',
  'video-text-to-text': 'Hiểu video',
  'visual-document-retrieval': 'Tìm trong tài liệu',
  'text-ranking': 'Xếp hạng kết quả tìm kiếm',
};

// What a web developer can put behind an API: chat/coding models, vision for
// screenshots and documents, embeddings and rerankers for search, speech-to-text.
const DEV_TASKS = new Set([
  'text-generation', 'image-text-to-text', 'any-to-any', 'feature-extraction', 'sentence-similarity',
  'text-ranking', 'visual-document-retrieval', 'automatic-speech-recognition', 'translation', 'video-text-to-text',
]);
// Image, video, music and 3D generation demos and model-training guides: nothing to build a web product on.
const MEDIA = /\b(text-to-(?:image|video|speech|audio|3d)|image[- ](?:generat\w*|edit\w*|to-image|to-video)|video\w*|photo\w*|portraits?|avatars?|anime|art|music|songs?|voice[- ]clon\w*|tts|3d|try-?on|upscal\w*|background remov\w*|lora|diffusion|flux|wan[\d.]*|sdxl|i2v|t2v|t2i|qwen-image|z-image|images?|splat\w*|(?:pre-?)?training|handbook|playbook|robot\w*|humanoids?|unitree)\b|训练/i;

// Community re-uploads that strip safety training, deepfake tools and the like.
const BLOCK = /uncensor|abliterat|heretic|nsfw|porn|nud(e|ify)|undress|face[- ]?swap|deepfake|erotic|lewd/i;

export const getTools = cached(60 * 60e3, async () => {
  const [rawModels, rawSpaces] = await Promise.all([
    fetchJSON('https://huggingface.co/api/models?sort=trendingScore&limit=150'),
    fetchJSON('https://huggingface.co/api/spaces?sort=trendingScore&limit=150&full=true'),
  ]);

  const models = rawModels
    .filter((m) => !BLOCK.test(m.id) && DEV_TASKS.has(m.pipeline_tag) && !MEDIA.test(m.id))
    .slice(0, 24)
    .map((m) => ({
      id: m.id,
      author: m.id.split('/')[0],
      task: m.pipeline_tag ?? null,
      taskVi: TASKS[m.pipeline_tag] ?? null,
      likes: m.likes ?? 0,
      downloads: m.downloads ?? 0,
      tags: (m.tags ?? []).filter((t) => !t.includes(':')).slice(0, 12),
      created: m.createdAt,
      url: `https://huggingface.co/${m.id}`,
    }));

  const spaces = rawSpaces
    .map((s) => ({
      id: s.id,
      author: s.id.split('/')[0],
      title: s.cardData?.title ?? s.id.split('/')[1],
      emoji: s.cardData?.emoji ?? '',
      description: truncate((s.cardData?.short_description ?? '').replace(/\s+/g, ' '), 200),
      likes: s.likes ?? 0,
      tags: (s.tags ?? []).filter((t) => !t.includes(':')).slice(0, 12),
      url: `https://huggingface.co/spaces/${s.id}`,
    }))
    // A space with no description can't tell a developer what it is for.
    .filter((s) => s.description && !BLOCK.test(`${s.id} ${s.title} ${s.description}`) && !MEDIA.test(`${s.id} ${s.title} ${s.description} ${s.tags.join(' ')}`))
    .slice(0, 20);

  const vi = await translate(spaces.map((s) => s.description));
  for (const s of spaces) s.descriptionVi = vi(s.description);

  return { generatedAt: new Date().toISOString(), models, spaces };
});
