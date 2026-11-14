import { getNews } from './news.js';
import { getModels } from './models.js';
import { getPapers } from './papers.js';
import { getProgress } from './progress.js';

// Every dataset the page reads, by the name of its /data/<name>.json file.
export const DATA = { news: getNews, models: getModels, papers: getPapers, progress: getProgress };
