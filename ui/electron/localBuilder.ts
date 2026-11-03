import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { once } from 'events';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { extractZip } from './archive';
import readline from 'readline';
import {
  ToolchainStatus,
  ToolchainInspectionResult,
  ToolchainInstallProgress,
  SourceSyncStatus,
  BuilderLogMessage,
  BuildProgressStatus,
  BuildResult,
  MultiPRBuildResult,
} from '../src/types';
import { RuntimeManager } from './runtimeManager';

// Pinned downloads for the managed Windows toolchain. Hashes come from the publishers: Kitware's
// cmake-3.31.5-SHA-256.txt, WinLibs' .zip.sha256 (matches GitHub's asset digest) and GitHub's asset digest for
// Ninja. A download that does not match is deleted before anything is extracted or run.
const TOOLCHAIN_DOWNLOADS = {
  ninja: {
    url: 'https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-win.zip',
    sha256: '07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65',
  },
  cmake: {
    url: 'https://github.com/Kitware/CMake/releases/download/v3.31.5/cmake-3.31.5-windows-x86_64.zip',
    sha256: 'd4d2d4b9ccd68dae975a066fcd42ea9807ef40f79ee6971923fd3788e7917585',
  },
  winlibs: {
    url: 'https://github.com/brechtsanders/winlibs_mingw/releases/download/15.2.0posix-14.0.0-ucrt-r7/winlibs-x86_64-posix-seh-gcc-15.2.0-mingw-w64ucrt-14.0.0-r7.zip',
    sha256: 'cb2fbad6162540cdf5e1facdce08d4dac359e8cf64f7f696a99274291763b815',
  },
};

export class LocalBuilderService {
  private userDataDir: string;
  private toolsDir: string;
  private toolsBinDir: string;
  private sourceDir: string;
  private runtimesDir: string;
  private activeProcess: ChildProcess | null = null;
  private isBuilding: boolean = false;
  private isSyncing: boolean = false;
  private activePRNumber: number | null = null;
  private recentLogs: BuilderLogMessage[] = [];

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir;
    this.toolsDir = path.join(userDataDir, 'tools');
    this.toolsBinDir = path.join(this.toolsDir, 'bin');
    this.sourceDir = path.join(userDataDir, 'source', 'AnyPS5');
    this.runtimesDir = path.join(userDataDir, 'runtimes');

