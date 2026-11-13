import { spawn } from 'node:child_process';

const server = spawn('npm', ['run', 'dev', '-w', 'server'], { stdio: 'inherit', shell: true });
const client = spawn('npm', ['run', 'dev', '-w', 'client'], { stdio: 'inherit', shell: true });

function cleanup() {
  server.kill('SIGINT');
  client.kill('SIGINT');
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
