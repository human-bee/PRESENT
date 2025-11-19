import http from 'node:http';
import { streamTeacherAgent } from '@/lib/canvas-agent/teacher-runtime/service';
import type { TeacherPromptContext } from '@/lib/canvas-agent/teacher-runtime/prompt';

const PORT = Number(process.env.TEACHER_WORKER_PORT ?? process.env.PORT ?? 8787);
const HOST = process.env.TEACHER_WORKER_HOST ?? '127.0.0.1';

const readBody = (req: http.IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => reject(error));
  });
};

const sendJson = (res: http.ServerResponse, statusCode: number, payload: Record<string, unknown>) => {
  if (!res.headersSent) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(payload));
};

const handleTeacherStream = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  let context: TeacherPromptContext | null = null;
  try {
    const raw = await readBody(req);
    context = raw ? (JSON.parse(raw) as TeacherPromptContext) : null;
  } catch (error) {
    console.error('[TeacherWorker:InvalidBody]', {
      error: error instanceof Error ? error.message : error,
    });
    sendJson(res, 400, { error: 'invalid JSON body' });
    return;
  }

  if (!context || !Array.isArray(context.userMessages)) {
    sendJson(res, 400, { error: 'missing userMessages in teacher context' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    for await (const event of streamTeacherAgent(context)) {
      res.write(`${JSON.stringify(event)}\n`);
    }
  } catch (error) {
    console.error('[TeacherWorker:StreamError]', {
      error: error instanceof Error ? error.message : error,
    });
  } finally {
    res.end();
  }
};

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url === '/healthz') {
    sendJson(res, 200, { ok: true, uptime: process.uptime() });
    return;
  }

  if (req.method === 'POST' && url.startsWith('/teacher/stream')) {
    await handleTeacherStream(req, res);
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[TeacherWorker] listening on http://${HOST}:${PORT}`);
});

const closeServer = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