    // Ensure directories exist
    if (!fs.existsSync(this.toolsDir)) {
      fs.mkdirSync(this.toolsDir, { recursive: true });
    }
    if (!fs.existsSync(this.toolsBinDir)) {
      fs.mkdirSync(this.toolsBinDir, { recursive: true });
    }
  }

  /**
   * Resolve tool paths with priority given to managed tools in %APPDATA%/anyps5-ui/tools/
   */
  private findExecutable(cmd: string, altNames: string[] = []): { path: string; isManaged: boolean } | null {
    const isWin = process.platform === 'win32';
    const names = [cmd, ...altNames].map((n) => (isWin && !n.endsWith('.exe') ? `${n}.exe` : n));

    // 1. Check managed tools directory structure
    // Install trees first: cmake.exe and g++.exe only work from their own folder (older versions of Studio
    // copied them into tools/bin, where they cannot find CMAKE_ROOT or the compiler internals).
    const managedSearchDirs = [
      path.join(this.toolsDir, 'cmake', 'bin'),
      path.join(this.toolsDir, 'mingw64', 'bin'),
      path.join(this.toolsDir, 'ninja'),
      path.join(this.toolsDir, 'git', 'cmd'),
      path.join(this.toolsDir, 'python'),
      this.toolsBinDir,
    ];

    for (const dir of managedSearchDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of names) {
        const full = path.join(dir, name);
        if (fs.existsSync(full)) {
          return { path: full, isManaged: true };
        }
      }
    }

    // 2. Check system PATH via where (Windows) or which (Unix)
    for (const name of names) {
      try {
        const out = (spawnSync(isWin ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true }).stdout || '').trim();
        const firstLine = out.split(/\r?\n/)[0]?.trim();
        if (firstLine && fs.existsSync(firstLine)) {
          const isManaged = firstLine.toLowerCase().startsWith(this.toolsDir.toLowerCase());
          return { path: firstLine, isManaged };
        }
      } catch {
        // Not in PATH
      }
    }

    return null;
  }

  /**
   * Run tool --version and parse cleanly
   */
  private getToolVersion(execPath: string, args: string[] = ['--version']): string | undefined {
    try {
      const res = spawnSync(execPath, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 6000 });
      if (res.status === 0 || res.stdout.length > 0) {
        const out = res.stdout.toString().trim() || res.stderr.toString().trim();
        const firstLine = out.split(/\r?\n/)[0]?.trim();
        if (!firstLine) return undefined;

        // If compiler output contains parenthetical build info (e.g. `g++ (MinGW-W64 ...) 15.2.0`),
        // extract the concise version number:
        const parenVersionMatch = firstLine.match(/\([^)]+\)\s*([0-9]+(?:\.[0-9]+)+[a-zA-Z0-9._-]*)/);
        if (parenVersionMatch) {
          return parenVersionMatch[1];
        }

        // For clang: `clang version 18.1.8 ...` -> extract concise version
        const clangMatch = firstLine.match(/clang(?:\+\+)?\s+version\s+([0-9]+(?:\.[0-9]+)+[a-zA-Z0-9._-]*)/i);
        if (clangMatch) {
          return clangMatch[1];
        }

        // For MSVC: `Microsoft (R) C/C++ Optimizing Compiler Version 19.xx.xxxxx for x64`
        const msvcMatch = firstLine.match(/Version\s+([0-9]+(?:\.[0-9]+)+)/i);
        if (msvcMatch && firstLine.toLowerCase().includes('compiler')) {
          return msvcMatch[1];
        }

        return firstLine;
      }
    } catch {
      // Ignored
    }
    return undefined;
  }

  /**
   * Inspect all build toolchain dependencies
   */
  public async inspectToolchain(): Promise<ToolchainInspectionResult> {
    const tools: ToolchainStatus[] = [];

    // 1. Git
    const gitExec = this.findExecutable('git');
    const gitVersion = gitExec ? this.getToolVersion(gitExec.path, ['--version']) : undefined;
    tools.push({
      name: 'Git',
      command: 'git',
      version: gitVersion,
      path: gitExec?.path,
      isManaged: gitExec?.isManaged ?? false,
      isAvailable: Boolean(gitExec && gitVersion),
    });

    // 2. Python 3
    let pyExec = this.findExecutable('python', ['py', 'python3']);
    let pyVersion = pyExec ? this.getToolVersion(pyExec.path, ['--version']) : undefined;
    if (!pyVersion && process.platform === 'win32') {
      const pyAlt = this.findExecutable('py');
      if (pyAlt) {
        pyExec = pyAlt;
        pyVersion = this.getToolVersion(pyAlt.path, ['-3', '--version']) || this.getToolVersion(pyAlt.path, ['--version']);
      }
    }
    tools.push({
      name: 'Python 3',
      command: 'python',
      version: pyVersion,
      path: pyExec?.path,
      isManaged: pyExec?.isManaged ?? false,
      isAvailable: Boolean(pyExec && pyVersion),
    });

    // 3. CMake
    const cmakeExec = this.findExecutable('cmake');
    const cmakeVersion = cmakeExec ? this.getToolVersion(cmakeExec.path, ['--version']) : undefined;
    tools.push({
      name: 'CMake',
      command: 'cmake',
      version: cmakeVersion,
      path: cmakeExec?.path,
      isManaged: cmakeExec?.isManaged ?? false,
      isAvailable: Boolean(cmakeExec && cmakeVersion),
    });

    // 4. Ninja
    const ninjaExec = this.findExecutable('ninja');
    const ninjaVersion = ninjaExec ? this.getToolVersion(ninjaExec.path, ['--version']) : undefined;
    tools.push({
      name: 'Ninja',
      command: 'ninja',
      version: ninjaVersion,
      path: ninjaExec?.path,
      isManaged: ninjaExec?.isManaged ?? false,
      isAvailable: Boolean(ninjaExec && ninjaVersion),
    });

    // 5. C++ Compiler (g++, clang++, or cl)
    let cxxExec = this.findExecutable('g++', ['clang++', 'clang-cl', 'cl']);
    let cxxVersion = cxxExec ? this.getToolVersion(cxxExec.path, ['--version']) : undefined;
    if (cxxExec && !cxxVersion && cxxExec.path.toLowerCase().endsWith('cl.exe')) {
      cxxVersion = this.getToolVersion(cxxExec.path, []);
    }
    tools.push({
      name: 'C++ Compiler',
      command: cxxExec?.path.toLowerCase().includes('clang') ? 'clang++' : cxxExec?.path.toLowerCase().includes('cl.exe') ? 'cl' : 'g++',
      version: cxxVersion,
      path: cxxExec?.path,
      isManaged: cxxExec?.isManaged ?? false,
      isAvailable: Boolean(cxxExec && cxxVersion),
    });

    const allRequiredAvailable = tools.every((t) => t.isAvailable);
    return { tools, allRequiredAvailable };
  }

  /**
   * Download and stream a remote file with real chunk-by-chunk progress
   */
  private async downloadFileWithProgress(
    url: string,
    destPath: string,
    toolName: string,
    onProgress: (p: ToolchainInstallProgress) => void,
    expectedSha256: string
  ): Promise<void> {
    const res = await fetch(url, { headers: { 'User-Agent': 'AnyPS5-Studio-Toolchain' }, redirect: 'follow' });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download ${toolName} from ${url} (HTTP ${res.status} ${res.statusText})`);
    }

    const totalBytes = parseInt(res.headers.get('content-length') || '0', 10);
    let transferredBytes = 0;

    const fileStream = fs.createWriteStream(destPath);
    const reader = res.body.getReader();
    const hash = crypto.createHash('sha256');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const chunk = Buffer.from(value);
        hash.update(chunk);
        if (!fileStream.write(chunk)) await once(fileStream, 'drain');
        transferredBytes += value.length;
        const progress = totalBytes > 0 ? Math.min(Math.round((transferredBytes / totalBytes) * 100), 99) : 50;
        onProgress({
          status: 'downloading',
          toolName,
          progress,
          transferredBytes,
          totalBytes,
          message: `Downloading ${toolName} (${(transferredBytes / (1024 * 1024)).toFixed(1)} MB${
            totalBytes ? ` / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB` : ''
          })...`,
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve());
      fileStream.on('error', reject);
    });

    const actualSha256 = hash.digest('hex');
    if (actualSha256 !== expectedSha256) {
      try { fs.unlinkSync(destPath); } catch {}
      throw new Error(
        `${toolName} download failed verification and was deleted (expected SHA-256 ${expectedSha256}, got ${actualSha256}). ` +
          'The file may have been corrupted or tampered with; try again later.'
      );
    }
  }

  /**
   * Install managed portable toolchain into %APPDATA%/anyps5-ui/tools/
   */
  public async installManagedToolchain(
    onProgress: (p: ToolchainInstallProgress) => void
  ): Promise<{ success: boolean; error?: string }> {
    if (process.platform !== 'win32') {
      const error = 'Automatic toolchain install is only available on Windows. Install git, cmake, ninja and a C++ compiler (g++ or clang++) with your package manager.';
      onProgress({ status: 'error', progress: 0, error });
      return { success: false, error };
    }
    try {
      const toolchainStatus = await this.inspectToolchain();
      const needsCMake = !toolchainStatus.tools.find((t) => t.command === 'cmake')?.isAvailable;
      const needsNinja = !toolchainStatus.tools.find((t) => t.command === 'ninja')?.isAvailable;
      const needsCxx = !toolchainStatus.tools.find((t) => t.name === 'C++ Compiler')?.isAvailable;

      if (!needsCMake && !needsNinja && !needsCxx) {
        onProgress({
          status: 'ready',
          progress: 100,
          message: 'All toolchain dependencies are already available and verified.',
        });
        return { success: true };
      }

      // 1. Download & Install Standalone Ninja if needed
      if (needsNinja && !needsCxx) {
        onProgress({ status: 'downloading', toolName: 'Ninja', progress: 5, message: 'Downloading Ninja build system...' });
        const ninjaZip = path.join(this.toolsDir, 'ninja-temp.zip');
        await this.downloadFileWithProgress(TOOLCHAIN_DOWNLOADS.ninja.url, ninjaZip, 'Ninja', onProgress, TOOLCHAIN_DOWNLOADS.ninja.sha256);

        onProgress({ status: 'extracting', toolName: 'Ninja', progress: 90, message: 'Extracting Ninja...' });
        const ninjaTargetDir = path.join(this.toolsDir, 'ninja');
        await extractZip(ninjaZip, ninjaTargetDir);
        try { fs.unlinkSync(ninjaZip); } catch {}

        // Copy ninja.exe to tools/bin
        const ninjaExe = path.join(ninjaTargetDir, 'ninja.exe');
        if (fs.existsSync(ninjaExe)) {
          fs.copyFileSync(ninjaExe, path.join(this.toolsBinDir, 'ninja.exe'));
        }
      }

      // 2. Download & Install Standalone CMake if needed
      if (needsCMake) {
        onProgress({ status: 'downloading', toolName: 'CMake', progress: 5, message: 'Downloading portable CMake...' });
        const cmakeZip = path.join(this.toolsDir, 'cmake-temp.zip');
        await this.downloadFileWithProgress(TOOLCHAIN_DOWNLOADS.cmake.url, cmakeZip, 'CMake', onProgress, TOOLCHAIN_DOWNLOADS.cmake.sha256);

        onProgress({ status: 'extracting', toolName: 'CMake', progress: 90, message: 'Extracting CMake...' });
        const cmakeExtractDir = path.join(this.toolsDir, 'cmake-extracted');
        await extractZip(cmakeZip, cmakeExtractDir);
        try { fs.unlinkSync(cmakeZip); } catch {}

        // Find bin directory inside extracted folder
        const entries = fs.readdirSync(cmakeExtractDir);
        const rootFolder = entries.find((e) => e.toLowerCase().startsWith('cmake-'));

        const destCMake = path.join(this.toolsDir, 'cmake');
        if (fs.existsSync(destCMake)) {
          fs.rmSync(destCMake, { recursive: true, force: true });
        }
        if (rootFolder) {
          fs.renameSync(path.join(cmakeExtractDir, rootFolder), destCMake);
        } else {
          fs.renameSync(cmakeExtractDir, destCMake);
        }
        try { fs.rmSync(cmakeExtractDir, { recursive: true, force: true }); } catch {}
      }

      // 3. Download & Install WinLibs GCC 15 + Ninja if C++ compiler is needed
      if (needsCxx) {
        onProgress({
          status: 'downloading',
          toolName: 'WinLibs MinGW-W64 GCC',
          progress: 5,
          message: 'Downloading WinLibs MinGW-W64 GCC 15 + Ninja portable toolchain...',
        });
        const winlibsZip = path.join(this.toolsDir, 'winlibs-temp.zip');
        await this.downloadFileWithProgress(TOOLCHAIN_DOWNLOADS.winlibs.url, winlibsZip, 'WinLibs MinGW-W64 GCC', onProgress, TOOLCHAIN_DOWNLOADS.winlibs.sha256);

        onProgress({
          status: 'extracting',
          toolName: 'WinLibs MinGW-W64 GCC',
          progress: 90,
          message: 'Extracting WinLibs MinGW-W64 compiler & Ninja tools...',
        });
        await extractZip(winlibsZip, this.toolsDir);
        try { fs.unlinkSync(winlibsZip); } catch {}
        // g++/gcc/ninja are used from tools/mingw64/bin directly; copies elsewhere cannot find the compiler internals.
      }

      onProgress({
        status: 'ready',
        progress: 100,
        message: 'Managed toolchain provisioning complete. Build environment ready.',
      });
      return { success: true };
    } catch (err: any) {
      console.error('installManagedToolchain error:', err);
      const errMsg = err?.message || String(err);
      onProgress({ status: 'error', progress: 0, error: errMsg });
      return { success: false, error: errMsg };
    }
  }

  /**
   * Get upstream source status in %APPDATA%/anyps5-ui/source/AnyPS5/
   */
  public async getSourceStatus(): Promise<SourceSyncStatus> {
    const repoUrl = 'https://github.com/boykopovar/AnyPS5.git';
    const gitDir = path.join(this.sourceDir, '.git');

    if (!fs.existsSync(gitDir)) {
      return {
        exists: false,
        repoUrl,
        isSyncing: this.isSyncing,
      };
    }

    try {
      const shaRes = this.runGit(['rev-parse', 'HEAD']);
      const currentCommit = shaRes.stdout.trim();
      const shortCommit = currentCommit.substring(0, 7);

      const msgRes = this.runGit(['log', '-1', '--pretty=format:%s']);
      const commitMessage = msgRes.stdout.trim();

      const branchRes = this.runGit(['branch', '--show-current']);
      const branch = branchRes.stdout.trim() || 'main';

      const submodulesReady =
        fs.existsSync(path.join(this.sourceDir, '3rdparty', 'SDL2', 'CMakeLists.txt')) &&
        fs.existsSync(path.join(this.sourceDir, '3rdparty', 'ffmpeg-core', 'CMakeLists.txt'));

      return {
        exists: true,
        repoUrl,
        currentCommit,
        shortCommit,
        commitMessage,
        branch,
        submodulesReady,
        isSyncing: this.isSyncing,
      };
    } catch {
      return {
        exists: true,
        repoUrl,
        isSyncing: this.isSyncing,
      };
    }
  }

  /**
   * Clone or pull upstream AnyPS5 repository and submodules
   */
  public async syncSource(
    onLog: (msg: BuilderLogMessage) => void
  ): Promise<{ success: boolean; commit?: string; error?: string }> {
    if (this.isSyncing) {
      return { success: false, error: 'Source synchronization is already in progress.' };
    }
    this.isSyncing = true;

    try {
      const gitDir = path.join(this.sourceDir, '.git');
      const isClone = !fs.existsSync(gitDir);

      if (isClone) {
        if (!fs.existsSync(this.sourceDir)) {
          fs.mkdirSync(this.sourceDir, { recursive: true });
        }
        onLog({
          text: `[Git] Initializing clone from https://github.com/boykopovar/AnyPS5.git into ${this.sourceDir}...`,
          type: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });

        await this.runProcess(
          'git',
          ['clone', '--recurse-submodules', 'https://github.com/boykopovar/AnyPS5.git', '.'],
          this.sourceDir,
          onLog
        );
      } else {
        // Run repository self-healing routine before touching remote refs
        await this.sanitizeRepositoryState(onLog);

        onLog({
          text: `[Git] Fetching latest changes from origin/main...`,
          type: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });

        await this.runProcess('git', ['fetch', 'origin', 'main'], this.sourceDir, onLog);

        onLog({
          text: `[Git] Aligning local main with origin/main...`,
          type: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });

        await this.runProcess('git', ['reset', '--hard', 'origin/main'], this.sourceDir, onLog);

        onLog({
          text: `[Git] Synchronizing repository submodules...`,
          type: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });

        this.cleanGitLocks(gitDir);

        await this.runProcess('git', ['submodule', 'update', '--init', '--recursive'], this.sourceDir, onLog);
        await this.runProcess('git', ['submodule', 'foreach', '--recursive', 'git checkout -f'], this.sourceDir, onLog);
      }

      const shaRes = this.runGit(['rev-parse', 'HEAD']);
      const headSha = shaRes.stdout.trim();
      onLog({
        text: `[Git] Source tree synchronized at commit ${headSha.substring(0, 7)}.`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      return { success: true, commit: headSha };
    } catch (err: any) {
      console.error('syncSource error:', err);
      const errMsg = err?.message || String(err);
      onLog({ text: `[Git Error] ${errMsg}`, type: 'error', timestamp: new Date().toLocaleTimeString() });
      return { success: false, error: errMsg };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Resolve environment with managed build tools on PATH
   */
  private getToolchainEnv(extraEnv?: Record<string, string>): Record<string, string> {
    const managedPaths = [
      path.join(this.toolsDir, 'cmake', 'bin'),
      path.join(this.toolsDir, 'ninja'),
      path.join(this.toolsDir, 'mingw64', 'bin'),
      path.join(this.toolsDir, 'git', 'cmd'),
      path.join(this.toolsDir, 'git', 'bin'),
      this.toolsBinDir,
    ].filter((p) => fs.existsSync(p));

    const existingPath = process.env.PATH || '';
    const combinedPath = [...managedPaths, existingPath].join(path.delimiter);

    return {
      ...process.env,
      ...extraEnv,
      PATH: combinedPath,
    };
  }

  /**
   * Recursively clean any stale .lock files inside .git or submodule directories
   */
  private cleanGitLocks(dir: string): void {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.lock')) {
          try {
            fs.unlinkSync(full);
          } catch {}
        } else if (entry.isDirectory()) {
          this.cleanGitLocks(full);
        }
      }
    } catch {}
  }

  /**
   * Synchronous helper for low-overhead Git inspection and execution
   */
  private runGit(
    args: string[],
    cwd: string = this.sourceDir
  ): { status: number | null; stdout: string; stderr: string } {
    const env = this.getToolchainEnv();
    const res = spawnSync('git', args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return {
      status: res.status,
      stdout: (res.stdout || '').toString(),
      stderr: (res.stderr || '').toString(),
    };
  }

  /**
   * Automated repository self-healing routine to prevent unmerged/locked git state
   */
  private async sanitizeRepositoryState(onLog?: (msg: BuilderLogMessage) => void): Promise<void> {
    const gitDir = path.join(this.sourceDir, '.git');
    if (!fs.existsSync(this.sourceDir) || !fs.existsSync(gitDir)) {
      return;
    }

    const log = (text: string, type: BuilderLogMessage['type'] = 'info') => {
      if (onLog) {
        onLog({ text, type, timestamp: new Date().toLocaleTimeString() });
      }
    };

    log('[Git] Performing repository self-healing and worktree cleanup...');

    // Step A: Remove any stale lock files (.git/*.lock, .git/index.lock, etc.)
    this.cleanGitLocks(gitDir);

    // Step B: Check for in-progress operations and abort them
    try {
      const mergeHead = path.join(gitDir, 'MERGE_HEAD');
      const rebaseMerge = path.join(gitDir, 'rebase-merge');
      const rebaseApply = path.join(gitDir, 'rebase-apply');
      const hasActiveMerge = fs.existsSync(mergeHead);
      const hasActiveRebase = fs.existsSync(rebaseMerge) || fs.existsSync(rebaseApply);

      const abortMergeRes = this.runGit(['merge', '--abort']);
      if (hasActiveMerge || abortMergeRes.status === 0) {
        log('[Git] Incomplete merge operation detected and aborted cleanly.', 'info');
      }

      const abortRebaseRes = this.runGit(['rebase', '--abort']);
      if (hasActiveRebase || abortRebaseRes.status === 0) {
        log('[Git] Incomplete rebase operation detected and aborted cleanly.', 'info');
      }
    } catch {}

    // Step C: Discard dirty modifications and conflict markers
    try {
      const resetRes = this.runGit(['reset', '--hard']);
      if (resetRes.status === 0 && resetRes.stdout.trim()) {
        log(`[Git] Reset to HEAD: ${resetRes.stdout.trim()}`);
      }
      const cleanRes = this.runGit(['clean', '-fd']);
      if (cleanRes.status === 0 && cleanRes.stdout.trim()) {
        log(`[Git] Cleaned untracked artifacts: ${cleanRes.stdout.trim()}`);
      }
    } catch (err: any) {
      log(`[Git] Reset notice: ${err?.message || err}`, 'info');
    }

    // Step D: Ensure repository is anchored to the primary branch
    try {
      const checkoutRes = this.runGit(['checkout', '-f', 'main']);
      if (checkoutRes.status === 0) {
        log('[Git] Worktree safely anchored to main branch.');
      } else {
        const fallbackRes = this.runGit(['checkout', '-B', 'main', 'origin/main']);
        if (fallbackRes.status === 0) {
          log('[Git] Initialized and anchored to main branch.');
        } else {
          log(`[Git] Branch anchor notice: ${checkoutRes.stderr.trim() || checkoutRes.stdout.trim()}`, 'info');
        }
      }
    } catch (err: any) {
      log(`[Git] Branch anchor notice: ${err?.message || err}`, 'info');
    }

    // Final lock sweep in case git operations left locks
    this.cleanGitLocks(gitDir);
  }

  /**
   * Helper to spawn process and stream line-by-line output
   */
  private runProcess(
    command: string,
    args: string[],
    cwd: string,
    onLog: (msg: BuilderLogMessage) => void,
    extraEnv?: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = this.getToolchainEnv(extraEnv);

      // No shell: arguments reach git/cmake exactly as given instead of being re-parsed by cmd.exe.
      const child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
      });
      this.activeProcess = child;

      if (child.stdout) {
        const rlOut = readline.createInterface({ input: child.stdout });
        rlOut.on('line', (line) => {
          onLog({ text: line, type: 'stdout', timestamp: new Date().toLocaleTimeString() });
        });
      }

      if (child.stderr) {
        const rlErr = readline.createInterface({ input: child.stderr });
        rlErr.on('line', (line) => {
          onLog({ text: line, type: 'stderr', timestamp: new Date().toLocaleTimeString() });
        });
      }

      child.on('error', (err) => {
        this.activeProcess = null;
        reject(err);
      });

      child.on('close', (code) => {
        this.activeProcess = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process "${command} ${args.join(' ')}" exited with code ${code}.`));
        }
      });
    });
  }

  /**
   * Cancel active build or sync process
   */
  public cancelBuild(): { success: boolean } {
    if (this.activeProcess && !this.activeProcess.killed) {
      try {
        if (process.platform === 'win32' && this.activeProcess.pid) {
          spawnSync('taskkill', ['/pid', String(this.activeProcess.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else {
          this.activeProcess.kill('SIGTERM');
        }
      } catch {
        try { this.activeProcess.kill('SIGKILL'); } catch {}
      }
      this.activeProcess = null;
    }
    this.isBuilding = false;
    this.isSyncing = false;
    this.activePRNumber = null;
    return { success: true };
  }

  /**
   * Run local CMake + Ninja compilation for relinker and PRX libraries
   */
  public async startBuild(
    runtimeManager: RuntimeManager,
    onLog: (msg: BuilderLogMessage) => void,
    onStatus: (status: BuildProgressStatus) => void
  ): Promise<BuildResult> {
    if (this.isBuilding) {
      return { success: false, error: 'A local build is already in progress.' };
    }
    this.isBuilding = true;
    this.activePRNumber = null;
    this.recentLogs = [];
    const logWrapper = (msg: BuilderLogMessage) => {
      this.recentLogs.push(msg);
      if (this.recentLogs.length > 500) this.recentLogs.shift();
      onLog(msg);
    };

    try {
      if (!fs.existsSync(this.sourceDir) || !fs.existsSync(path.join(this.sourceDir, '.git'))) {
        throw new Error('Upstream repository source is not checked out. Please synchronize source first.');
      }

      // Verify submodules exist, self-heal if missing
      const submodulesIntact =
        fs.existsSync(path.join(this.sourceDir, '3rdparty', 'SDL2', 'CMakeLists.txt')) &&
        fs.existsSync(path.join(this.sourceDir, '3rdparty', 'ffmpeg-core', 'CMakeLists.txt'));

      if (!submodulesIntact) {
        onStatus({
          status: 'configuring',
          progress: 5,
          message: 'Initializing and repairing submodules (SDL2, ffmpeg-core, etc.)...',
        });
        onLog({
          text: '[Git] Missing submodules detected (SDL2, ffmpeg-core, etc.). Synchronizing submodules...',
          type: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });

        this.cleanGitLocks(path.join(this.sourceDir, '.git'));

        await this.runProcess('git', ['submodule', 'update', '--init'], this.sourceDir, onLog);
        await this.runProcess('git', ['submodule', 'foreach', '--recursive', 'git checkout -f'], this.sourceDir, onLog);
      }

      onStatus({
        status: 'configuring',
        progress: 10,
        message: 'Configuring project with CMake and Ninja generator...',
      });
      onLog({
        text: `[CMake] Starting configuration: cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DANYPS5_BUILD_TESTS=OFF`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      // 1. CMake Configure
      await this.runProcess(
        'cmake',
        ['-S', '.', '-B', 'build', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DANYPS5_BUILD_TESTS=OFF'],
        this.sourceDir,
        onLog
      );

      // 2. Build target relinker
      onStatus({
        status: 'building',
        progress: 40,
        message: 'Compiling target "relinker"...',
      });
      onLog({
        text: `[CMake] Building relinker executable: cmake --build build --target relinker`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      await this.runProcess('cmake', ['--build', 'build', '--target', 'relinker'], this.sourceDir, onLog);

      // 3. Build target libs
      onStatus({
        status: 'building',
        progress: 75,
        message: 'Compiling target "libs" (Clean-room PRX system libraries)...',
      });
      onLog({
        text: `[CMake] Building PRX libraries: cmake --build build --target libs`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      await this.runProcess('cmake', ['--build', 'build', '--target', 'libs'], this.sourceDir, onLog);

      // 4. Staging
      onStatus({
        status: 'staging',
        progress: 90,
        message: 'Staging newly compiled binaries and registering runtime profile...',
      });

      const shaRes = this.runGit(['rev-parse', 'HEAD']);
      const fullSha = shaRes.stdout.trim() || 'unknown';
      const shortSha = fullSha.substring(0, 7);

      const msgRes = this.runGit(['log', '-1', '--pretty=format:%s']);
      const commitMessage = msgRes.stdout.trim() || `Local build ${shortSha}`;

      const targetDir = path.join(this.runtimesDir, 'commits', `commit-${shortSha}`);
      const targetLibsDir = path.join(targetDir, 'libs');

      if (!fs.existsSync(targetLibsDir)) {
        fs.mkdirSync(targetLibsDir, { recursive: true });
      }

      // Locate relinker executable
      const binName = process.platform === 'win32' ? 'relinker.exe' : 'relinker';
      const possibleRelinkerPaths = [
        path.join(this.sourceDir, 'build', 'core', 'relinker', binName),
        path.join(this.sourceDir, 'build', 'bin', binName),
        path.join(this.sourceDir, 'build', binName),
        path.join(this.sourceDir, 'build', 'Release', binName),
      ];

      let builtRelinker: string | null = null;
      for (const p of possibleRelinkerPaths) {
        if (fs.existsSync(p)) {
          builtRelinker = p;
          break;
        }
      }

      if (!builtRelinker) {
        throw new Error(`Build finished but "${binName}" was not found in build output directories.`);
      }

      const finalRelinkerPath = path.join(targetDir, binName);
      fs.copyFileSync(builtRelinker, finalRelinkerPath);
      if (process.platform !== 'win32') {
        try { fs.chmodSync(finalRelinkerPath, 0o755); } catch {}
      }

      // Locate and copy PRX / DLL libraries
      const searchDirs = [
        path.join(this.sourceDir, 'build', 'core', 'libs', 'libs'),
        path.join(this.sourceDir, 'build', 'core', 'libs'),
        path.join(this.sourceDir, 'build', 'libs'),
        path.join(this.sourceDir, 'build', 'bin'),
      ];

      let copiedLibsCount = 0;
      for (const sDir of searchDirs) {
        if (!fs.existsSync(sDir)) continue;
        const entries = fs.readdirSync(sDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.prx' || ext === '.dll') {
              fs.copyFileSync(path.join(sDir, entry.name), path.join(targetLibsDir, entry.name));
              copiedLibsCount++;
            }
          }
        }
      }

      // Fallback: If build placed PRXs in a subfolder, search recursively
      if (copiedLibsCount === 0) {
        const copyPrxRecursive = (current: string) => {
          const entries = fs.readdirSync(current, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (ext === '.prx' || ext === '.dll') {
                fs.copyFileSync(full, path.join(targetLibsDir, entry.name));
                copiedLibsCount++;
              }
            } else if (entry.isDirectory() && entry.name !== 'CMakeFiles') {
              copyPrxRecursive(full);
            }
          }
        };
        const buildDir = path.join(this.sourceDir, 'build');
        if (fs.existsSync(buildDir)) {
          copyPrxRecursive(buildDir);
        }
      }

      // Write commit-info.json
      const metaPath = path.join(targetDir, 'commit-info.json');
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            sha: fullSha,
            shortSha,
            message: commitMessage,
            builtLocally: true,
            builtAt: new Date().toISOString(),
            copiedLibsCount,
          },
          null,
          2
        )
      );

      // Register profile in runtimes manifest
      const runtimeId = `commit-${shortSha}`;
      const manifest = runtimeManager.getManifest();
      const existingIdx = manifest.runtimes.findIndex((r) => r.id === runtimeId);

      const profile = {
        id: runtimeId,
        name: `Local Build: ${shortSha} (${commitMessage.substring(0, 32)})`,
        type: 'local-build' as const,
        commitHash: fullSha,
        commitMessage,
        date: new Date().toISOString(),
        path: path.relative(path.join(this.userDataDir, 'runtimes'), targetDir),
        relinkerPath: finalRelinkerPath,
        libsPath: targetLibsDir,
        isRemovable: true,
      };

      if (existingIdx >= 0) {
        manifest.runtimes[existingIdx] = profile;
      } else {
        manifest.runtimes.push(profile);
      }
      runtimeManager.saveManifest(manifest);

      onLog({
        text: `[Success] Compilation succeeded. Output staged to ${targetDir} with ${copiedLibsCount} library binaries. Profile registered: "${profile.name}".`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      onStatus({
        status: 'completed',
        progress: 100,
        message: 'Compilation and staging complete. Local build profile registered.',
      });

      return {
        success: true,
        runtimeId,
        relinkerPath: finalRelinkerPath,
        libsPath: targetLibsDir,
      };
    } catch (err: any) {
      console.error('startBuild error:', err);
      const errMsg = err?.message || String(err);
      const conciseMsg = this.sanitizeBuildErrorMessage(errMsg);
      onLog({
        text: `[Build Failure] ${errMsg}`,
        type: 'error',
        timestamp: new Date().toLocaleTimeString(),
      });
      onStatus({
        status: 'error',
        progress: 0,
        message: conciseMsg,
        error: errMsg,
      });
      return { success: false, error: errMsg };
    } finally {
      this.isBuilding = false;
      this.activePRNumber = null;
    }
  }

  /**
   * Fetch, compile and stage a community pull request via Local Builder
   */
  public async buildPullRequest(
    prNumber: number,
    headSha: string,
    prTitle: string,
    runtimeManager: RuntimeManager,
    onLog: (msg: BuilderLogMessage) => void,
    onStatus: (status: BuildProgressStatus) => void
  ): Promise<BuildResult> {
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      return { success: false, error: 'Invalid pull request number.' };
    }
    headSha = typeof headSha === 'string' && /^[0-9a-f]{7,40}$/i.test(headSha) ? headSha : 'HEAD';
    prTitle = String(prTitle ?? '');
    if (this.isBuilding) {
      return { success: false, error: 'A local compilation is already in progress.' };
    }
    this.isBuilding = true;
    this.activePRNumber = prNumber;
    this.recentLogs = [];
    const logWrapper = (msg: BuilderLogMessage) => {
      this.recentLogs.push(msg);
      if (this.recentLogs.length > 500) this.recentLogs.shift();
      onLog(msg);
    };

    try {
      onStatus({
        status: 'configuring',
        progress: 5,
        message: 'Verifying build toolchain dependencies...',
      });
      onLog({
        text: `=== Initiating Native Build for Pull Request #${prNumber}: ${prTitle} ===`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      // 1. Toolchain verification
      const toolchainRes = await this.inspectToolchain();
      if (!toolchainRes.allRequiredAvailable) {
        const missing = toolchainRes.tools.filter((t) => !t.isAvailable).map((t) => t.name);
        throw new Error(`Missing required build tools: ${missing.join(', ')}. Please install or provision them via the Local Builder tab.`);
      }

      // 2. Ensure repository is cloned
      const gitDir = path.join(this.sourceDir, '.git');
      if (!fs.existsSync(gitDir)) {
        onStatus({
          status: 'configuring',
          progress: 10,
          message: 'Cloning upstream AnyPS5 repository...',
        });
        onLog({
          text: `[Git] Repository not found in ${this.sourceDir}. Cloning https://github.com/boykopovar/AnyPS5.git...`,
          type: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });
        if (!fs.existsSync(this.sourceDir)) {
          fs.mkdirSync(this.sourceDir, { recursive: true });
        }
        await this.runProcess('git', ['clone', '--recurse-submodules', 'https://github.com/boykopovar/AnyPS5.git', '.'], this.sourceDir, logWrapper);
      }

      // Run repository self-healing routine before fetching/checking out PR
      await this.sanitizeRepositoryState(logWrapper);

      // 3. Fetch PR branch
      const branchName = `pr-${prNumber}`;
      onStatus({
        status: 'configuring',
        progress: 15,
        message: `Fetching PR #${prNumber} from upstream Git...`,
      });
      logWrapper({
        text: `[Git] Fetching pull/${prNumber}/head into branch ${branchName}...`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      await this.runProcess(
        'git',
        ['fetch', 'origin', `+refs/pull/${prNumber}/head:refs/heads/${branchName}`],
        this.sourceDir,
        logWrapper
      );

      // 4. Checkout branch
      onStatus({
        status: 'configuring',
        progress: 20,
        message: `Checking out ${branchName}...`,
      });
      logWrapper({
        text: `[Git] Checking out branch ${branchName}...`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      await this.runProcess('git', ['checkout', '-f', branchName], this.sourceDir, logWrapper);

      // The user confirmed a specific commit; refuse to build if the author pushed something else since.
      if (headSha !== 'HEAD') {
        const fetchedSha = this.runGit(['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
        if (!fetchedSha.startsWith(headSha.toLowerCase())) {
          throw new Error(`PR #${prNumber} changed since it was shown (expected ${headSha}, fetched ${fetchedSha.slice(0, 7)}). Refresh the list and review the new changes before building.`);
        }
      }

      // 5. Update submodules
      onStatus({
        status: 'configuring',
        progress: 25,
        message: 'Synchronizing submodules for PR...',
      });
      logWrapper({
        text: '[Git] Updating submodules (SDL2, ffmpeg-core, etc.)...',
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      this.cleanGitLocks(gitDir);
      await this.runProcess('git', ['submodule', 'update', '--init', '--recursive'], this.sourceDir, logWrapper);
      await this.runProcess('git', ['submodule', 'foreach', '--recursive', 'git checkout -f'], this.sourceDir, logWrapper);

      // 6. CMake Configure
      onStatus({
        status: 'configuring',
        progress: 30,
        message: 'Configuring project with CMake and Ninja generator...',
      });
      onLog({
        text: '[CMake] cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DANYPS5_BUILD_TESTS=OFF',
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      await this.runProcess(
        'cmake',
        ['-S', '.', '-B', 'build', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DANYPS5_BUILD_TESTS=OFF'],
        this.sourceDir,
        logWrapper
      );

      // 7. Build relinker
      onStatus({
        status: 'building',
        progress: 55,
        message: `Compiling target "relinker" for PR #${prNumber}...`,
      });
      logWrapper({
        text: '[CMake] Building relinker executable: cmake --build build --target relinker',
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      await this.runProcess('cmake', ['--build', 'build', '--target', 'relinker'], this.sourceDir, logWrapper);

      // 8. Build libs
      onStatus({
        status: 'building',
        progress: 80,
        message: `Compiling target "libs" for PR #${prNumber}...`,
      });
      logWrapper({
        text: '[CMake] Building PRX libraries: cmake --build build --target libs',
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      await this.runProcess('cmake', ['--build', 'build', '--target', 'libs'], this.sourceDir, logWrapper);

      // 9. Staging into custom/pr-NUM/
      onStatus({
        status: 'staging',
        progress: 92,
        message: `Staging PR #${prNumber} binaries into Runtime Manager...`,
      });

      const targetDir = path.join(this.runtimesDir, 'custom', `pr-${prNumber}`);
      const targetLibsDir = path.join(targetDir, 'libs');

      if (!fs.existsSync(targetLibsDir)) {
        fs.mkdirSync(targetLibsDir, { recursive: true });
      }

      // Locate relinker binary
      const binName = process.platform === 'win32' ? 'relinker.exe' : 'relinker';
      const possibleRelinkerPaths = [
        path.join(this.sourceDir, 'build', 'core', 'relinker', binName),
        path.join(this.sourceDir, 'build', 'bin', binName),
        path.join(this.sourceDir, 'build', binName),
        path.join(this.sourceDir, 'build', 'Release', binName),
      ];

      let builtRelinker: string | null = null;
      for (const p of possibleRelinkerPaths) {
        if (fs.existsSync(p)) {
          builtRelinker = p;
          break;
        }
      }

      if (!builtRelinker) {
        throw new Error(`Build finished but "${binName}" was not found in build output directories.`);
      }

      const finalRelinkerPath = path.join(targetDir, binName);
      fs.copyFileSync(builtRelinker, finalRelinkerPath);
      if (process.platform !== 'win32') {
        try { fs.chmodSync(finalRelinkerPath, 0o755); } catch {}
      }

      // Copy libraries
      const searchDirs = [
        path.join(this.sourceDir, 'build', 'core', 'libs', 'libs'),
        path.join(this.sourceDir, 'build', 'core', 'libs'),
        path.join(this.sourceDir, 'build', 'libs'),
        path.join(this.sourceDir, 'build', 'bin'),
      ];

      let copiedLibsCount = 0;
      for (const sDir of searchDirs) {
        if (!fs.existsSync(sDir)) continue;
        const entries = fs.readdirSync(sDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.prx' || ext === '.dll') {
              fs.copyFileSync(path.join(sDir, entry.name), path.join(targetLibsDir, entry.name));
              copiedLibsCount++;
            }
          }
        }
      }

      if (copiedLibsCount === 0) {
        const copyPrxRecursive = (current: string) => {
          const entries = fs.readdirSync(current, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (ext === '.prx' || ext === '.dll') {
                fs.copyFileSync(full, path.join(targetLibsDir, entry.name));
                copiedLibsCount++;
              }
            } else if (entry.isDirectory() && entry.name !== 'CMakeFiles') {
              copyPrxRecursive(full);
            }
          }
        };
        const buildDir = path.join(this.sourceDir, 'build');
        if (fs.existsSync(buildDir)) {
          copyPrxRecursive(buildDir);
        }
      }

      // Write runtime_info.json as specified
      const metaPath = path.join(targetDir, 'runtime_info.json');
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            id: `custom-pr-${prNumber}`,
            name: `PR #${prNumber}: ${prTitle}`,
            type: 'custom',
            version: `PR #${prNumber} (${headSha.slice(0, 7)})`,
            relinkerPath: finalRelinkerPath,
            libsPath: targetLibsDir,
            commitSha: headSha,
            createdAt: new Date().toISOString(),
            copiedLibsCount,
          },
          null,
          2
        )
      );

      // Register profile in runtimes manifest
      const runtimeId = `custom-pr-${prNumber}`;
      const manifest = runtimeManager.getManifest();
      const existingIdx = manifest.runtimes.findIndex((r) => r.id === runtimeId);

      const profile = {
        id: runtimeId,
        name: `PR #${prNumber}: ${prTitle}`,
        type: 'custom' as const,
        commitHash: headSha,
        commitMessage: prTitle,
        date: new Date().toISOString(),
        path: path.relative(path.join(this.userDataDir, 'runtimes'), targetDir),
        relinkerPath: finalRelinkerPath,
        libsPath: targetLibsDir,
        isRemovable: true,
      };

      if (existingIdx >= 0) {
        manifest.runtimes[existingIdx] = profile;
      } else {
        manifest.runtimes.push(profile);
      }
      runtimeManager.saveManifest(manifest);

      onLog({
        text: `[Success] PR #${prNumber} compiled successfully. Staged to ${targetDir} with ${copiedLibsCount} library binaries. Profile registered: "${profile.name}".`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      onStatus({
        status: 'completed',
        progress: 100,
        message: `PR #${prNumber} build complete and registered as switchable runtime.`,
      });

      return {
        success: true,
        runtimeId,
        relinkerPath: finalRelinkerPath,
        libsPath: targetLibsDir,
      };
    } catch (err: any) {
      console.error(`buildPullRequest(${prNumber}) error:`, err);
      try {
        await this.sanitizeRepositoryState();
      } catch {}
      const errMsg = err?.message || String(err);
      const conciseMsg = this.sanitizeBuildErrorMessage(errMsg);
      onLog({
        text: `[Build Failure] ${errMsg}`,
        type: 'error',
        timestamp: new Date().toLocaleTimeString(),
      });
      onStatus({
        status: 'error',
        progress: 0,
        message: conciseMsg,
        error: errMsg,
      });
      return { success: false, error: errMsg };
    } finally {
      this.isBuilding = false;
      this.activePRNumber = null;
    }
  }

  /**
   * Sequentially merge multiple PR branches and compile into a hybrid runtime
   */
  public async mergeAndBuildPRs(
    prNumbers: number[],
    runtimeManager: RuntimeManager,
    onLog: (msg: BuilderLogMessage) => void,
    onStatus: (status: BuildProgressStatus) => void
  ): Promise<MultiPRBuildResult> {
    if (!Array.isArray(prNumbers) || prNumbers.length === 0 || !prNumbers.every((n) => Number.isInteger(n) && n > 0)) {
      return { success: false, error: 'Invalid pull request numbers.' };
    }
    if (this.isBuilding) {
      return { success: false, error: 'A local compilation is already in progress.' };
    }
    this.isBuilding = true;
    this.activePRNumber = null;
    this.recentLogs = [];
    const logWrapper = (msg: BuilderLogMessage) => {
      this.recentLogs.push(msg);
      if (this.recentLogs.length > 500) this.recentLogs.shift();
      onLog(msg);
    };

    try {
      const sortedNums = [...new Set(prNumbers)].sort((a, b) => a - b);
      const buildId = `merged-${sortedNums.join('-')}`;
      const prListStr = sortedNums.map((n) => `#${n}`).join(', ');

      onStatus({
        status: 'configuring',
        progress: 5,
        message: `Verifying build toolchain for hybrid build (${prListStr})...`,
      });
      onLog({
        text: `=== Initiating Hybrid Multi-PR Merge & Build for PRs: ${prListStr} ===`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      // 1. Toolchain verification
      const toolchainRes = await this.inspectToolchain();
      if (!toolchainRes.allRequiredAvailable) {
        const missing = toolchainRes.tools.filter((t) => !t.isAvailable).map((t) => t.name);
        throw new Error(`Missing required build tools: ${missing.join(', ')}. Please install or provision them via the Local Builder tab.`);
      }

      // 2. Ensure repository is cloned
      const gitDir = path.join(this.sourceDir, '.git');
      if (!fs.existsSync(gitDir)) {
        if (!fs.existsSync(this.sourceDir)) fs.mkdirSync(this.sourceDir, { recursive: true });
        await this.runProcess('git', ['clone', '--recurse-submodules', 'https://github.com/boykopovar/AnyPS5.git', '.'], this.sourceDir, logWrapper);
      }

      // Self-heal and clean repository before starting
      await this.sanitizeRepositoryState(logWrapper);

      // 3. Reset to upstream main
      onStatus({
        status: 'configuring',
        progress: 10,
        message: 'Updating upstream main branch...',
      });
      await this.runProcess('git', ['fetch', 'origin', 'main'], this.sourceDir, logWrapper);
      await this.runProcess('git', ['reset', '--hard', 'origin/main'], this.sourceDir, logWrapper);

      // 4. Create hybrid merge branch
      onStatus({
        status: 'configuring',
        progress: 15,
        message: `Creating hybrid merge branch "${buildId}"...`,
      });
      await this.runProcess('git', ['checkout', '-B', buildId, 'origin/main'], this.sourceDir, logWrapper);

      // 5. Sequentially fetch and merge each PR
      let stepProgress = 15;
      for (const prNum of sortedNums) {
        stepProgress += Math.floor(15 / sortedNums.length);
        onStatus({
          status: 'configuring',
          progress: stepProgress,
          message: `Fetching and merging PR #${prNum}...`,
        });
        logWrapper({
          text: `[Git] Fetching PR #${prNum}...`,
          type: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });
        await this.runProcess('git', ['fetch', 'origin', `+refs/pull/${prNum}/head:pr-${prNum}`], this.sourceDir, logWrapper);

        logWrapper({
          text: `[Git] Merging branch pr-${prNum} into ${buildId}...`,
          type: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });
        try {
          await this.runProcess('git', ['merge', '--no-edit', `pr-${prNum}`], this.sourceDir, logWrapper);
        } catch (mergeErr: any) {
          logWrapper({
            text: `[Git Conflict] Unresolvable merge conflict while merging PR #${prNum} into hybrid branch ${buildId}. Aborting merge and restoring worktree to main...`,
            type: 'error',
            timestamp: new Date().toLocaleTimeString(),
          });
          try {
            await this.runProcess('git', ['merge', '--abort'], this.sourceDir, logWrapper);
          } catch {}
          try {
            await this.runProcess('git', ['checkout', '-f', 'main'], this.sourceDir, logWrapper);
          } catch {}
          throw new Error(`Merge conflict in PR #${prNum}: Cannot cleanly merge into hybrid branch. Aborted merge and safely restored worktree to main.`);
        }
      }

      // 6. Submodules
      onStatus({
        status: 'configuring',
        progress: 35,
        message: 'Synchronizing submodules for hybrid branch...',
      });
      await this.runProcess('git', ['submodule', 'update', '--init', '--recursive'], this.sourceDir, logWrapper);

      // 7. CMake Configure
      onStatus({
        status: 'configuring',
        progress: 40,
        message: 'Configuring project with CMake and Ninja generator...',
      });
      await this.runProcess(
        'cmake',
        ['-S', '.', '-B', 'build', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DANYPS5_BUILD_TESTS=OFF'],
        this.sourceDir,
        logWrapper
      );

      // 8. Build targets
      onStatus({
        status: 'building',
        progress: 60,
        message: 'Compiling relinker for hybrid build...',
      });
      await this.runProcess('cmake', ['--build', 'build', '--target', 'relinker'], this.sourceDir, logWrapper);

      onStatus({
        status: 'building',
        progress: 80,
        message: 'Compiling PRX libraries for hybrid build...',
      });
      await this.runProcess('cmake', ['--build', 'build', '--target', 'libs'], this.sourceDir, logWrapper);

      // 9. Staging
      onStatus({
        status: 'staging',
        progress: 92,
        message: 'Staging hybrid build into Runtime Manager...',
      });

      const targetDir = path.join(this.runtimesDir, 'custom', buildId);
      const targetLibsDir = path.join(targetDir, 'libs');
      if (!fs.existsSync(targetLibsDir)) {
        fs.mkdirSync(targetLibsDir, { recursive: true });
      }

      const binName = process.platform === 'win32' ? 'relinker.exe' : 'relinker';
      const possibleRelinkerPaths = [
        path.join(this.sourceDir, 'build', 'core', 'relinker', binName),
        path.join(this.sourceDir, 'build', 'bin', binName),
        path.join(this.sourceDir, 'build', binName),
        path.join(this.sourceDir, 'build', 'Release', binName),
      ];

      let builtRelinker: string | null = null;
      for (const p of possibleRelinkerPaths) {
        if (fs.existsSync(p)) {
          builtRelinker = p;
          break;
        }
      }
      if (!builtRelinker) {
        throw new Error(`Build finished but "${binName}" was not found.`);
      }

      const finalRelinkerPath = path.join(targetDir, binName);
      fs.copyFileSync(builtRelinker, finalRelinkerPath);
      if (process.platform !== 'win32') {
        try { fs.chmodSync(finalRelinkerPath, 0o755); } catch {}
      }

      const searchDirs = [
        path.join(this.sourceDir, 'build', 'core', 'libs', 'libs'),
        path.join(this.sourceDir, 'build', 'core', 'libs'),
        path.join(this.sourceDir, 'build', 'libs'),
        path.join(this.sourceDir, 'build', 'bin'),
      ];

      let copiedLibsCount = 0;
      for (const sDir of searchDirs) {
        if (!fs.existsSync(sDir)) continue;
        const entries = fs.readdirSync(sDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.prx' || ext === '.dll') {
              fs.copyFileSync(path.join(sDir, entry.name), path.join(targetLibsDir, entry.name));
              copiedLibsCount++;
            }
          }
        }
      }

      // Write runtime_info.json
      const metaPath = path.join(targetDir, 'runtime_info.json');
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            id: `custom-${buildId}`,
            name: `Hybrid Merge: ${prListStr}`,
            type: 'custom',
            version: `Hybrid (${prListStr})`,
            relinkerPath: finalRelinkerPath,
            libsPath: targetLibsDir,
            mergedPRs: sortedNums,
            createdAt: new Date().toISOString(),
            copiedLibsCount,
          },
          null,
          2
        )
      );

      // Register profile in manifest
      const runtimeId = `custom-${buildId}`;
      const manifest = runtimeManager.getManifest();
      const existingIdx = manifest.runtimes.findIndex((r) => r.id === runtimeId);

      const profile = {
        id: runtimeId,
        name: `Hybrid Merge: ${prListStr}`,
        type: 'custom' as const,
        commitHash: buildId,
        commitMessage: `Combined build of PRs ${prListStr}`,
        date: new Date().toISOString(),
        path: path.relative(path.join(this.userDataDir, 'runtimes'), targetDir),
        relinkerPath: finalRelinkerPath,
        libsPath: targetLibsDir,
        isRemovable: true,
      };

      if (existingIdx >= 0) {
        manifest.runtimes[existingIdx] = profile;
      } else {
        manifest.runtimes.push(profile);
      }
      runtimeManager.saveManifest(manifest);

      onLog({
        text: `[Success] Hybrid multi-PR build successfully compiled. Registered as "${profile.name}".`,
        type: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });

      onStatus({
        status: 'completed',
        progress: 100,
        message: 'Hybrid multi-PR build complete and registered as switchable runtime.',
      });

      return {
        success: true,
        buildId: runtimeId,
        relinkerPath: finalRelinkerPath,
        mergedPRs: sortedNums,
      };
    } catch (err: any) {
      console.error('mergeAndBuildPRs error:', err);
      try {
        await this.sanitizeRepositoryState();
      } catch {}
      const errMsg = err?.message || String(err);
      const conciseMsg = this.sanitizeBuildErrorMessage(errMsg);
      onLog({
        text: `[Build Failure] ${errMsg}`,
        type: 'error',
        timestamp: new Date().toLocaleTimeString(),
      });
      onStatus({
        status: 'error',
        progress: 0,
        message: conciseMsg,
        error: errMsg,
      });
      return { success: false, error: errMsg };
    } finally {
      this.isBuilding = false;
      this.activePRNumber = null;
    }
  }

  /**
   * Get current build status for rehydration across tab switches
   */
  public getActiveBuild(): { isBuilding: boolean; buildingPR: number | null; recentLogs: BuilderLogMessage[] } {
    return {
      isBuilding: this.isBuilding,
      buildingPR: this.activePRNumber,
      recentLogs: [...this.recentLogs],
    };
  }

  /**
   * Produce a concise human-readable error summary from compiler or tool errors
   */
  private sanitizeBuildErrorMessage(rawError: string): string {
    if (!rawError) return 'Build failed: Compilation halted';
    const str = String(rawError);
    if (/cmake.*-S.*-B.*exited with code/i.test(str) || /cmake.*configure/i.test(str) || /The source directory.*does not contain a CMakeLists/i.test(str)) {
      return 'Build failed during CMake configuration';
    }
    if (/cmake.*--build.*--target.*relinker.*exited/i.test(str)) {
      return 'Build failed during relinker compilation';
    }
    if (/cmake.*--build.*--target.*libs.*exited/i.test(str)) {
      return 'Build failed during PRX libraries compilation';
    }
    if (/ninja.*exited with code/i.test(str)) {
      return 'Build failed during compilation phase';
    }
    if (/git.*submodule/i.test(str)) {
      return 'Submodule initialization failed';
    }
    if (/git.*checkout/i.test(str) || /git.*fetch/i.test(str) || /git.*pull/i.test(str)) {
      return 'Source synchronization failed';
    }
    if (str.length > 80 && str.includes('exited with code')) {
      return 'Build process exited with an error';
    }
    if (str.length > 90) {
      return str.slice(0, 87) + '...';
    }
    return str;
  }
}
