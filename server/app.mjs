import { fileURLToPath } from 'node:url';
import core from './core.cjs';

export const { ApiError, createVocabServer, handleApiRequest } = core;

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const port = parsePort(process.env.PORT ?? '4173');
  const host = process.env.HOST ?? '127.0.0.1';
  const app = createVocabServer({
    catalogPath: process.env.VOCAB_DB_PATH,
    progressPath: process.env.PROGRESS_DB_PATH,
    distDir: process.env.DIST_DIR,
    apiEditPassword: process.env.API_EDIT_PASSWORD,
    hermesApiUrl: process.env.HERMES_API_URL,
    hermesApiKey: process.env.HERMES_API_KEY,
    hermesApiModel: process.env.HERMES_API_MODEL,
    hermesSessionKey: process.env.HERMES_SESSION_KEY,
  });

  try {
    const address = await app.listen(port, host);
    console.log(`Vocabulary app running at http://${host}:${address.port}`);
    console.log(`Catalog (read-only): ${app.catalogPath}`);
    console.log(`Progress: ${app.progressPath}`);
    console.log(`Hermes Gateway: ${app.runtimeAiConfig.getGateway() ? 'configured' : 'CLI fallback'}`);
  } catch (error) {
    console.error('Unable to start vocabulary app:', error);
    await app.close();
    process.exitCode = 1;
  }

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    try {
      await app.close();
      console.log(`Vocabulary app stopped (${signal})`);
    } catch (error) {
      console.error('Unable to stop vocabulary app cleanly:', error);
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error('PORT must be an integer from 0 to 65535');
  }
  return parsed;
}
