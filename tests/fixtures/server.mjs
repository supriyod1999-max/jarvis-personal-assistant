import { createApplication } from '../../server/index.mjs';
import { fixtureHermes } from './hermes.mjs';
const app = createApplication({ hermes: fixtureHermes() });
app.listen();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void app.close().then(() => process.exit(0)));
