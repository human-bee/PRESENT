import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { createConductorRouter } from './router';
import { startConductorWorker } from './worker';

dotenvConfig({ path: join(process.cwd(), '.env.local') });

const router = createConductorRouter();

void startConductorWorker(router.executeTask);
