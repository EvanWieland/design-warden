import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInspector } from './app.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { port: { type: 'string', default: '4400' } } });
const port = Number(values.port);

const server = createInspector({
  port,
  staticDir: path.resolve(here, '..', 'dist'),
  demoPolicy: path.resolve(here, '..', '..', 'demo', 'design-warden.policy.json'),
});
// Loopback only: the service runs analyses and must not be reachable from the network.
server.listen(port, '127.0.0.1', () => {
  console.log(`Design Warden inspector: http://127.0.0.1:${port}  (Ctrl+C to stop)`);
});
