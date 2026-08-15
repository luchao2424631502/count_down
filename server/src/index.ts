/**
 * index.ts — Express 入口
 *
 * - CORS 开启（移动端 PWA 跨域调用）
 * - JSON 中间件
 * - 挂载 /api 路由（countdowns / categories / sync）
 */
import express from 'express';
import cors from 'cors';
import { initSchema } from './db.js';
import countdownsRouter from './routes/countdowns.js';
import categoriesRouter from './routes/categories.js';
import syncRouter from './routes/sync.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// CORS：自用 PWA，放开全部来源（如需收紧可在生产环境配置白名单）
app.use(cors());
app.use(express.json());

// 初始化数据库表结构（幂等）
initSchema();

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'countdown-server', time: new Date().toISOString() });
});

// 业务路由
app.use('/api/countdowns', countdownsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api', syncRouter);

// 统一 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 统一错误处理
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
);

app.listen(PORT, () => {
  console.log(`countdown-server 已启动: http://localhost:${PORT} (api base /api)`);
});
