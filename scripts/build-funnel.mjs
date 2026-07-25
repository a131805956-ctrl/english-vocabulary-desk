import { spawnSync } from 'node:child_process';

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) {
  throw new Error('build:funnel must be started through npm');
}

const result = spawnSync(process.execPath, [npmCliPath, 'run', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_BASE_PATH: '/eng-vocabulary/',
  },
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
