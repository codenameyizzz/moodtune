import { spawn } from 'node:child_process';

const processes = [];

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      shutdown(code ?? 1);
    }
  });

  processes.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const processHandle of processes) {
    if (!processHandle.killed) {
      processHandle.kill();
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('server', 'node', ['server/index.mjs']);
start('client', 'npm', ['run', 'dev:client']);
