/** Server entry point: builds the app and listens on localhost only (never exposed to the network). */
import path from 'node:path';
import { buildApp } from './app';

export const DEFAULT_PORT = 3210;

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const clientDir = path.join(process.cwd(), 'dist', 'client');

const app = await buildApp({ clientDir, logger: true });
await app.listen({ port, host: '127.0.0.1' });
