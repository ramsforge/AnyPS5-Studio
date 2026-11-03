import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr.trim().slice(-300)}`))
    );
  });
}

// Paths go in as separate arguments (or environment variables for PowerShell), never through a shell
// string, so usernames like O'Brien or paths with spaces and quotes cannot break or inject into the command.
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform !== 'win32') {
    return run('unzip', ['-q', '-o', zipPath, '-d', destDir]);
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  try {
    // The Windows tar (bsdtar) reads zip files; a GNU tar earlier on PATH (e.g. from Git) does not.
    await run(path.join(systemRoot, 'System32', 'tar.exe'), ['-xf', zipPath, '-C', destDir]);
  } catch {
    await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:APS5_ZIP -DestinationPath $env:APS5_DEST -Force'],
      { ...process.env, APS5_ZIP: zipPath, APS5_DEST: destDir }
    );
  }
}
