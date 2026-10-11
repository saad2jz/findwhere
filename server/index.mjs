import 'dotenv/config';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server = createApp().listen(port, host, () =>
  console.log(`Findwhere API: http://${host}:${port}`),
);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 70000).unref();
  });
}
