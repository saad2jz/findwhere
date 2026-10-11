import 'dotenv/config';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
createApp().listen(port, host, () => console.log(`Findwhere API: http://${host}:${port}`));
