import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { spawn, spawnSync, execFile, ChildProcess } from 'child_process';
import os from 'os';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { unwrapSelf } from './self_unwrapper';
import { RuntimeManager } from './runtimeManager';
import { GitHubAuthService } from './githubAuth';
import { LocalBuilderService } from './localBuilder';
import { DiscordRpcClient } from './discordRpc';

let mainWindow: BrowserWindow | null = null;

function getWindowIconPath(): string {
  const candidates = [
    path.join(__dirname, '../dist/icon.ico'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../dist/icon.png'),
    path.join(__dirname, '../public/icon.png'),
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(process.resourcesPath, 'icon.png'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return '';
}

function createWindow() {
  const windowIcon = getWindowIconPath();
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#04060a',
    title: 'AnyPS5 · PlayStation 5 Studio',
    icon: windowIcon || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: true,
  });

  mainWindow.removeMenu();

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('anyps5:window-maximized-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('anyps5:window-maximized-change', false);
  });

  // Open any external web links in user's default system browser instead of in-app
  // Never open in-app windows (they would inherit the preload bridge); web links go to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDev = (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) || url.startsWith('http://localhost:5173');
    // Reloading the app's own page (e.g. from the crash screen) is fine; anything else is blocked.
    const isOwnPage = url.split('#')[0] === mainWindow?.webContents.getURL().split('#')[0];
    if (isDev || isOwnPage) return;
    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  const distPath = path.join(__dirname, '../dist/index.html');
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL).catch(() => {
      if (fs.existsSync(distPath)) mainWindow?.loadFile(distPath);
    });
  } else if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath);
  } else {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      if (fs.existsSync(distPath)) mainWindow?.loadFile(distPath);
    });
  }

  mainWindow.show();
  mainWindow.focus();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    detectAvailableGpus();
    detectHostCapabilities();

    // In-App Background auto-updater for GitHub Releases
    try {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowPrerelease = true;

      const sendUpdateStatus = (status: {
        status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
        version?: string;
        progress?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
        error?: string;
      }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('anyps5:update-status', status);
        }
      };

      autoUpdater.on('checking-for-update', () => {
        sendUpdateStatus({ status: 'checking' });
      });

      autoUpdater.on('update-available', (info) => {
        sendUpdateStatus({ status: 'available', version: info.version });
      });

      autoUpdater.on('update-not-available', (info) => {
        sendUpdateStatus({ status: 'not-available', version: info?.version || app.getVersion() });
      });

      autoUpdater.on('download-progress', (progressObj) => {
        sendUpdateStatus({
          status: 'downloading',
          progress: Math.round(progressObj.percent),
          bytesPerSecond: progressObj.bytesPerSecond,
          transferred: progressObj.transferred,
          total: progressObj.total,
        });
      });

      autoUpdater.on('update-downloaded', (info) => {
        sendUpdateStatus({ status: 'downloaded', version: info.version });
      });

      autoUpdater.on('error', (err) => {
        sendUpdateStatus({ status: 'error', error: err?.message || String(err) });
      });

      if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch((err) => {
          console.warn('Auto-updater initial background check:', err?.message || err);
        });
      }
    } catch (updaterErr) {
      console.warn('AutoUpdater initialization error:', updaterErr);
    }

    try {
      const userSettings = loadSettings();
      if (userSettings.discordRpcEnabled !== false) {
        const rpc = getDiscordRpcClient();
        rpc.setIdle();
        rpc.connect();
      }
    } catch {}

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  if (discordRpcClientInstance) {
    discordRpcClientInstance.destroy();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Recursive helper to calculate accurate size of game directory/file on disk
// Async so walking a 100 GB dump never blocks the main process (and with it the whole window).
async function getFolderSize(targetPath: string): Promise<number> {
  try {
    if (!targetPath) return 0;
    const stat = await fs.promises.stat(targetPath);
    if (!stat.isDirectory()) {
      const base = path.basename(targetPath).toLowerCase();
      if (base === 'eboot.bin' || base === 'eboot.elf' || base === 'app.exe' || base === 'app.elf') {
        return getFolderSize(path.dirname(targetPath));
      }
      return stat.size;
    }
    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
    const sizes = await Promise.all(entries.map(async (entry) => {
      const full = path.join(targetPath, entry.name);
      try {
        if (entry.isDirectory() && !entry.isSymbolicLink()) return await getFolderSize(full);
        if (entry.isFile()) return (await fs.promises.stat(full)).size;
      } catch {}
      return 0;
    }));
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

// Sizes are refreshed after the library is returned, then merged into whatever is on disk at that moment
// so a save from the renderer in the meantime is never overwritten with a stale list.
let sizeRefreshRunning = false;
async function refreshGameSizesInBackground(paths: string[]) {
  if (sizeRefreshRunning || paths.length === 0) return;
  sizeRefreshRunning = true;
  try {
    const sizes = new Map<string, number>();
    for (const p of paths) {
      const size = await getFolderSize(p);
      if (size > 0) sizes.set(p, size);
    }
    const current = JSON.parse(await fs.promises.readFile(gamesStorePath, 'utf8'));
    if (!Array.isArray(current)) return;
    let changed = false;
    for (const g of current) {
      const size = g?.path ? sizes.get(g.path) : undefined;
      if (size !== undefined && g.sizeBytes !== size) {
        g.sizeBytes = size;
        changed = true;
      }
    }
    if (changed) await fs.promises.writeFile(gamesStorePath, JSON.stringify(current, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to refresh game sizes:', err);
  } finally {
    sizeRefreshRunning = false;
  }
}

// IPC Handler: Persistent Games Storage
const gamesStorePath = path.join(app.getPath('userData'), 'anyps5_games.json');

ipcMain.handle('anyps5:get-games', async () => {
  try {
    if (fs.existsSync(gamesStorePath)) {
      const data = fs.readFileSync(gamesStorePath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Fill in fields the UI relies on so one hand-edited or older entry cannot break the whole library.
        const games = parsed.filter((g) => g && typeof g === 'object' && typeof g.path === 'string');
        let changed = games.length !== parsed.length;
        for (const [i, g] of games.entries()) {
          const defaults: Record<string, unknown> = {
            id: `game-${Date.now()}-${i}`,
            title: path.basename(g.path) || 'Untitled',
            titleId: '',
            version: '01.00',
            category: 'game',
            status: 'ready_to_relink',
            executableName: process.platform === 'win32' ? 'app.exe' : 'app.elf',
            targetPlatform: process.platform === 'win32' ? 'windows' : 'linux',
            iconUrl: './default-cover.svg',
            backdropUrl: './default-backdrop.svg',
          };
          for (const [key, value] of Object.entries(defaults)) {
            if (typeof g[key] !== 'string' || !g[key]) {
              g[key] = value;
              changed = true;
            }
          }
          const c = g.compatibility && typeof g.compatibility === 'object' ? g.compatibility : {};
          const compatibility = {
            status: typeof c.status === 'string' ? c.status : 'untested',
            score: Number.isFinite(c.score) ? c.score : 0,
            resolvedNids: Number.isFinite(c.resolvedNids) ? c.resolvedNids : 0,
            totalNids: Number.isFinite(c.totalNids) ? c.totalNids : 0,
            unresolvedModules: Array.isArray(c.unresolvedModules) ? c.unresolvedModules : [],
            missingNids: Array.isArray(c.missingNids) ? c.missingNids : [],
            amdInstructionsDetected: Number.isFinite(c.amdInstructionsDetected) ? c.amdInstructionsDetected : 0,
          };
          if (JSON.stringify(compatibility) !== JSON.stringify(g.compatibility)) {
            g.compatibility = compatibility;
            changed = true;
          }
        }
        const presentPaths: string[] = [];
        for (const g of games) {
          // Older versions stored remote Unsplash placeholders; use the bundled artwork so the library works offline.
          if (typeof g?.iconUrl === 'string' && g.iconUrl.startsWith('https://images.unsplash.com/')) {
            g.iconUrl = './default-cover.svg';
            changed = true;
          }
          if (typeof g?.backdropUrl === 'string' && g.backdropUrl.startsWith('https://images.unsplash.com/')) {
            g.backdropUrl = './default-backdrop.svg';
            changed = true;
          }
          if (g && g.path && fs.existsSync(g.path)) {
            presentPaths.push(g.path);
            const isLinux = process.platform === 'linux';
            const hasAppElf = fs.existsSync(path.join(g.path, 'app.elf'));
            const hasAppExe = fs.existsSync(path.join(g.path, 'app.exe'));
            if (isLinux) {
              if (hasAppElf) {
                if (g.status !== 'ported' || g.executableName !== 'app.elf' || g.targetPlatform !== 'linux') {
                  g.status = 'ported';
                  g.executableName = 'app.elf';
                  g.targetPlatform = 'linux';
                  changed = true;
                }
              } else if (hasAppExe) {
                if (g.status !== 'ready_to_relink' || g.executableName !== 'app.elf') {
                  g.status = 'ready_to_relink';
                  g.executableName = 'app.elf';
                  changed = true;
                }
              }
            } else if (process.platform === 'win32') {
              if (hasAppExe) {
                if (g.status !== 'ported' || g.executableName !== 'app.exe' || g.targetPlatform !== 'windows') {
                  g.status = 'ported';
                  g.executableName = 'app.exe';
                  g.targetPlatform = 'windows';
                  changed = true;
                }
              } else if (hasAppElf) {
                if (g.status !== 'ready_to_relink' || g.executableName !== 'app.exe') {
                  g.status = 'ready_to_relink';
                  g.executableName = 'app.exe';
                  changed = true;
                }
              }
            }
          }
        }
        if (changed) {
          try {
            if (games.length !== parsed.length) fs.writeFileSync(`${gamesStorePath}.before-repair`, data, 'utf8');
            fs.writeFileSync(gamesStorePath, JSON.stringify(games, null, 2), 'utf8');
          } catch (writeErr) {
            console.error('Failed to update games.json with accurate sizes:', writeErr);
          }
        }
        refreshGameSizesInBackground(presentPaths);
        return games;
      }
    }
  } catch (err) {
    // Keep the unreadable file instead of letting the next save overwrite it.
    console.error('Failed to read games.json:', err);
    try { fs.renameSync(gamesStorePath, `${gamesStorePath}.corrupt-${Date.now()}`); } catch {}
  }
  // An empty library, never the demo titles: those are only added when chosen during setup.
  return [];
});

// Adds a finished session to the game's total playtime and last-played time in the library file.
function recordPlaySession(gameId: string, startedAt: number) {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  if (!gameId || seconds < 1) return;
  try {
    const list = JSON.parse(fs.readFileSync(gamesStorePath, 'utf8'));
    const g = Array.isArray(list) ? list.find((x: any) => x?.id === gameId) : null;
    if (!g) return;
    g.playTimeSeconds = (Number(g.playTimeSeconds) || 0) + seconds;
    g.lastPlayedAt = new Date().toISOString();
    fs.writeFileSync(gamesStorePath, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to record play session:', err);
  }
}

ipcMain.handle('anyps5:save-games', async (_, games) => {
  try {
    // Playtime is written by the main process when a game exits; a save from a renderer that has not reloaded
    // the library yet must not roll it back.
    if (Array.isArray(games) && fs.existsSync(gamesStorePath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(gamesStorePath, 'utf8'));
        const byId = new Map((Array.isArray(saved) ? saved : []).map((g: any) => [g?.id, g]));
        for (const g of games) {
          const prev: any = byId.get(g?.id);
          if (!prev) continue;
          g.playTimeSeconds = Math.max(Number(prev.playTimeSeconds) || 0, Number(g.playTimeSeconds) || 0) || undefined;
          if (prev.lastPlayedAt && (!g.lastPlayedAt || prev.lastPlayedAt > g.lastPlayedAt)) g.lastPlayedAt = prev.lastPlayedAt;
        }
      } catch {}
    }
    fs.writeFileSync(gamesStorePath, JSON.stringify(games, null, 2), 'utf8');
    if (Array.isArray(games)) {
      const unsized = games.filter((g) => g && g.path && (!g.sizeBytes || g.sizeBytes === 15 * 1024 * 1024 * 1024));
      refreshGameSizesInBackground(unsized.map((g) => g.path));
    }
  } catch (err) {
    console.error('Failed to write games.json:', err);
  }
});

// Since Electron 43, pickers open in Downloads unless given a folder, so remember the last one ourselves
// (falling back to the games folder chosen during setup).
let lastPickerDir: string | undefined;
function pickerDefaultPath(): string | undefined {
  if (lastPickerDir && fs.existsSync(lastPickerDir)) return lastPickerDir;
  const gamesDir = loadSettings().gamesDirectory;
  return gamesDir && fs.existsSync(gamesDir) ? gamesDir : undefined;
}

// IPC Handler: Native Folder Picker
ipcMain.handle('anyps5:select-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Decrypted PS5 Game Directory',
    defaultPath: pickerDefaultPath(),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  lastPickerDir = path.dirname(result.filePaths[0]);
  return result.filePaths[0];
});

// IPC Handler: Inspect Game Directory Metadata
ipcMain.handle('anyps5:inspect-folder', async (_, folderPath: string) => {
  return inspectGameFolder(folderPath);
});

async function inspectGameFolder(folderPath: string) {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) return null;
    let titleName = '';
    let titleId = '';
    let version = '01.00';
    let iconDataUrl = '';
    let backdropDataUrl = '';
    let hasEboot = false;

    async function walk(dir: string, depth: number) {
      if (depth > 3) return;
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const dirent of entries) {
          const entry = dirent.name;
          const full = path.join(dir, entry);
          if (dirent.isDirectory()) {
            await walk(full, depth + 1);
          } else {
            const lower = entry.toLowerCase();
            if (lower === 'param.json' && !titleId) {
              try {
                const parsed = JSON.parse(await fs.promises.readFile(full, 'utf8'));
                titleId = parsed.titleId || '';
                const loc = parsed.localizedParameters || {};
                const defLang = loc.defaultLanguage || 'en-US';
                let detectedName = '';
                if (loc[defLang] && typeof loc[defLang] === 'object' && loc[defLang].titleName) {
                  detectedName = loc[defLang].titleName;
                } else {
                  for (const k of Object.keys(loc)) {
                    if (typeof loc[k] === 'object' && loc[k]?.titleName) {
                      detectedName = loc[k].titleName;
                      break;
                    }
                  }
                }
                titleName = detectedName || parsed.titleName || '';
                version = parsed.contentVersion || parsed.appVersion || '01.00';
              } catch {}
            }
            if (lower === 'icon0.png' && !iconDataUrl) {
              try {
                const buf = await fs.promises.readFile(full);
                iconDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
              } catch {}
            }
            if ((lower === 'pic0.png' || lower === 'pic1.png') && !backdropDataUrl) {
              try {
                const buf = await fs.promises.readFile(full);
                backdropDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
              } catch {}
            }
            if (lower === 'eboot.bin' || lower === 'eboot.elf') {
              hasEboot = true;
            }
          }
        }
      } catch {}
    }

    await walk(folderPath, 0);

    const sizeBytes = await getFolderSize(folderPath);

    return {
      title: titleName,
      titleId,
      version,
      iconUrl: iconDataUrl,
      backdropUrl: backdropDataUrl,
      hasEboot,
      sizeBytes,
    };
  } catch (err) {
    console.error('Inspect folder error:', err);
    return null;
  }
}

ipcMain.handle('anyps5:scan-directory', async (_, rootPath: string) => {
  return scanDirectoryForGames(rootPath);
});

ipcMain.handle('anyps5:audit-game-nids', async (_, game: any, forceRefresh = false) => {
  return auditGameNids(game, forceRefresh);
});

function nidAuditError(error: string) {
  return {
    error,
    summary: { totalImports: 0, resolvedCount: 0, stubCount: 0, missingCount: 0, coveragePercentage: 0 },
    imports: [],
  };
}

async function auditGameNids(game: any, forceRefresh = false) {
  const titleId = (typeof game === 'object' && game?.titleId) ? game.titleId : 'UNKNOWN';
  const folderPath = (typeof game === 'string') ? game : (game?.path || '');

  try {
    fs.rmSync(path.join(app.getPath('userData'), 'nid-cache'), { recursive: true, force: true });
  } catch {}
  const cacheDir = path.join(app.getPath('userData'), 'nid-cache-v2');
  if (!fs.existsSync(cacheDir)) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
    } catch {}
  }
  const cleanId = String(titleId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const cacheFile = path.join(cacheDir, `${cleanId}.json`);

  if (!forceRefresh && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached && cached.summary && Array.isArray(cached.imports)) {
        return cached;
      }
    } catch {}
  } else if (forceRefresh && fs.existsSync(cacheFile)) {
    try {
      fs.unlinkSync(cacheFile);
    } catch {}
  }

  let candidateBinary = '';
  if (folderPath && fs.existsSync(folderPath)) {
    const candidates = [
      path.join(folderPath, 'eboot.elf'),
      path.join(folderPath, 'eboot.bin'),
      path.join(folderPath, 'app0', 'eboot.elf'),
      path.join(folderPath, 'app0', 'eboot.bin'),
      path.join(folderPath, 'app.exe'),
      path.join(folderPath, 'app.elf'),
      path.join(folderPath, 'app0', 'app.exe'),
      path.join(folderPath, 'app0', 'app.elf'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        candidateBinary = c;
        break;
      }
    }
  }

  let libsPath = '';
  try {
    const rm = getRuntimeManager();
    const activeRuntime = rm.resolveRuntime(typeof game === 'object' ? game?.runtimeId : undefined);
    if (activeRuntime && activeRuntime.libsPath && fs.existsSync(activeRuntime.libsPath)) {
      libsPath = activeRuntime.libsPath;
    }
  } catch {}
  if (!libsPath && folderPath) {
    const gameLibs = path.join(folderPath, 'libs');
    const app0Libs = path.join(folderPath, 'app0', 'libs');
    if (fs.existsSync(gameLibs)) {
      libsPath = gameLibs;
    } else if (fs.existsSync(app0Libs)) {
      libsPath = app0Libs;
    }
  }
  if (!libsPath) {
    const fallbackLibs = path.resolve(app.getAppPath(), '..', 'core', 'libs', 'prx');
    if (fs.existsSync(fallbackLibs)) libsPath = fallbackLibs;
  }

  if (!folderPath || !fs.existsSync(folderPath)) {
    return nidAuditError(`Game folder not found: "${folderPath}". Re-import the title or check that its drive is connected.`);
  }
  if (!candidateBinary) {
    return nidAuditError('No readable PlayStation 5 executable (eboot.bin, eboot.elf, or app.exe) found in directory. Ensure files are decrypted or relinked.');
  }

  const scriptCandidates = [
    path.resolve(app.getAppPath(), '..', 'tools', 'audit_game_nids.py'),
    path.resolve(process.cwd(), 'tools', 'audit_game_nids.py'),
    path.join(app.getAppPath(), 'tools', 'audit_game_nids.py'),
  ];
  const scriptPath = scriptCandidates.find((p) => fs.existsSync(p));
  if (!scriptPath) {
    return nidAuditError('The NID audit script (tools/audit_game_nids.py) is missing from this installation. Reinstall AnyPS5 Studio.');
  }

  const pythonCommands = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  let lastFailure = '';
  for (const py of pythonCommands) {
    const args = [scriptPath, '--binary', candidateBinary];
    if (libsPath) {
      args.push('--libs', libsPath);
    }
    const out = await new Promise<{ missing: boolean; stdout: string; stderr: string; status: string }>((resolve) => {
      execFile(py, args, { encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err: any, stdout, stderr) => {
        resolve({ missing: err?.code === 'ENOENT', stdout: stdout || '', stderr: stderr || '', status: err ? String(err.code ?? err.signal ?? 'error') : '0' });
      });
    });
    if (out.missing) continue;
    const stdout = (out.stdout || '').trim();
    if (stdout.startsWith('{')) {
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) return nidAuditError(String(parsed.error));
        if (parsed.summary) {
          try {
            fs.writeFileSync(cacheFile, JSON.stringify(parsed, null, 2), 'utf8');
          } catch {}
          return parsed;
        }
      } catch {}
    }
    lastFailure = (out.stderr || '').trim().split(/\r?\n/).slice(-3).join(' ') || `exit code ${out.status}`;
  }

  if (!lastFailure) {
    return nidAuditError('The NID audit needs Python 3, which was not found. Install it from python.org (tick "Add python.exe to PATH"), then press the re-audit button (circular arrow).');
  }
  return nidAuditError(`The NID audit script failed: ${lastFailure}`);
}

interface DiscoveredGameCandidate {
  path: string;
  title: string;
  titleId: string;
  version: string;
  iconUrl: string;
  backdropUrl: string;
  sizeBytes: number;
  hasEboot: boolean;
}

function isGameRootFolder(folderPath: string): boolean {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) return false;
    const entries = fs.readdirSync(folderPath);
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (lower === 'eboot.bin' || lower === 'eboot.elf') {
        return true;
      }
      if (lower === 'app0') {
        const app0Path = path.join(folderPath, entry);
        try {
          if (fs.statSync(app0Path).isDirectory()) {
            const subEntries = fs.readdirSync(app0Path);
            if (subEntries.some((e) => {
              const subLower = e.toLowerCase();
              return subLower === 'eboot.bin' || subLower === 'eboot.elf';
            })) {
              return true;
            }
          }
        } catch {}
      }
    }
  } catch {}
  return false;
}

async function scanDirectoryForGames(rootDir: string, maxDepth = 5): Promise<DiscoveredGameCandidate[]> {
  const discovered: DiscoveredGameCandidate[] = [];
  const visitedRoots = new Set<string>();

  if (!rootDir || !fs.existsSync(rootDir)) {
    return discovered;
  }

  const normalizedRoot = path.resolve(rootDir);

  if (isGameRootFolder(normalizedRoot)) {
    const inspected = await inspectGameFolder(normalizedRoot);
    if (inspected) {
      discovered.push({
        path: normalizedRoot,
        title: inspected.title || path.basename(normalizedRoot).replace(/[_-]/g, ' '),
        titleId: inspected.titleId || 'PPSA99999',
        version: inspected.version || '01.00',
        iconUrl: inspected.iconUrl || '',
        backdropUrl: inspected.backdropUrl || '',
        sizeBytes: inspected.sizeBytes || 0,
        hasEboot: inspected.hasEboot,
      });
      return discovered;
    }
  }

  const IGNORED_NAMES = new Set([
    '.git',
    '.svn',
    '.hg',
    '.vscode',
    '.idea',
    'node_modules',
    '.bin',
    'system volume information',
    'windows',
    'program files',
    'program files (x86)',
  ]);

  async function traverse(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;
      } catch {}

      const name = entry.name;
      const lowerName = name.toLowerCase();

      if (name.startsWith('.') || IGNORED_NAMES.has(lowerName)) {
        continue;
      }

      const fullPath = path.resolve(currentDir, name);
      const normalizedPath = fullPath.toLowerCase();

      if (visitedRoots.has(normalizedPath)) {
        continue;
      }

      if (isGameRootFolder(fullPath)) {
        visitedRoots.add(normalizedPath);
        try {
          const inspected = await inspectGameFolder(fullPath);
          if (inspected) {
            discovered.push({
              path: fullPath,
              title: inspected.title || name.replace(/[_-]/g, ' '),
              titleId: inspected.titleId || 'PPSA99999',
              version: inspected.version || '01.00',
              iconUrl: inspected.iconUrl || '',
              backdropUrl: inspected.backdropUrl || '',
              sizeBytes: inspected.sizeBytes || 0,
              hasEboot: inspected.hasEboot,
            });
          }
        } catch (err) {
          console.error('Failed to inspect discovered game folder:', err);
        }
        continue;
      }

      await traverse(fullPath, currentDepth + 1);
    }
  }

  await traverse(normalizedRoot, 1);
  return discovered;
}

// Settings & Dynamic Installation Paths Management
const settingsStorePath = path.join(app.getPath('userData'), 'anyps5_settings.json');

interface AppSettings {
  relinkerPath?: string;
  prxPath?: string;
  defaultTarget?: string;
  cpuFix?: string;
  soundEnabled?: boolean;
  hapticsEnabled?: boolean;
  advanced?: boolean;
  preferredGpu?: string;
  gameRuntimes?: Record<string, string>;
  defaultRuntimeId?: string;
  hasCompletedSetup?: boolean;
  lastSeenVersion?: string;
  gamesDirectory?: string;
  discordRpcEnabled?: boolean;
  discordClientId?: string;
  playgoOverrides?: Record<string, 'installed' | 'absent'>;
}

const KNOWN_PLAYGO_PROFILES: Record<string, 'installed' | 'absent'> = {
  'PPSA10112': 'installed',
  'PPSA15388': 'installed',
  'PPSA03001': 'absent',
  'PPSA03490': 'absent',
};

interface DetectedGpu {
  name: string;
  vendor?: 'nvidia' | 'amd' | 'intel' | 'apple' | 'virtual' | 'other';
  isDiscrete: boolean;
  isVirtual: boolean;
  adapterRamMb?: number;
  driverVersion?: string;
}

function runCapture(command: string, args: string[], timeout: number): Promise<{ stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', timeout, windowsHide: true }, (_err, stdout) => resolve({ stdout: stdout || '' }));
  });
}

// AVX2 and the Vulkan loader are what relinked titles need from the host; checked once per session.
// avx2 is null when it cannot be determined (e.g. macOS, where Rosetta handles translation).
let hostCapabilities: Promise<{ avx2: boolean | null; vulkan: boolean }> | null = null;
function detectHostCapabilities() {
  if (!hostCapabilities) {
    hostCapabilities = (async () => {
      let avx2: boolean | null = null;
      let vulkan = false;
      if (process.platform === 'win32') {
        const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
        vulkan = fs.existsSync(path.join(sys32, 'vulkan-1.dll'));
        // PF_AVX2_INSTRUCTIONS_AVAILABLE = 40
        const out = await runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command',
          "Add-Type -Namespace K -Name F -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern bool IsProcessorFeaturePresent(uint f);'; [K.F]::IsProcessorFeaturePresent(40)"], 8000);
        const answer = out.stdout.trim().toLowerCase();
        avx2 = answer === 'true' ? true : answer === 'false' ? false : null;
      } else if (process.platform === 'linux') {
        try {
          avx2 = /\bavx2\b/.test(await fs.promises.readFile('/proc/cpuinfo', 'utf8'));
        } catch {}
        vulkan = ['/usr/lib/x86_64-linux-gnu/libvulkan.so.1', '/usr/lib64/libvulkan.so.1', '/usr/lib/libvulkan.so.1'].some((p) => fs.existsSync(p));
      } else if (process.platform === 'darwin') {
        vulkan = true;
      }
      return { avx2, vulkan };
    })().catch(() => ({ avx2: null, vulkan: false }));
  }
  return hostCapabilities;
}

// GPUs do not change while Studio is open: detect once per session, without blocking the main process.
let gpuDetection: Promise<DetectedGpu[]> | null = null;
function detectAvailableGpus(): Promise<DetectedGpu[]> {
  if (!gpuDetection) {
    gpuDetection = detectAvailableGpusUncached().catch(() => []);
  }
  return gpuDetection;
}

async function detectAvailableGpusUncached(): Promise<DetectedGpu[]> {
  const gpus: DetectedGpu[] = [];
  const platform = os.platform();

  if (platform === 'win32') {
    try {
      const cmd = `Get-CimInstance Win32_VideoController | Select-Object -Property Name, AdapterRAM, Status, VideoProcessor, DriverVersion, PNPDeviceID | ConvertTo-Json`;
      const out = await runCapture('powershell', ['-NoProfile', '-Command', cmd], 5000);
      if (out.stdout && out.stdout.trim()) {
        const parsed = JSON.parse(out.stdout.trim());
        const rawList = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of rawList) {
          if (!item || !item.Name || typeof item.Name !== 'string') continue;
          const name = item.Name.trim();
          if (!name) continue;

          const pnp = (item.PNPDeviceID || '').toUpperCase();
          const lowerName = name.toLowerCase();

          // Check if device is a virtual monitor or indirect display adapter
          const isVirtual =
            lowerName.includes('meta virtual') ||
            lowerName.includes('oculus') ||
            lowerName.includes('virtual desktop') ||
            lowerName.includes('spacedesk') ||
            lowerName.includes('parsec') ||
            lowerName.includes('indirect display') ||
            lowerName.includes('iddcx') ||
            lowerName.includes('citrix') ||
            lowerName.includes('vbox') ||
            lowerName.includes('vmware') ||
            lowerName.includes('basic render') ||
            lowerName.includes('microsoft basic display') ||
            lowerName.includes('displaylink') ||
            (!pnp.startsWith('PCI\\') && (lowerName.includes('virtual') || lowerName.includes('remote') || lowerName.includes('mirror')));

          // Vendor classification
          let vendor: DetectedGpu['vendor'] = 'other';
          if (lowerName.includes('nvidia') || lowerName.includes('geforce') || lowerName.includes('rtx') || lowerName.includes('gtx') || pnp.includes('VEN_10DE')) {
            vendor = 'nvidia';
          } else if (lowerName.includes('amd') || lowerName.includes('radeon') || pnp.includes('VEN_1002')) {
            vendor = 'amd';
          } else if (lowerName.includes('intel') || lowerName.includes('arc') || pnp.includes('VEN_8086')) {
            vendor = 'intel';
          } else if (isVirtual) {
            vendor = 'virtual';
          }

          const ramBytes = typeof item.AdapterRAM === 'number' ? item.AdapterRAM : parseInt(item.AdapterRAM || '0', 10);
          const adapterRamMb = ramBytes > 0 ? Math.round(ramBytes / (1024 * 1024)) : undefined;

          // Discrete GPU determination: PCIe device with NVIDIA, dedicated AMD RX, Intel Arc, or dedicated VRAM >= 1024MB
          const isDiscrete = !isVirtual && (
            vendor === 'nvidia' ||
            (vendor === 'amd' && (lowerName.includes('rx') || lowerName.includes('radeon pro') || !lowerName.includes('graphics'))) ||
            (vendor === 'intel' && lowerName.includes('arc')) ||
            (adapterRamMb !== undefined && adapterRamMb >= 1024 && pnp.startsWith('PCI\\'))
          );

          gpus.push({
            name,
            vendor,
            isDiscrete,
            isVirtual,
            adapterRamMb,
            driverVersion: item.DriverVersion || undefined,
          });
        }
      }
    } catch (err) {
      console.warn('Failed to detect GPUs via PowerShell:', err);
    }
  } else if (platform === 'darwin') {
    gpus.push({
      name: 'Apple Metal Graphics Device',
      vendor: 'apple',
      isDiscrete: true,
      isVirtual: false,
    });
  } else if (platform === 'linux') {
    try {
      const vkOut = await runCapture('vulkaninfo', ['--summary'], 3000);
      if (vkOut.stdout) {
        const lines = vkOut.stdout.split('\n');
        let currentDevice = '';
        let currentType = '';
        let currentVendor = '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (line.startsWith('deviceName')) {
            const parts = line.split('=');
            if (parts[1]) currentDevice = parts[1].trim();
          } else if (line.startsWith('deviceType')) {
            const parts = line.split('=');
            if (parts[1]) currentType = parts[1].trim();
          } else if (line.startsWith('vendorID')) {
            const parts = line.split('=');
            if (parts[1]) currentVendor = parts[1].trim();
          }
          if (currentDevice && (currentType || currentVendor)) {
            const lower = currentDevice.toLowerCase();
            const isNvidia = lower.includes('nvidia') || currentVendor.includes('0x10de');
            const isAmd = lower.includes('amd') || lower.includes('radeon') || currentVendor.includes('0x1002');
            const isVirtual = lower.includes('vmware') || lower.includes('virtualbox') || lower.includes('qemu') || lower.includes('virtio') || lower.includes('llvmpipe') || lower.includes('svga') || lower.includes('software');
            const isDiscrete = !isVirtual && (isNvidia || isAmd || currentType.includes('DISCRETE'));
            gpus.push({
              name: currentDevice,
              vendor: isNvidia ? 'nvidia' : (isAmd ? 'amd' : (isVirtual ? 'other' : 'intel')),
              isDiscrete,
              isVirtual,
            });
            currentDevice = '';
            currentType = '';
            currentVendor = '';
          }
        }
      }
    } catch {}

    if (gpus.length === 0) {
      try {
        const out = await runCapture('lspci', [], 3000);
        if (out.stdout) {
          const vgaLines = out.stdout.split('\n').filter(l => l.includes('VGA compatible controller') || l.includes('3D controller'));
          for (const line of vgaLines) {
            const parts = line.split(': ');
            const gpuDesc = (parts[1] || line).trim();
            const lower = gpuDesc.toLowerCase();
            const isNvidia = lower.includes('nvidia');
            const isAmd = lower.includes('amd') || lower.includes('radeon');
            const isVirtual = lower.includes('vmware') || lower.includes('virtualbox') || lower.includes('qemu') || lower.includes('virtio') || lower.includes('llvmpipe') || lower.includes('svga');
            gpus.push({
              name: gpuDesc,
              vendor: isNvidia ? 'nvidia' : (isAmd ? 'amd' : (isVirtual ? 'other' : 'intel')),
              isDiscrete: !isVirtual && (isNvidia || isAmd),
              isVirtual,
            });
          }
        }
      } catch {}
    }
  }

  // Deduplicate by name
  const seen = new Set<string>();
  const unique = gpus.filter(g => {
    if (seen.has(g.name)) return false;
    seen.add(g.name);
    return true;
  });

  // Sort: Physical discrete first, then integrated, then virtual adapters last
  unique.sort((a, b) => {
    if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1;
    if (a.isDiscrete !== b.isDiscrete) return a.isDiscrete ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return unique;
}

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsStorePath)) {
      return JSON.parse(fs.readFileSync(settingsStorePath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read settings.json:', err);
  }
  return {};
}

function saveSettings(settings: AppSettings) {
  try {
    const current = loadSettings();
    const merged = { ...current, ...settings };
    fs.writeFileSync(settingsStorePath, JSON.stringify(merged, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write settings.json:', err);
  }
}

function getRelinkerBinaryName(): string {
  return process.platform === 'win32' ? 'relinker.exe' : 'relinker';
}

function getDefaultOutputExecutableName(): string {
  return process.platform === 'win32' ? 'app.exe' : 'app.elf';
}

function getDefaultRelinkerPath(): string {
  const binName = getRelinkerBinaryName();
  const candidates: string[] = [];
  if (app.isPackaged) {
    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, 'build', binName),
        path.join(process.resourcesPath, binName),
        path.join(process.resourcesPath, 'build', 'relinker.exe'),
        path.join(process.resourcesPath, 'relinker.exe')
      );
    }
    try {
      const exeDir = path.dirname(app.getPath('exe'));
      candidates.push(
        path.join(exeDir, 'resources', 'build', binName),
        path.join(exeDir, 'resources', binName),
        path.join(exeDir, 'build', binName),
        path.join(exeDir, binName),
        path.join(exeDir, 'resources', 'build', 'relinker.exe'),
        path.join(exeDir, 'resources', 'relinker.exe'),
        path.join(exeDir, 'build', 'relinker.exe'),
        path.join(exeDir, 'relinker.exe')
      );
    } catch {}
  } else {
    candidates.push(
      path.resolve(__dirname, '../../build', binName),
      path.resolve(__dirname, '../../build-relinker/core/relinker/Release', binName),
      path.resolve(__dirname, '../../build-relinker/core/relinker', binName),
      path.resolve(process.cwd(), 'build', binName),
      path.resolve(process.cwd(), '../build', binName),
      path.resolve(__dirname, '../../build/relinker.exe'),
      path.resolve(__dirname, '../../build-relinker/core/relinker/Release/relinker.exe'),
      path.resolve(process.cwd(), 'build/relinker.exe'),
      path.resolve(process.cwd(), '../build/relinker.exe')
    );
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      if (process.platform !== 'win32') {
        try { fs.chmodSync(c, 0o755); } catch {}
      }
      return path.normalize(c);
    }
  }
  return candidates[0] ? path.normalize(candidates[0]) : '';
}

function getDefaultLibsPath(): string {
  const candidates: string[] = [];
  if (app.isPackaged) {
    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, 'libs', 'libs'),
        path.join(process.resourcesPath, 'libs')
      );
    }
    try {
      const exeDir = path.dirname(app.getPath('exe'));
      candidates.push(
        path.join(exeDir, 'resources', 'libs', 'libs'),
        path.join(exeDir, 'resources', 'libs'),
        path.join(exeDir, 'libs', 'libs'),
        path.join(exeDir, 'libs')
      );
    } catch {}
  } else {
    candidates.push(
      path.resolve(__dirname, '../../libs/libs'),
      path.resolve(__dirname, '../../libs'),
      path.resolve(process.cwd(), 'libs/libs'),
      path.resolve(process.cwd(), 'libs'),
      path.resolve(process.cwd(), '../libs/libs'),
      path.resolve(process.cwd(), '../libs')
    );
  }

  // First pass: prioritize candidate directory that directly contains .prx files
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const files = fs.readdirSync(c);
        if (files.some(f => f.toLowerCase().endsWith('.prx'))) {
          return path.normalize(c);
        }
      } catch {}
    }
  }

  // Second pass: fallback to any existing directory
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.normalize(c);
  }
  return candidates[0] ? path.normalize(candidates[0]) : '';
}

let runtimeManagerInstance: RuntimeManager | null = null;
function getRuntimeManager(): RuntimeManager {
  if (!runtimeManagerInstance) {
    runtimeManagerInstance = new RuntimeManager(
      app.getPath('userData'),
      getDefaultRelinkerPath,
      getDefaultLibsPath,
      loadSettings()
    );
  }
  return runtimeManagerInstance;
}

let discordRpcClientInstance: DiscordRpcClient | null = null;
function getDiscordRpcClient(): DiscordRpcClient {
  if (!discordRpcClientInstance) {
    const userSettings = loadSettings();
    discordRpcClientInstance = new DiscordRpcClient({
      clientId: userSettings.discordClientId || '1562955881182920855',
      enabled: userSettings.discordRpcEnabled !== false,
    });
  }
  return discordRpcClientInstance;
}

function getResolvedRelinkerPath(): string {
  try {
    const active = getRuntimeManager().resolveRuntime();
    if (active && active.relinkerPath && fs.existsSync(active.relinkerPath)) {
      return path.normalize(active.relinkerPath);
    }
  } catch {}
  return getDefaultRelinkerPath();
}

function getResolvedLibsPath(): string {
  try {
    const active = getRuntimeManager().resolveRuntime();
    if (active && active.libsPath && fs.existsSync(active.libsPath)) {
      return path.normalize(active.libsPath);
    }
  } catch {}
  const baseDir = getDefaultLibsPath();
  if (baseDir && fs.existsSync(baseDir)) {
    const nested = path.join(baseDir, 'libs');
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
      try {
        const nestedFiles = fs.readdirSync(nested);
        if (nestedFiles.some(f => f.toLowerCase().endsWith('.prx'))) {
          return nested;
        }
      } catch {}
    }
  }
  return baseDir;
}

let gitHubAuthServiceInstance: GitHubAuthService | null = null;
function getGitHubAuthService(): GitHubAuthService {
  if (!gitHubAuthServiceInstance) {
    gitHubAuthServiceInstance = new GitHubAuthService(app.getPath('userData'));
  }
  return gitHubAuthServiceInstance;
}

let localBuilderServiceInstance: LocalBuilderService | null = null;
function getLocalBuilderService(): LocalBuilderService {
  if (!localBuilderServiceInstance) {
    localBuilderServiceInstance = new LocalBuilderService(app.getPath('userData'));
  }
  return localBuilderServiceInstance;
}

function getPythonCommand(): string {
  if (process.platform === 'win32') return 'python';
  try {
    const res = spawnSync('python3', ['--version'], { timeout: 1000 });
    if (res.status === 0) return 'python3';
  } catch {}
  return 'python';
}

function getResolvedUnwrapScript(): string {
  const candidates: string[] = [];
  if (app.isPackaged) {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'tools', 'unwrap_self.py'));
    }
    try {
      const exeDir = path.dirname(app.getPath('exe'));
      candidates.push(
        path.join(exeDir, 'resources', 'tools', 'unwrap_self.py'),
        path.join(exeDir, 'tools', 'unwrap_self.py')
      );
    } catch {}
  } else {
    candidates.push(
      path.resolve(__dirname, '../../tools/unwrap_self.py'),
      path.resolve(process.cwd(), 'tools/unwrap_self.py'),
      path.resolve(process.cwd(), '../tools/unwrap_self.py')
    );
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.normalize(c);
  }
  return candidates[0] ? path.normalize(candidates[0]) : '';
}

function isAuthenticGuestModule(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 64 * 1024) return false;

    const buf = Buffer.alloc(64);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);

    if (bytesRead < 20) return false;

    // Check that the file is not a Windows PE executable (does NOT start with MZ / 0x4D, 0x5A)
    if (buf[0] === 0x4d && buf[1] === 0x5a) return false;

    // Check for Sony SELF magic (0x1D3D154F or 0xEEF51454)
    const magic32 = buf.readUInt32LE(0);
    if (magic32 === 0x1d3d154f || magic32 === 0xeef51454) {
      return true;
    }

    // Check for 64-bit ELF magic (\x7FELF, class ELFCLASS64 = 2, type ET_DYN / 0xFE18)
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
      if (buf[4] === 2) {
        const eType = buf.readUInt16LE(16);
        if (eType === 3 || eType === 0xfe18) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

// Every file or folder Studio moves inside a game directory is recorded here (relative to the game root),
// so "Restore Original Folder Layout" can put the dump back the way the user provided it.
const LAYOUT_LOG_NAME = '.anyps5studio-layout.json';
// Runtime signature of the core that produced the game's executable, written after each successful relink.
const RELINK_STAMP = '.relinked_with';
const BACKUP_SUFFIX = /\.(?:bak|esbak|old|orig|self_orig)(?:_[\w-]*)?$/i;

interface LayoutLog {
  move(src: string, dst: string): void;
}

function isInsideDir(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function moveEntry(src: string, dst: string) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.renameSync(src, dst);
  } catch {
    fs.cpSync(src, dst, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

function openLayoutLog(root: string): LayoutLog {
  const logPath = path.join(root, LAYOUT_LOG_NAME);
  let entries: { from: string; to: string }[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    if (Array.isArray(parsed)) entries = parsed;
  } catch {}
  return {
    move(src, dst) {
      moveEntry(src, dst);
      entries.push({ from: path.relative(root, src), to: path.relative(root, dst) });
      fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf8');
    },
  };
}

function freeBackupPath(dir: string, name: string): string {
  let target = path.join(dir, name);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${name}.${i}`);
  return target;
}

function restoreGameLayout(gameDir: string): { restored: number; failed: string[] } {
  const root = path.resolve(gameDir);
  const logPath = path.join(root, LAYOUT_LOG_NAME);
  if (!fs.existsSync(logPath)) return { restored: 0, failed: [] };
  const entries: { from: string; to: string }[] = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  let restored = 0;
  const failed: string[] = [];
  for (const entry of [...entries].reverse()) {
    const src = path.resolve(root, String(entry?.from ?? ''));
    const dst = path.resolve(root, String(entry?.to ?? ''));
    if (!isInsideDir(root, src) || !isInsideDir(root, dst) || !fs.existsSync(dst)) {
      failed.push(String(entry?.from));
      continue;
    }
    try {
      if (fs.existsSync(src)) {
        if (fs.statSync(src).isDirectory()) {
          failed.push(entry.from);
          continue;
        }
        fs.unlinkSync(src);
      }
      moveEntry(dst, src);
      try { fs.rmdirSync(path.dirname(dst)); } catch {}
      restored++;
    } catch {
      failed.push(entry.from);
    }
  }
  if (failed.length === 0) {
    fs.unlinkSync(logPath);
  } else {
    const remaining = entries.filter((e) => failed.includes(String(e?.from)));
    fs.writeFileSync(logPath, JSON.stringify(remaining, null, 2), 'utf8');
  }
  return { restored, failed };
}

function containsGameExecutable(dir: string, depth: number): boolean {
  if (depth < 0) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  const names = ['eboot.bin', 'eboot.elf', 'app.exe', 'app.elf'];
  if (entries.some((e) => e.isFile() && names.includes(e.name.toLowerCase()))) return true;
  return entries.some((e) => e.isDirectory() && !e.name.startsWith('.') && e.name.toLowerCase() !== 'module_backups'
    && containsGameExecutable(path.join(dir, e.name), depth - 1));
}

function sanitizeModuleDirectory(
  layout: LayoutLog,
  dirPath: string,
  inputElfPath: string,
  sendLog: (msg: string, level?: string) => void,
  knownSystemLibs?: Set<string>,
  preserveGuestLibc: boolean = false
) {
  if (!fs.existsSync(dirPath)) return;
  try {
    if (!fs.statSync(dirPath).isDirectory()) return;
  } catch {
    return;
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return;
  }

  const backupDir = path.join(dirPath, 'module_backups');
  const normalizedInputElf = path.resolve(inputElfPath).toLowerCase();

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const lower = entry.toLowerCase();
    const resolvedPath = path.resolve(fullPath).toLowerCase();

    // Never touch or move the designated primary executable
    if (resolvedPath === normalizedInputElf) {
      continue;
    }

    // The relinker only loads ELF files from module directories (SELF containers get unwrapped first),
    // so non-ELF game assets are never isolated, whatever their name.
    const header = Buffer.alloc(64);
    let bytesRead = 0;
    try {
      const fd = fs.openSync(fullPath, 'r');
      bytesRead = fs.readSync(fd, header, 0, 64, 0);
      fs.closeSync(fd);
    } catch {
      continue;
    }
    const isElf = bytesRead >= 20 && header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46;
    const magic32 = bytesRead >= 4 ? header.readUInt32LE(0) : 0;
    const isSelf = magic32 === 0x1d3d154f || magic32 === 0xeef51454;
    if (!isElf && !isSelf) continue;

    let shouldIsolate = false;
    let isolateReason = '';

    // Check 2: Known backup files (.bak, .esbak, .old, .orig, .self_orig, optionally with a _suffix)
    if (BACKUP_SUFFIX.test(lower)) {
      shouldIsolate = true;
      isolateReason = 'Backup artifact';
    }

    // Check 3: Fake system library stubs dumped by jailbreak tools (e.g. libSceAgc.sprx, libSceAgcDriver.sprx, libScePsml.sprx)
    // AnyPS5 already provides authoritative clean-room translations in libs/.
    // If fake dump stubs are treated as guest modules, they conflict with AnyPS5 native Vulkan/OS drivers and crash at runtime.
    if (!shouldIsolate) {
      const stem = lower.replace(/(\.sprx|\.prx|\.native|\.guest)+$/i, '');
      const hardwareDriverStubs = new Set([
        'libsceagc',
        'libsceagcdriver',
        'libscepsml',
        'libkernel',
        'libkernel_web',
        'libkernel_sys',
      ]);
      if (hardwareDriverStubs.has(stem)) {
        shouldIsolate = true;
        isolateReason = `Conflicting hardware/system driver stub (provided natively by AnyPS5 in libs/${stem}.prx)`;
      } else if (stem === 'libc' || stem === 'libscelibcinternal') {
        if (!lower.endsWith('.guest.prx') && !isAuthenticGuestModule(fullPath)) {
          shouldIsolate = true;
          isolateReason = `Dummy or corrupt guest ${entry} (size < 64KB or non-authentic module header)`;
        }
      }
    }

    // Check 4: Inspect ELF header to detect non-shared ELFs (ET_EXEC = 2, etc.)
    // Check 4: non-shared ELFs (including decrypted eboot executables) make the relinker fail with
    // "ELF is not a shared module". 3 = ET_DYN, 0xfe18 = ET_SCE_DYNAMIC.
    if (!shouldIsolate && isElf) {
      const eType = header.readUInt16LE(16);
      if (eType !== 3 && eType !== 0xfe18) {
        shouldIsolate = true;
        isolateReason = `Non-shared ELF (e_type=0x${eType.toString(16)})`;
      }
    }

    if (shouldIsolate) {
      try {
        layout.move(fullPath, freeBackupPath(backupDir, entry));
        sendLog(`[AnyPS5] Isolated ${entry} (${isolateReason}) to module_backups/`, 'info');
      } catch (err) {
        console.warn(`Failed to isolate ${entry}:`, err);
      }
    }
  }
}

// Executables are hundreds of MB and these checks run on every launch: stream them instead of
// reading whole files into memory, and remember the answer until the file changes.
const fileScanCache = new Map<string, boolean>();
async function fileContainsAny(filePath: string, needles: Buffer[]): Promise<boolean> {
  const stat = await fs.promises.stat(filePath);
  const key = [filePath, stat.size, stat.mtimeMs, ...needles.map((n) => n.toString('hex'))].join('|');
  const cached = fileScanCache.get(key);
  if (cached !== undefined) return cached;
  const overlap = Math.max(...needles.map((n) => n.length)) - 1;
  let tail = Buffer.alloc(0);
  let found = false;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1 << 20 })) {
    const window = Buffer.concat([tail, chunk as Buffer]);
    if (needles.some((n) => window.includes(n))) {
      found = true;
      break;
    }
    tail = window.subarray(Math.max(0, window.length - overlap));
  }
  fileScanCache.set(key, found);
  return found;
}

async function fixGameHierarchyInPlace(
  gameDir: string,
  sendLog: (msg: string, level?: string) => void,
  mode: 'launch' | 'relink' = 'launch',
  customLibsPath?: string,
  runtimeIdentifier?: string
) {
  const resolved = path.resolve(gameDir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Game directory does not exist: "${resolved}"`);
  }
  // Never reorganize a folder that does not actually contain a PS5 title (e.g. a wrongly picked parent folder).
  if (!containsGameExecutable(resolved, 7)) {
    throw new Error(`No PS5 executable (eboot.bin / eboot.elf / app.exe / app.elf) found in "${resolved}". The folder was left untouched.`);
  }
  const layout = openLayoutLog(resolved);

  // 1. Flatten single wrapper directories if present in-place (handles nested wrappers like [DLPS].../[DLPS]...)
  try {
    for (let depth = 0; depth < 5; depth++) {
      const rootEntries = fs.readdirSync(resolved).filter((e) => e !== LAYOUT_LOG_NAME);
      if (rootEntries.length !== 1) break;
      const singlePath = path.join(resolved, rootEntries[0]);
      if (!fs.statSync(singlePath).isDirectory() || ['app0', 'libs'].includes(rootEntries[0])) break;
      if (!containsGameExecutable(singlePath, 6)) break;

      if (rootEntries[0].toLowerCase().endsWith('-app0') || rootEntries[0].toLowerCase().includes('app0')) {
        const app0Target = path.join(resolved, 'app0');
        if (!fs.existsSync(app0Target)) {
          sendLog(`[AnyPS5] Normalizing wrapper directory "${rootEntries[0]}" -> "app0"...`, 'info');
          layout.move(singlePath, app0Target);
        }
        break;
      } else {
        sendLog(`[AnyPS5] Unnesting contents of "${rootEntries[0]}" in-place...`, 'info');
        const innerFiles = fs.readdirSync(singlePath);
        for (const inner of innerFiles) {
          const src = path.join(singlePath, inner);
          const dst = path.join(resolved, inner);
          if (!fs.existsSync(dst)) {
            layout.move(src, dst);
          }
        }
        try {
          fs.rmdirSync(singlePath);
        } catch {}
      }
    }
  } catch (flattenErr) {
    console.error('Unnest check error:', flattenErr);
  }

  // 2. Ensure app0/ container exists for guest PlayStation 5 filesystem
  const app0Dir = path.join(resolved, 'app0');
  if (!fs.existsSync(app0Dir)) {
    sendLog(`[AnyPS5] Creating in-place app0/ container for PlayStation 5 guest filesystem...`, 'info');
    fs.mkdirSync(app0Dir, { recursive: true });

    // Move all game assets and folders into app0/ in-place (instant O(1) filesystem metadata rename)
    const skipEntries = new Set(['app0', 'libs', 'app.exe', 'app.elf', 'eboot.elf', 'relinker.log', 'run_test.log', 'run_game.log', 'run_extended.log', 'anyps5.log', 'anyps5.prev.log', LAYOUT_LOG_NAME, RELINK_STAMP]);
    const allEntries = fs.readdirSync(resolved);
    for (const entry of allEntries) {
      if (skipEntries.has(entry)) continue;
      const src = path.join(resolved, entry);
      const dst = path.join(app0Dir, entry);
      if (!fs.existsSync(dst)) {
        layout.move(src, dst);
      }
    }
  } else {
    // Check for redundant nested app0/app0 hierarchy created by archive extraction tools
    try {
      const nestedApp0 = path.join(app0Dir, 'app0');
      if (fs.existsSync(nestedApp0) && fs.statSync(nestedApp0).isDirectory()) {
        const nestedFiles = fs.readdirSync(nestedApp0);
        if (nestedFiles.some((f) => f.toLowerCase().startsWith('eboot') || f.toLowerCase() === 'sce_sys' || f.toLowerCase() === 'sce_module')) {
          sendLog(`[AnyPS5] Flattening redundant nested "app0/app0" directory container...`, 'info');
          for (const item of nestedFiles) {
            const src = path.join(nestedApp0, item);
            const dst = path.join(app0Dir, item);
            if (!fs.existsSync(dst)) {
              layout.move(src, dst);
            }
          }
          try { fs.rmdirSync(nestedApp0); } catch {}
        }
      }
    } catch (nestedErr) {
      console.warn('Nested app0 check error:', nestedErr);
    }
  }

  // 3. Deploy clean-room PRX system libraries and runtime DLLs into libs/ and application directory
  const gameLibs = path.join(resolved, 'libs');
  if (!fs.existsSync(gameLibs) || !fs.statSync(gameLibs).isDirectory()) {
    if (fs.existsSync(gameLibs)) layout.move(gameLibs, freeBackupPath(path.join(resolved, 'module_backups'), 'libs'));
    fs.mkdirSync(gameLibs, { recursive: true });
  }

  const runtimeStampFile = path.join(gameLibs, '.runtime_deployed');
  const prevStamp = fs.existsSync(runtimeStampFile) ? fs.readFileSync(runtimeStampFile, 'utf8').trim() : '';
  const runtimeChanged = Boolean(runtimeIdentifier && prevStamp && prevStamp !== runtimeIdentifier);
  const forceRedeploy = runtimeChanged || !prevStamp;

  const knownSystemLibs = new Set<string>();
  const sourceLibs = (customLibsPath && fs.existsSync(customLibsPath)) ? customLibsPath : getResolvedLibsPath();
  if (sourceLibs && fs.existsSync(sourceLibs)) {
    const collectSourceFiles = (dir: string): { name: string; fullPath: string; stat: fs.Stats }[] => {
      const results: { name: string; fullPath: string; stat: fs.Stats }[] = [];
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const full = path.join(dir, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isFile()) {
              results.push({ name: entry, fullPath: full, stat });
            } else if (stat.isDirectory() && entry.toLowerCase() === 'libs') {
              results.push(...collectSourceFiles(full));
            }
          } catch {}
        }
      } catch {}
      return results;
    };

    const sourceFiles = collectSourceFiles(sourceLibs);

    // Apply any local PRX/DLL overrides from core/libs/overrides
    const overrideCandidates = [
      path.resolve(__dirname, '../../core/libs/overrides'),
      path.resolve(process.cwd(), 'core/libs/overrides'),
      path.resolve(process.cwd(), '../core/libs/overrides'),
    ];
    for (const cand of overrideCandidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
        const overrides = collectSourceFiles(cand);
        for (const ov of overrides) {
          const existingIdx = sourceFiles.findIndex(f => f.name.toLowerCase() === ov.name.toLowerCase());
          if (existingIdx >= 0) {
            sourceFiles[existingIdx] = ov;
          } else {
            sourceFiles.push(ov);
          }
        }
        break;
      }
    }

    if (runtimeChanged) {
      sendLog(`[AnyPS5] Active runtime engine or version changed (${prevStamp} -> ${runtimeIdentifier}). Purging and re-deploying system PRX libraries...`, 'info');
      if (mode === 'launch' && !fs.existsSync(path.join(resolved, RELINK_STAMP))) {
        sendLog('[AnyPS5 Runtime] This title was relinked with an earlier core. If it fails to start, relink it in Relinker Studio.', 'warn');
      }
      try {
        const sourceFileNames = new Set(sourceFiles.map(f => f.name.toLowerCase()));
        const currentLibs = fs.readdirSync(gameLibs);
        for (const cur of currentLibs) {
          if (cur.toLowerCase().endsWith('.prx') && !sourceFileNames.has(cur.toLowerCase())) {
            try { fs.unlinkSync(path.join(gameLibs, cur)); } catch {}
          }
        }
      } catch {}
    }

    let copiedLibsCount = 0;
    let copiedRootCount = 0;

    for (const { name: file, fullPath: s, stat } of sourceFiles) {
      const lower = file.toLowerCase();
      const isPrx = lower.endsWith('.prx');
      const isDll = lower.endsWith('.dll');
      const isSo = lower.endsWith('.so') || lower.includes('.so.');

      if (isPrx) {
        const stem = lower.replace(/(\.prx|\.native)+$/i, '');
        knownSystemLibs.add(stem);
      }

      const shouldCopy = (dstPath: string): boolean => {
        if (forceRedeploy || !fs.existsSync(dstPath)) return true;
        try {
          const dstStat = fs.statSync(dstPath);
          if (dstStat.size !== stat.size) return true;
          if (Math.abs(dstStat.mtimeMs - stat.mtimeMs) > 1000) return true;
          return false;
        } catch {
          return true;
        }
      };

      const copyWithMtime = (src: string, dst: string): boolean => {
        try {
          fs.copyFileSync(src, dst);
          try { fs.utimesSync(dst, stat.atime, stat.mtime); } catch {}
          if (process.platform !== 'win32') {
            try { fs.chmodSync(dst, 0o755); } catch {}
          }
          return true;
        } catch {
          return false;
        }
      };

      const dLibs = path.join(gameLibs, file);
      if (shouldCopy(dLibs)) {
        if (copyWithMtime(s, dLibs)) {
          copiedLibsCount++;
        }
      }

      if (isDll || isPrx || isSo) {
        const dRoot = path.join(resolved, file);
        if (shouldCopy(dRoot)) {
          if (copyWithMtime(s, dRoot)) {
            copiedRootCount++;
          }
        }

        if (isDll || isSo) {
          const dApp0 = path.join(app0Dir, file);
          if (shouldCopy(dApp0)) {
            copyWithMtime(s, dApp0);
          }
        }
      }
    }

    if (runtimeIdentifier) {
      try {
        fs.writeFileSync(runtimeStampFile, runtimeIdentifier, 'utf8');
      } catch {}
    }

    if (copiedLibsCount > 0 || copiedRootCount > 0) {
      sendLog(`[AnyPS5] Deployed clean-room PRX system libraries and runtime DLLs into libs/ and application directory.`, 'success');
    }
  }

  // 4. Ensure app0/sce_sys/ exists, synchronize metadata, and normalize param.json
  const app0SceSys = path.join(app0Dir, 'sce_sys');
  const rootSceSys = path.join(resolved, 'sce_sys');
  const app0SceSysUpper = path.join(app0Dir, 'SCE_SYS');
  const rootSceSysUpper = path.join(resolved, 'SCE_SYS');

  if (fs.existsSync(app0SceSysUpper) && !fs.existsSync(app0SceSys)) {
    try { layout.move(app0SceSysUpper, app0SceSys); } catch {}
  }

  const activeRootSys = fs.existsSync(rootSceSys) ? rootSceSys : (fs.existsSync(rootSceSysUpper) ? rootSceSysUpper : null);
  if (activeRootSys) {
    if (!fs.existsSync(app0SceSys)) fs.mkdirSync(app0SceSys, { recursive: true });
    try {
      const sysEntries = fs.readdirSync(activeRootSys);
      for (const se of sysEntries) {
        const src = path.join(activeRootSys, se);
        const dst = path.join(app0SceSys, se.toLowerCase());
        if (!fs.existsSync(dst)) {
          try {
            fs.copyFileSync(src, dst);
            if (process.platform !== 'win32') {
              try { fs.chmodSync(dst, 0o644); } catch {}
            }
          } catch {}
        }
      }
      sendLog(`[AnyPS5] Synchronized sce_sys/ title metadata into app0/sce_sys/`, 'info');
    } catch (sysErr) {
      console.warn('Failed to sync root sce_sys into app0/sce_sys:', sysErr);
    }
  }

  if (!fs.existsSync(app0SceSys)) {
    fs.mkdirSync(app0SceSys, { recursive: true });
  }

  const paramJsonPath = path.join(app0SceSys, 'param.json');
  if (!fs.existsSync(paramJsonPath)) {
    try {
      const sysFiles = fs.readdirSync(app0SceSys);
      for (const sf of sysFiles) {
        if (sf.toLowerCase() === 'param.json') {
          fs.copyFileSync(path.join(app0SceSys, sf), paramJsonPath);
          break;
        }
      }
    } catch {}
  }

  if (!fs.existsSync(paramJsonPath)) {
    const candidateLocations = [
      path.join(resolved, 'param.json'),
      path.join(resolved, 'PARAM.JSON'),
      path.join(app0Dir, 'param.json'),
      path.join(app0Dir, 'PARAM.JSON'),
    ];
    for (const cand of candidateLocations) {
      if (fs.existsSync(cand)) {
        try {
          fs.copyFileSync(cand, paramJsonPath);
          sendLog(`[AnyPS5] Restored param.json into app0/sce_sys/ from ${path.relative(resolved, cand)}`, 'info');
          break;
        } catch {}
      }
    }
  }

  if (!fs.existsSync(paramJsonPath)) {
    try {
      let detectedTitleId = '';
      let detectedTitleName = '';

      if (fs.existsSync(gamesStorePath)) {
        try {
          const storedGames = JSON.parse(fs.readFileSync(gamesStorePath, 'utf8'));
          if (Array.isArray(storedGames)) {
            const match = storedGames.find((g: any) => g && g.path && path.resolve(g.path).toLowerCase() === path.resolve(resolved).toLowerCase());
            if (match) {
              detectedTitleId = match.titleId || '';
              detectedTitleName = match.title || '';
            }
          }
        } catch {}
      }

      if (!detectedTitleId) {
        const m = resolved.match(/[CUP][UPL][SAB][A-Z]\d{5}/i);
        if (m) detectedTitleId = m[0].toUpperCase();
      }

      if (!detectedTitleName) {
        detectedTitleName = path.basename(resolved).replace(/\[.*?\]|\(.*?\)/g, '').trim() || 'PlayStation 5 Title';
      }

      const generatedParam = {
        titleId: detectedTitleId || 'PPSA12544',
        contentId: `EP0000-${detectedTitleId || 'PPSA12544'}_00-0000000000000000`,
        localizedParameters: {
          defaultLanguage: 'en-US',
          'en-US': {
            titleName: detectedTitleName,
          },
        },
      };

      fs.writeFileSync(paramJsonPath, JSON.stringify(generatedParam, null, 2), 'utf8');
      sendLog(`[AnyPS5] Synthesized authentic app0/sce_sys/param.json for Title ID: ${generatedParam.titleId}`, 'info');
    } catch (genErr) {
      console.warn('Failed to synthesize param.json:', genErr);
    }
  }

  if (process.platform !== 'win32' && fs.existsSync(paramJsonPath)) {
    try { fs.chmodSync(paramJsonPath, 0o644); } catch {}
  }

  // Normalize param.json if kernel.flexibleMemorySize is 0 (prevents libkernel abort)
  if (fs.existsSync(paramJsonPath)) {
    try {
      const pj = JSON.parse(fs.readFileSync(paramJsonPath, 'utf8'));
      if (pj.kernel && pj.kernel.flexibleMemorySize === 0) {
        delete pj.kernel.flexibleMemorySize;
        if (Object.keys(pj.kernel).length === 0) delete pj.kernel;
        fs.writeFileSync(paramJsonPath, JSON.stringify(pj, null, 2), 'utf8');
        sendLog(`[AnyPS5] Normalized param.json kernel memory configuration.`, 'info');
      }
    } catch {}
  }

  // 5. Detect and unwrap SELF container eboot.bin -> eboot.elf in app0/
  let inputElf = path.join(app0Dir, 'eboot.elf');
  let fallbackElf = path.join(resolved, 'eboot.elf');
  let ebootBin = path.join(app0Dir, 'eboot.bin');
  if (!fs.existsSync(ebootBin)) {
    ebootBin = path.join(resolved, 'eboot.bin');
  }

  // Fallback search: if eboot is not in root or app0/, search subdirectories (e.g. decrypted/ or custom dump folders)
  if (!fs.existsSync(inputElf) && !fs.existsSync(fallbackElf) && !fs.existsSync(ebootBin)) {
    const findEbootInSubdir = (dir: string, depth = 0): string | null => {
      if (depth > 3) return null;
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const full = path.join(dir, entry);
          const stat = fs.statSync(full);
          if (stat.isFile()) {
            const lower = entry.toLowerCase();
            if (lower === 'eboot.bin' || lower === 'eboot.elf') {
              return full;
            }
          } else if (stat.isDirectory()) {
            const lower = entry.toLowerCase();
            if (!['libs', 'sce_sys', 'module_backups', 'sce_module_backups'].includes(lower) && !entry.startsWith('.')) {
              const found = findEbootInSubdir(full, depth + 1);
              if (found) return found;
            }
          }
        }
      } catch {}
      return null;
    };

    const nestedEboot = findEbootInSubdir(app0Dir) || findEbootInSubdir(resolved);
    if (nestedEboot) {
      sendLog(`[AnyPS5] Located game executable in subfolder: "${path.relative(resolved, nestedEboot)}". Promoting to app0/eboot.bin...`, 'info');
      ebootBin = path.join(app0Dir, 'eboot.bin');
      try {
        fs.copyFileSync(nestedEboot, ebootBin);
      } catch (copyErr) {
        console.warn('Failed to copy nested eboot:', copyErr);
      }
    }
  }

  if (fs.existsSync(inputElf)) {
    if (!fs.existsSync(fallbackElf)) {
      try { fs.copyFileSync(inputElf, fallbackElf); } catch {}
    }
  } else if (fs.existsSync(fallbackElf)) {
    fs.copyFileSync(fallbackElf, inputElf);
  } else if (fs.existsSync(ebootBin)) {
    try {
      const buffer = Buffer.alloc(4);
      const fd = fs.openSync(ebootBin, 'r');
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);
      const magic = buffer.readUInt32LE(0);
      if (magic === 0x1D3D154F || magic === 0xEEF51454) {
        sendLog(`[AnyPS5] Detected encrypted/signed SELF container in eboot.bin. Unwrapping container...`, 'info');
        try {
          unwrapSelf(ebootBin, inputElf);
          if (fs.existsSync(inputElf)) {
            fs.copyFileSync(inputElf, fallbackElf);
            sendLog(`[AnyPS5] Successfully unwrapped SELF container into eboot.elf.`, 'success');
          } else {
            throw new Error('Unwrapped eboot.elf not generated');
          }
        } catch (nativeErr: any) {
          sendLog(`[AnyPS5] Native unwrapper reported: ${nativeErr.message}. Attempting fallback via tools/unwrap_self.py...`, 'warn');
          const unwrapScript = getResolvedUnwrapScript();
          const unwrapRes = spawnSync(getPythonCommand(), [unwrapScript, ebootBin, inputElf], { cwd: resolved });
          if (unwrapRes.status === 0 && fs.existsSync(inputElf)) {
            fs.copyFileSync(inputElf, fallbackElf);
            sendLog(`[AnyPS5] Successfully unwrapped SELF container into eboot.elf via fallback.`, 'success');
          } else {
            throw new Error(`Failed to unwrap SELF eboot.bin: ${nativeErr.message || unwrapRes.stderr?.toString()}`);
          }
        }
      } else {
        fs.copyFileSync(ebootBin, inputElf);
        fs.copyFileSync(ebootBin, fallbackElf);
      }
    } catch (selfErr: any) {
      sendLog(`[AnyPS5 Error] SELF unwrap error: ${selfErr.message}`, 'error');
      throw selfErr;
    }
  }

  // 6. Ensure guest module directory structure complies with relinker requirements
  const sceModuleDir = path.join(app0Dir, 'sce_module');
  const sceModulesDir = path.join(app0Dir, 'sce_modules');
  const prxDir = path.join(app0Dir, 'prx');

  // Relinker aborts if both sce_module and sce_modules exist
  if (fs.existsSync(sceModuleDir) && fs.existsSync(sceModulesDir)) {
    sendLog(`[AnyPS5] Merging duplicate guest module directory "sce_modules" into "sce_module"...`, 'info');
    try {
      const files = fs.readdirSync(sceModulesDir);
      for (const f of files) {
        const src = path.join(sceModulesDir, f);
        const dst = path.join(sceModuleDir, f);
        if (!fs.existsSync(dst)) {
          layout.move(src, dst);
        }
      }
      try { fs.rmdirSync(sceModulesDir); } catch {}
    } catch (mergeErr) {
      console.warn('Failed to merge sce_modules:', mergeErr);
    }
  }

  // Relinker requires at least one of sce_module, sce_modules, or prx to exist
  const hasSingular = fs.existsSync(sceModuleDir);
  const hasPlural = fs.existsSync(sceModulesDir);
  const hasPrx = fs.existsSync(prxDir);
  if (!hasSingular && !hasPlural && !hasPrx) {
    sendLog(`[AnyPS5] Initializing standard guest module directory "app0/sce_module"...`, 'info');
    fs.mkdirSync(sceModuleDir, { recursive: true });
  }

  const targetModuleDir = hasSingular ? sceModuleDir : (hasPlural ? sceModulesDir : (hasPrx ? prxDir : sceModuleDir));

  // Self-Healing: Check if authentic guest libc / libSceLibcInternal was previously isolated into module_backups
  const libcNames = ['libc.prx', 'libc.sprx', 'libSceLibcInternal.prx', 'libscelibcinternal.prx'];
  const backupDirsToCheck = [
    path.join(sceModuleDir, 'module_backups'),
    path.join(app0Dir, 'module_backups'),
    path.join(resolved, 'module_backups'),
    path.join(targetModuleDir, 'module_backups'),
  ];

  for (const libcName of libcNames) {
    const activeTarget = path.join(sceModuleDir, libcName);
    if (!fs.existsSync(activeTarget)) {
      for (const bDir of backupDirsToCheck) {
        const backupFile = path.join(bDir, libcName);
        if (fs.existsSync(backupFile) && isAuthenticGuestModule(backupFile)) {
          try {
            if (!fs.existsSync(sceModuleDir)) fs.mkdirSync(sceModuleDir, { recursive: true });
            fs.copyFileSync(backupFile, activeTarget);
            sendLog(`[AnyPS5] Restored authentic guest ${libcName} from module_backups to sce_module/`, 'info');
            break;
          } catch (restoreErr) {
            console.warn(`Failed to restore ${libcName} from backup:`, restoreErr);
          }
        }
      }
    }
  }

  // Check if existing executable, guest modules, or bundled files rely on guest libc
  const targetExeName = getDefaultOutputExecutableName();
  const candidateExes = [
    path.join(resolved, targetExeName),
    path.join(resolved, targetExeName === 'app.elf' ? 'app.exe' : 'app.elf'),
    path.join(app0Dir, targetExeName),
    path.join(app0Dir, targetExeName === 'app.elf' ? 'app.exe' : 'app.elf'),
  ];

  let needsGuestLibc = false;
  for (const libcName of ['libc.prx', 'libc.sprx']) {
    const candidateLibc = path.join(sceModuleDir, libcName);
    const candidateLibcTarget = path.join(targetModuleDir, libcName);
    if ((fs.existsSync(candidateLibc) && isAuthenticGuestModule(candidateLibc)) ||
        (fs.existsSync(candidateLibcTarget) && isAuthenticGuestModule(candidateLibcTarget))) {
      needsGuestLibc = true;
      break;
    }
  }

  const guestLibcUtf8 = Buffer.from('libc.prx.guest.prx', 'utf8');
  const guestLibcUtf16 = Buffer.from('libc.prx.guest.prx', 'utf16le');

  if (!needsGuestLibc) {
    for (const exePath of candidateExes) {
      if (fs.existsSync(exePath)) {
        try {
          if (await fileContainsAny(exePath, [guestLibcUtf8, guestLibcUtf16])) {
            needsGuestLibc = true;
            break;
          }
        } catch {}
      }
    }
  }

  if (!needsGuestLibc) {
    for (const checkDir of [sceModuleDir, sceModulesDir, prxDir, app0Dir]) {
      if (!fs.existsSync(checkDir)) continue;
      try {
        const entries = fs.readdirSync(checkDir);
        for (const ent of entries) {
          if (ent.endsWith('.guest.prx') && ent !== 'libc.prx.guest.prx') {
            const fullModPath = path.join(checkDir, ent);
            try {
              if (await fileContainsAny(fullModPath, [guestLibcUtf8, guestLibcUtf16])) {
                needsGuestLibc = true;
                break;
              }
            } catch {}
          }
        }
        if (needsGuestLibc) break;
      } catch {}
    }
  }

  // Ensure all module directories, app0, and root are sanitized for backup artifacts (.bak_*), non-shared ELFs, and conflicting hardware stubs
  if (fs.existsSync(targetModuleDir)) {
    sanitizeModuleDirectory(layout, targetModuleDir, inputElf, sendLog, knownSystemLibs, needsGuestLibc);
  }
  if (fs.existsSync(app0Dir)) {
    sanitizeModuleDirectory(layout, app0Dir, inputElf, sendLog, knownSystemLibs, needsGuestLibc);
  }

  // Clean up any obsolete hardware driver artifacts that conflict with AnyPS5 native translations
  for (const guestSysPrx of ['libkernel.prx.guest.prx']) {
    for (const searchDir of [resolved, app0Dir, sceModuleDir, sceModulesDir, prxDir, targetModuleDir]) {
      if (!fs.existsSync(searchDir)) continue;
      const target = path.join(searchDir, guestSysPrx);
      if (fs.existsSync(target)) {
        try {
          const backup = path.join(searchDir, 'module_backups', guestSysPrx);
          if (!fs.existsSync(path.dirname(backup))) fs.mkdirSync(path.dirname(backup), { recursive: true });
          if (fs.existsSync(backup)) fs.unlinkSync(backup);
          fs.renameSync(target, backup);
          sendLog(`[AnyPS5] Isolated conflicting hardware driver artifact "${guestSysPrx}" to module_backups/`, 'info');
        } catch {}
      }
    }
  }

  // Ensure guest libc artifact is retained or restored from backup when needed
  if (needsGuestLibc) {
    for (const searchDir of [resolved, app0Dir, sceModuleDir, sceModulesDir, prxDir, targetModuleDir]) {
      if (!fs.existsSync(searchDir)) continue;
      const active = path.join(searchDir, 'libc.prx.guest.prx');
      const backupCandidates = [
        path.join(searchDir, 'module_backups', 'libc.prx.guest.prx'),
        path.join(targetModuleDir, 'module_backups', 'libc.prx.guest.prx'),
        path.join(app0Dir, 'module_backups', 'libc.prx.guest.prx'),
        path.join(sceModuleDir, 'module_backups', 'libc.prx.guest.prx'),
      ];
      if (!fs.existsSync(active)) {
        for (const backup of backupCandidates) {
          if (fs.existsSync(backup)) {
            try {
              fs.copyFileSync(backup, active);
              sendLog(`[AnyPS5] Restored guest libc artifact "${path.basename(active)}" from module_backups to ${path.relative(resolved, active)}`, 'info');
              break;
            } catch {}
          }
        }
      }
    }
  }

  // 7. Discover, clean, unwrap and deduplicate all guest modules across app0/
  const moduleDirs: string[] = [];
  try {
    const unwrapScript = getResolvedUnwrapScript();

    // Helper to inspect binary header for ELF magic and encrypted SELF container magic
    const inspectModuleType = (filePath: string): { isElf: boolean; isSelf: boolean; size: number; mtime: number } => {
      try {
        const stat = fs.statSync(filePath);
        const buf = Buffer.alloc(4);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        const magic = buf.readUInt32LE(0);
        const isElf = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
        const isSelf = magic === 0x1D3D154F || magic === 0xEEF51454;
        return { isElf, isSelf, size: stat.size, mtime: stat.mtimeMs };
      } catch {
        return { isElf: false, isSelf: false, size: 0, mtime: 0 };
      }
    };

    // Phase A: Recursively scan directories, isolate fake/dumper stubs, and unwrap encrypted modules
    const candidateDirs = new Set<string>();

    function scanDirectory(currentDir: string) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(currentDir);
      } catch {
        return;
      }

      const dirNameLower = path.basename(currentDir).toLowerCase();
      // Isolate dummy jailbreak dumper folders (e.g. fakelib, fake_lib, dummylibs)
      if (['fakelib', 'fake_lib', 'fakelibs', 'fake_module', 'fake_modules', 'dummylibs'].includes(dirNameLower)) {
        sendLog(`[AnyPS5] Isolating dummy dumper stub folder "${dirNameLower}" to module_backups/`, 'info');
        const parentBackup = path.join(path.dirname(currentDir), 'module_backups', dirNameLower);
        try {
          if (fs.existsSync(parentBackup)) {
            // The original is already backed up; this copy was regenerated by the launch-mode fakelib bridge.
            fs.rmSync(currentDir, { recursive: true, force: true });
          } else {
            layout.move(currentDir, parentBackup);
          }
        } catch (fakeMoveErr) {
          console.warn('Failed to move fake stub folder:', fakeMoveErr);
        }
        return;
      }

      const prxFiles: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          const lower = entry.toLowerCase();
          if (!['sce_sys', 'sce_module_backups', 'module_backups', 'libs'].includes(lower) && !entry.startsWith('.')) {
            scanDirectory(fullPath);
          }
        } else if (stat.isFile()) {
          const lower = entry.toLowerCase();
          if (
            lower.endsWith('.prx') ||
            lower.endsWith('.sprx') ||
            lower.includes('.prx.') ||
            lower.includes('.sprx.') ||
            BACKUP_SUFFIX.test(lower)
          ) {
            prxFiles.push(entry);
          }
        }
      }

      if (prxFiles.length > 0) {
        // Sanitize this directory: filter out eboot binaries, non-shared ELFs, backup artifacts, and fake system stubs
        sanitizeModuleDirectory(layout, currentDir, inputElf, sendLog, knownSystemLibs, needsGuestLibc);

        const backupDir = path.join(currentDir, 'module_backups');

        // Unwrap any encrypted SELF modules in-place
        for (const prx of prxFiles) {
          const fullPrx = path.join(currentDir, prx);
          if (!fs.existsSync(fullPrx)) continue;
          try {
            const modInfo = inspectModuleType(fullPrx);
            if (modInfo.isSelf) {
              const unwrapped = fullPrx + '.unwrapped';
              let unwrapSuccess = false;
              try {
                unwrapSelf(fullPrx, unwrapped);
                if (fs.existsSync(unwrapped)) {
                  unwrapSuccess = true;
                }
              } catch (nativeErr) {
                const res = spawnSync(getPythonCommand(), [unwrapScript, fullPrx, unwrapped]);
                if (res.status === 0 && fs.existsSync(unwrapped)) {
                  unwrapSuccess = true;
                }
              }
              if (unwrapSuccess) {
                layout.move(fullPrx, freeBackupPath(backupDir, prx + '.self_orig'));
                moveEntry(unwrapped, fullPrx);
                sendLog(`[AnyPS5] Unwrapped encrypted module: ${path.relative(app0Dir, fullPrx)}`, 'info');
              }
            }
          } catch (modErr: any) {
            console.error('Module unwrap error:', modErr);
          }
        }

        candidateDirs.add(currentDir);
      }
    }

    scanDirectory(app0Dir);
    if (fs.existsSync(sceModuleDir)) candidateDirs.add(sceModuleDir);
    if (fs.existsSync(prxDir)) candidateDirs.add(prxDir);

    // Phase B: Cross-directory guest module deduplication
    // In titles like Marvel's Wolverine, duplicate copies of identical modules (e.g. libRenoirCore.PS5.prx)
    // can exist across multiple directories (e.g. sce_module/ and decrypted/).
    // Relinker's GuestModuleBuilder registers output files by filename (<stem>.guest.prx) and throws:
    // "FAIL: Conflicting guest output filename: libRenoirCore.PS5.prx.guest.prx" if the same module is discovered twice.
    // We register the best candidate (preferring decrypted ELF, standard sce_module location, or newer timestamp)
    // and isolate conflicting duplicates to module_backups/.
    interface GuestCandidate {
      fullPath: string;
      dir: string;
      entry: string;
      isElf: boolean;
      size: number;
      mtime: number;
      isStandardDir: boolean;
    }

    const seenGuestModules = new Map<string, GuestCandidate>();

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      let dirEntries: string[] = [];
      try {
        dirEntries = fs.readdirSync(dir);
      } catch {
        continue;
      }

      for (const entry of dirEntries) {
        const fullPath = path.join(dir, entry);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;

        const lower = entry.toLowerCase();
        if (!lower.endsWith('.prx') && !lower.endsWith('.sprx')) continue;
        if (path.resolve(fullPath).toLowerCase() === path.resolve(inputElf).toLowerCase()) continue;

        const modInfo = inspectModuleType(fullPath);
        const relDir = path.relative(app0Dir, dir).replace(/\\/g, '/');
        const isStandardDir = ['sce_module', 'sce_modules', 'prx'].includes(relDir);

        const candidate: GuestCandidate = {
          fullPath,
          dir,
          entry,
          isElf: modInfo.isElf,
          size: modInfo.size,
          mtime: modInfo.mtime,
          isStandardDir,
        };

        const key = lower;
        const existing = seenGuestModules.get(key);

        if (!existing) {
          seenGuestModules.set(key, candidate);
        } else {
          // Compare existing candidate vs new candidate
          let keepCandidate = false;

          // Priority 1: Decrypted ELF over encrypted SELF or unknown binary
          if (candidate.isElf && !existing.isElf) {
            keepCandidate = true;
          } else if (!candidate.isElf && existing.isElf) {
            keepCandidate = false;
          } else if (candidate.isStandardDir && !existing.isStandardDir) {
            // Priority 2: Standard PlayStation module directory (sce_module)
            keepCandidate = true;
          } else if (!candidate.isStandardDir && existing.isStandardDir) {
            keepCandidate = false;
          } else {
            // Priority 3: Larger file size or newer modification timestamp
            keepCandidate = candidate.size > existing.size || (candidate.size === existing.size && candidate.mtime > existing.mtime);
          }

          const winner = keepCandidate ? candidate : existing;
          const loser = keepCandidate ? existing : candidate;

          // Isolate conflicting duplicate to that directory's module_backups/
          const loserBackupDir = path.join(loser.dir, 'module_backups');
          try {
            layout.move(loser.fullPath, freeBackupPath(loserBackupDir, loser.entry));
            sendLog(`[AnyPS5] Deduplicated guest module "${loser.entry}" (conflicting duplicate in "${path.relative(app0Dir, loser.fullPath)}" isolated to module_backups/)`, 'info');
          } catch (dedupErr) {
            console.warn(`Failed to isolate duplicate module ${loser.fullPath}:`, dedupErr);
          }

          seenGuestModules.set(key, winner);
        }
      }
    }

    // Phase C: Register relative directories that still contain active, non-duplicate guest modules
    const discoveredDirs = new Set<string>();
    for (const [, mod] of seenGuestModules) {
      const rel = path.relative(app0Dir, mod.dir).replace(/\\/g, '/');
      if (rel) {
        if (!['sce_module', 'sce_modules', 'prx'].includes(rel)) {
          discoveredDirs.add(rel);
        }
      } else {
        // Bundled guest PRX modules located directly in app0/ root (e.g. libcohtml, libfmod in Minecraft)
        // Per AnyPS5 specification: "--module-dir . is the parent itself, without the input ELF"
        discoveredDirs.add('.');
      }
    }

    moduleDirs.push(...Array.from(discoveredDirs));
  } catch (modScanErr) {
    console.error('Guest module scan error:', modScanErr);
  }

  const defaultExeName = getDefaultOutputExecutableName();
  let outputExe = path.join(resolved, defaultExeName);
  if (!fs.existsSync(outputExe)) {
    const altExe = path.join(resolved, defaultExeName === 'app.elf' ? 'app.exe' : 'app.elf');
    if (fs.existsSync(altExe)) {
      outputExe = altExe;
    } else {
      const app0Exe = path.join(app0Dir, defaultExeName);
      const app0AltExe = path.join(app0Dir, defaultExeName === 'app.elf' ? 'app.exe' : 'app.elf');
      if (fs.existsSync(app0Exe)) {
        outputExe = app0Exe;
      } else if (fs.existsSync(app0AltExe)) {
        outputExe = app0AltExe;
      }
    }
  }

  // Backward compatibility check for executables built with legacy dumper stubs (fakelib)
  if (mode === 'launch') {
    try {
      if (fs.existsSync(outputExe)) {
        if (await fileContainsAny(outputExe, [guestLibcUtf8, guestLibcUtf16])) {
          sendLog(`[AnyPS5 Diagnostics] Guest libc integration: "${path.basename(outputExe)}" links against guest libc.prx.guest.prx for SDK 9.00+ Dinkumware threading symbols.`, 'info');
        }

        const fakelibUtf8 = Buffer.from('fakelib', 'utf8');
        const fakelibUtf16 = Buffer.from('fakelib', 'utf16le');
        if (await fileContainsAny(outputExe, [fakelibUtf8, fakelibUtf16])) {
          sendLog(`[AnyPS5 Diagnostics] Stale executable detected: "${path.basename(outputExe)}" contains embedded imports to legacy "fakelib" stubs.`, 'warn');
          sendLog(`[AnyPS5 Diagnostics] Re-relinking this title in Relinker Studio is recommended to use AnyPS5's native translation libraries.`, 'info');

          const backupFakelib = path.join(app0Dir, 'module_backups', 'fakelib');
          const activeFakelib = path.join(app0Dir, 'fakelib');

          if (fs.existsSync(backupFakelib)) {
            if (!fs.existsSync(activeFakelib)) fs.mkdirSync(activeFakelib, { recursive: true });
            const backupEntries = fs.readdirSync(backupFakelib);
            for (const be of backupEntries) {
              const src = path.join(backupFakelib, be);
              const dst = path.join(activeFakelib, be);
              if (!fs.existsSync(dst)) {
                try {
                  fs.copyFileSync(src, dst);
                } catch {}
              }
            }
          }

          // Deploy fallback bridges for system libraries expected in fakelib (e.g. libSceAppContent.sprx.guest.prx)
          const expectedStems = ['libSceAppContent', 'libSceAgc', 'libSceAgcDriver', 'libSceSaveData'];
          for (const stem of expectedStems) {
            const guestPrxName = `${stem}.sprx.guest.prx`;
            const missingGuestPrx = path.join(activeFakelib, guestPrxName);
            if (!fs.existsSync(missingGuestPrx)) {
              const nativePrx = path.join(resolved, `${stem}.prx`);
              const libsPrx = path.join(resolved, 'libs', `${stem}.prx`);
              const sourcePrx = fs.existsSync(nativePrx) ? nativePrx : (fs.existsSync(libsPrx) ? libsPrx : '');
              if (sourcePrx) {
                try {
                  if (!fs.existsSync(activeFakelib)) fs.mkdirSync(activeFakelib, { recursive: true });
                  fs.copyFileSync(sourcePrx, missingGuestPrx);
                  sendLog(`[AnyPS5] Deployed native ${stem} as fallback guest bridge at app0/fakelib/${guestPrxName}`, 'info');
                } catch (bridgeErr) {
                  console.warn(`Failed to deploy fallback guest bridge for ${stem}:`, bridgeErr);
                }
              }
            }
          }
        }
      }
    } catch (compatErr) {
      console.warn('Fakelib backward compatibility check error:', compatErr);
    }
  } else if (mode === 'relink') {
    // During relink, clean up any active app0/fakelib bridge so relinker never links against fake stubs
    try {
      const activeFakelib = path.join(app0Dir, 'fakelib');
      if (fs.existsSync(activeFakelib)) {
        const backupFakelib = path.join(app0Dir, 'module_backups', 'fakelib');
        if (!fs.existsSync(backupFakelib)) fs.mkdirSync(backupFakelib, { recursive: true });
        const entries = fs.readdirSync(activeFakelib);
        for (const e of entries) {
          const src = path.join(activeFakelib, e);
          const dst = path.join(backupFakelib, e);
          if (!fs.existsSync(dst)) {
            try { fs.copyFileSync(src, dst); } catch {}
          }
        }
        try { fs.rmSync(activeFakelib, { recursive: true, force: true }); } catch {}
      }
    } catch {}
  }

  return {
    gameDir: resolved,
    inputElf,
    outputExe,
    moduleDirs,
  };
}

let activeRelinkerProcess: ChildProcess | null = null;

// IPC Handler: Run Relinker Process
ipcMain.handle('anyps5:run-relinker', async (_, { game, options }) => {
  const sendLog = (message: string, level = 'info') => {
    mainWindow?.webContents.send('anyps5:relinker-event', {
      type: 'log',
      data: { timestamp: new Date().toLocaleTimeString(), level, message },
    });
  };
  if (activeRelinkerProcess) {
    const busy = 'A relink is already running. Wait for it to finish or cancel it first.';
    mainWindow?.webContents.send('anyps5:relinker-event', { type: 'error', data: { message: busy } });
    return false;
  }

  const sendStage = (id: number, status: 'pending' | 'active' | 'completed' | 'error', progress = 0) => {
    mainWindow?.webContents.send('anyps5:relinker-event', {
      type: 'stage',
      data: { id, status, progress },
    });
  };

  try {
    sendLog(`[AnyPS5] Preparing in-place relinker pipeline for "${game.title}"...`, 'info');
    sendStage(1, 'active', 20);

    // Step 0: Resolve designated runtime engine
    const currentSettings = loadSettings();
    const targetRuntimeId = options?.runtimeId || game.runtimeId || (game.titleId ? currentSettings.gameRuntimes?.[game.titleId] : undefined);
    const resolvedRuntime = getRuntimeManager().resolveRuntime(targetRuntimeId);
    sendLog(`[AnyPS5 Runtime] Selected Runtime Engine: "${resolvedRuntime.name}" (${resolvedRuntime.id})`, 'info');
    if (resolvedRuntime.fallbackFrom) {
      sendLog(`[AnyPS5 Runtime] Runtime "${resolvedRuntime.fallbackFrom.name}" is missing or broken (relinker or libs not found), so "${resolvedRuntime.name}" is used instead. Reinstall or remove it in Runtime Manager.`, 'warn');
    }

    // Step 1: Fix folder hierarchy in-place in native location (mode: 'relink' isolates legacy stubs)
    const runtimeSig = resolvedRuntime ? `${resolvedRuntime.id}:${resolvedRuntime.commitHash || resolvedRuntime.date || ''}` : '';
    const { gameDir, inputElf, outputExe, moduleDirs } = await fixGameHierarchyInPlace(game.path, sendLog, 'relink', resolvedRuntime.libsPath, runtimeSig);
    game.path = gameDir;
    sendStage(1, 'completed', 100);

    sendStage(7, 'active', 50);
    sendStage(7, 'completed', 100);

    // Step 2: Locate compiled relinker binary
    const defaultBin = (resolvedRuntime.relinkerPath && fs.existsSync(resolvedRuntime.relinkerPath))
      ? resolvedRuntime.relinkerPath
      : getResolvedRelinkerPath();

    if (!defaultBin || !fs.existsSync(defaultBin)) {
      const errMsg = `Native relinker binary not found at ${defaultBin || 'installation path'}`;
      sendLog(`[AnyPS5 Error] ${errMsg}`, 'error');
      mainWindow?.webContents.send('anyps5:relinker-event', {
        type: 'error',
        data: { message: errMsg },
      });
      return false;
    }

    sendStage(2, 'active', 30);
    const targetSystem = options.target || (process.platform === 'linux' ? 'linux' : (process.platform === 'darwin' ? 'macos' : 'windows'));
    const isWindows = targetSystem === 'windows';
    const isMacos = targetSystem === 'macos';
    const isLinux = targetSystem === 'linux';
    const targetExeName = isWindows ? 'app.exe' : (isMacos ? 'app.macho' : 'app.elf');
    const targetOutputExe = path.join(gameDir, targetExeName);

    const args: string[] = [];
    if (isWindows) args.push('--windows');
    if (isMacos) args.push('--macos');
    if (isWindows && options.subsystem === 'gui') args.push('--windows-gui');
    if (options.cpuTranslation === 'intel') args.push('--to-intel');
    if (options.cpuTranslation === 'rosetta') args.push('--to-rosetta');
    if (isWindows && options.traceImports) args.push('--trace-imports');
    if (isLinux) {
      args.push('--rpath', '$ORIGIN/libs:$ORIGIN/app0/sce_module');
      sendLog('[AnyPS5] Configured Linux native ELF rpath: $ORIGIN/libs:$ORIGIN/app0/sce_module', 'info');
    }

    // Register all discovered guest module directories (e.g. games, Media/Plugins, etc.)
    for (const modDir of moduleDirs) {
      args.push('--module-dir', modDir);
      sendLog(`[AnyPS5] Registered guest plugin module directory: ${modDir}`, 'info');
    }

    // Use Level 0 (Safe / Full Compatibility) by default to preserve all C++ vtable relocations and dynamic call targets
    const filterValue = options.unusedFilter === 2 ? '2' : (options.unusedFilter === 1 ? '1' : '0');
    args.push(`unused-filter=${filterValue}`);

    args.push(inputElf, targetOutputExe);

    sendLog(`[AnyPS5] Executing relinker in "${gameDir}":`);
    sendLog(`[AnyPS5] ${defaultBin} ${args.join(' ')}`);

    return await new Promise<boolean>((resolve) => {
      const proc = spawn(defaultBin, args, { cwd: gameDir });
      activeRelinkerProcess = proc;

      proc.stdout.on('data', (data) => {
        const text = data.toString().trim();
        sendLog(text, 'info');

        if (text.includes('Syscall scan') || text.includes('Instruction scan')) {
          sendStage(2, 'completed', 100);
          sendStage(3, 'active', 50);
        }
        if (text.includes('Import analysis') || text.includes('PRX conversion')) {
          sendStage(3, 'completed', 100);
          sendStage(4, 'completed', 100);
          sendStage(5, 'active', 50);
        }
        if (text.includes('Output image') || text.includes('Write output')) {
          sendStage(5, 'completed', 100);
          sendStage(6, 'active', 75);
        }
      });

      proc.stderr.on('data', (data) => {
        sendLog(data.toString().trim(), 'warn');
      });

      proc.on('error', (err) => {
        activeRelinkerProcess = null;
        sendLog(`[AnyPS5 Error] Relinker process failed: ${err.message}`, 'error');
        sendStage(6, 'error');
        mainWindow?.webContents.send('anyps5:relinker-event', {
          type: 'error',
          data: { message: err.message },
        });
        resolve(false);
      });

      proc.on('close', (code) => {
        activeRelinkerProcess = null;
        if (code === 0) {
          sendStage(6, 'completed', 100);
          sendStage(8, 'completed', 100);

          if (process.platform !== 'win32') {
            try {
              fs.chmodSync(targetOutputExe, 0o755);
              const makeExecutable = (dir: string) => {
                if (!fs.existsSync(dir)) return;
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                  const full = path.join(dir, e.name);
                  if (e.isDirectory()) {
                    makeExecutable(full);
                  } else if (e.isFile() && (e.name.endsWith('.prx') || e.name.endsWith('.so') || e.name.endsWith('.elf'))) {
                    try { fs.chmodSync(full, 0o755); } catch {}
                  }
                }
              };
              makeExecutable(path.join(gameDir, 'libs'));
              makeExecutable(path.join(gameDir, 'app0'));
            } catch (chmodErr) {
              console.warn('Failed to chmod output executable/libraries:', chmodErr);
            }
          }

          try { fs.writeFileSync(path.join(gameDir, RELINK_STAMP), runtimeSig, 'utf8'); } catch {}
          game.status = 'ported';
          game.executableName = targetExeName;
          game.targetPlatform = isLinux ? 'linux' : (isMacos ? 'macos' : 'windows');

          // Auto-extract high-res cover art from sce_sys if available
          const paramSysDir = path.join(gameDir, 'app0/sce_sys');
          const iconPath = path.join(paramSysDir, 'icon0.png');
          const picPath = path.join(paramSysDir, 'pic0.png');
          if (fs.existsSync(iconPath)) {
            try {
              game.iconUrl = `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`;
            } catch {}
          }
          if (fs.existsSync(picPath)) {
            try {
              game.backdropUrl = `data:image/png;base64,${fs.readFileSync(picPath).toString('base64')}`;
            } catch {}
          }

          // Persist updated game to anyps5_games.json
          try {
            if (fs.existsSync(gamesStorePath)) {
              const currentGames: any[] = JSON.parse(fs.readFileSync(gamesStorePath, 'utf8'));
              const idx = currentGames.findIndex((g) => g.id === game.id);
              if (idx >= 0) {
                currentGames[idx] = { ...currentGames[idx], ...game };
              } else {
                currentGames.push(game);
              }
              fs.writeFileSync(gamesStorePath, JSON.stringify(currentGames, null, 2), 'utf8');
            }
          } catch (saveErr) {
            console.error('Failed to update game store after relinking:', saveErr);
          }

          sendLog(`[AnyPS5] Successfully relinked! Title is ported in-place and ready to Plug & Play!`, 'success');
        } else {
          sendStage(6, 'error');
          sendLog(`[AnyPS5 Error] Relinker exited with code ${code}`, 'error');
        }

        mainWindow?.webContents.send('anyps5:relinker-event', {
          type: code === 0 ? 'finish' : 'error',
          data: { code, updatedGame: game },
        });
        resolve(code === 0);
      });
    });
  } catch (err: any) {
    sendLog(`[AnyPS5 Error] Pipeline exception: ${err.message || String(err)}`, 'error');
    mainWindow?.webContents.send('anyps5:relinker-event', {
      type: 'error',
      data: { message: err.message || String(err) },
    });
    return false;
  }
});

let activeGameProcess: ChildProcess | null = null;

// IPC Handler: Launch Ported Game
ipcMain.handle('anyps5:launch-game', async (_, game) => {
  try {
    getDiscordRpcClient().setGame(game);
  } catch {}
  const sendLog = (message: string, level = 'info') => {
    mainWindow?.webContents.send('anyps5:game-log', {
      timestamp: new Date().toLocaleTimeString(),
      level,
      message: message.trim(),
    });
  };

  const currentSettings = loadSettings();
  const targetRuntimeId = game.runtimeId || (game.titleId ? currentSettings.gameRuntimes?.[game.titleId] : undefined);
  const resolvedRuntime = getRuntimeManager().resolveRuntime(targetRuntimeId);
  sendLog(`[AnyPS5 Runtime] Active Runtime Engine: "${resolvedRuntime.name}" (${resolvedRuntime.id})`, 'info');
  if (resolvedRuntime.fallbackFrom) {
    sendLog(`[AnyPS5 Runtime] Runtime "${resolvedRuntime.fallbackFrom.name}" is missing or broken (relinker or libs not found), so "${resolvedRuntime.name}" is used instead. Reinstall or remove it in Runtime Manager.`, 'warn');
  }

  let hierarchyResult: { gameDir: string; inputElf: string; outputExe: string; moduleDirs: string[] } | null = null;
  try {
    sendLog(`[AnyPS5] Launching native ported executable: ${game.path}/${game.executableName || getDefaultOutputExecutableName()}`);
    sendLog(`[AnyPS5] Checking runtime layout: libs/ system PRX and app0/ guest filesystem...`);
    const runtimeSig = resolvedRuntime ? `${resolvedRuntime.id}:${resolvedRuntime.commitHash || resolvedRuntime.date || ''}` : '';
    hierarchyResult = await fixGameHierarchyInPlace(game.path, sendLog, 'launch', resolvedRuntime.libsPath, runtimeSig);
    // The executable was relinked by one core but now runs against another core's libraries.
    try {
      const relinkedWith = fs.readFileSync(path.join(game.path, RELINK_STAMP), 'utf8').trim();
      if (relinkedWith && relinkedWith !== runtimeSig) {
        sendLog(`[AnyPS5 Runtime] This title was relinked with "${relinkedWith}" but runs on "${runtimeSig}". If it fails to start, relink it in Relinker Studio.`, 'warn');
      }
    } catch {}
  } catch (err: any) {
    console.error('Launch hierarchy check error:', err);
    sendLog(`[AnyPS5 Warning] Hierarchy check: ${err?.message || err}`, 'warn');
  }

  const defaultExeName = getDefaultOutputExecutableName();
  const safeGameExe = typeof game.executableName === 'string' && ['app.exe', 'app.elf', 'app.macho'].includes(game.executableName.toLowerCase())
    ? game.executableName
    : null;

  const candidateExes = [
    path.join(game.path, defaultExeName),
    ...(safeGameExe ? [path.join(game.path, safeGameExe)] : []),
    path.join(game.path, defaultExeName === 'app.elf' ? 'app.exe' : 'app.elf'),
    path.join(game.path, 'app0', defaultExeName),
    path.join(game.path, 'app0', defaultExeName === 'app.elf' ? 'app.exe' : 'app.elf'),
  ];
  const targetExe = candidateExes.find((p) => fs.existsSync(p));

  if (!targetExe) {
    try {
      getDiscordRpcClient().setIdle();
    } catch {}
    const expectedName = safeGameExe || defaultExeName;
    return {
      error: `Ported executable "${expectedName}" not found in ${game.path}. Please open Relinker Studio and click Relink first!`,
    };
  }

  if (process.platform === 'linux' && targetExe.endsWith('.exe') && !fs.existsSync(path.join(game.path, 'app.elf'))) {
    try {
      getDiscordRpcClient().setIdle();
    } catch {}
    return {
      error: `Ported Linux binary (app.elf) not found in ${game.path}. This title was ported for Windows (app.exe). Please open Relinker Studio and click Relink to compile the native Linux executable (app.elf).`,
    };
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(targetExe, 0o755);
      const makeExecutable = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            makeExecutable(full);
          } else if (e.isFile() && (e.name.endsWith('.prx') || e.name.endsWith('.so') || e.name.endsWith('.elf'))) {
            try { fs.chmodSync(full, 0o755); } catch {}
          }
        }
      };
      makeExecutable(path.join(game.path, 'libs'));
      makeExecutable(path.join(game.path, 'app0'));
    } catch (chmodErr) {
      console.warn('Failed to chmod target executable before launch:', chmodErr);
    }
  }

  if (activeGameProcess && !activeGameProcess.killed) {
    try {
      activeGameProcess.kill();
    } catch {}
    activeGameProcess = null;
  }

  try {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    const userSettings = loadSettings();
    let gpuToUse = '';

    if (userSettings.preferredGpu && userSettings.preferredGpu !== 'auto' && userSettings.preferredGpu.trim() !== '') {
      const lower = userSettings.preferredGpu.toLowerCase();
      const isVirtualSelected = lower.includes('vmware') || lower.includes('virtualbox') || lower.includes('qemu') || lower.includes('virtio') || lower.includes('llvmpipe') || lower.includes('svga');
      if (!isVirtualSelected) {
        gpuToUse = userSettings.preferredGpu.trim();
      }
    } else {
      const gpus = await detectAvailableGpus();
      const bestDiscrete = gpus.find((g) => g.isDiscrete && !g.isVirtual);
      if (bestDiscrete) {
        gpuToUse = bestDiscrete.name;
      }
    }

    if (gpuToUse) {
      childEnv.ANYPS5_GPU = gpuToUse;
    }

    const gpus = await detectAvailableGpus();
    const isVmEnvironment = gpus.some((g) => g.isVirtual) ||
      Boolean(process.env.VAGRANT) ||
      Boolean(process.env.container) ||
      Boolean(process.env.VMWARE) ||
      (process.platform === 'linux' && (
        fs.existsSync('/sys/class/dmi/id/product_name') &&
        ['vmware', 'virtualbox', 'kvm', 'qemu'].some((v) => {
          try {
            return fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').toLowerCase().includes(v);
          } catch {
            return false;
          }
        })
      ));

    if (isVmEnvironment) {
      childEnv.APS5_NO_WRITE_WATCH = '1';
      sendLog('[AnyPS5 Environment] Virtualized graphics/environment detected: enabled APS5_NO_WRITE_WATCH=1 for guest stability', 'info');
    }

    const userPlaygo = (game.titleId && userSettings.playgoOverrides) ? userSettings.playgoOverrides[game.titleId] : undefined;
    const presetPlaygo = game.titleId ? KNOWN_PLAYGO_PROFILES[game.titleId] : undefined;
    const effectivePlaygo = userPlaygo || presetPlaygo;

    if (effectivePlaygo) {
      childEnv.APS5_PLAYGO_UNLISTED_CHUNKS = effectivePlaygo;
      const origin = userPlaygo ? 'user configuration' : 'known title profile';
      sendLog(`[AnyPS5 Environment] APS5_PLAYGO_UNLISTED_CHUNKS="${effectivePlaygo}" (${origin} for ${game.titleId || 'title'})`, 'info');
    }

    const hasPlaygoManifest = [
      path.join(game.path, 'playgo-chunkdefs.xml'),
      path.join(game.path, 'app0', 'playgo-chunkdefs.xml'),
      path.join(game.path, 'sce_sys', 'playgo-chunk.dat'),
      path.join(game.path, 'app0', 'sce_sys', 'playgo-chunk.dat'),
      path.join(game.path, 'sce_sys', 'playgo-scenario.json'),
      path.join(game.path, 'app0', 'sce_sys', 'playgo-scenario.json'),
    ].some((p) => fs.existsSync(p));

    if (!hasPlaygoManifest) {
      if (!effectivePlaygo) {
        sendLog('[AnyPS5 Warning] Title dump lacks PlayGo manifests (playgo-chunk.dat / playgo-scenario.json). If unlisted chunk errors occur, configure PlayGo mode in Launcher.', 'warn');
      } else {
        sendLog(`[AnyPS5 Diagnostics] Title dump lacks PlayGo manifests; using ${effectivePlaygo} unlisted chunks policy.`, 'info');
      }
    }

    // Direct Path Execution: Guest module directories must appear BEFORE resolvedRuntime.libsPath on Linux
    // so ld.so loads guest authentic libc.prx.guest.prx instead of AnyPS5 host libc.prx
    const guestModuleDirs = [
      path.join(game.path, 'app0', 'sce_module'),
      path.join(game.path, 'app0'),
      path.join(game.path, 'libs'),
      game.path,
      ...(hierarchyResult?.moduleDirs || []).map((d) => path.join(game.path, 'app0', d)),
    ];
    const runtimeDirs = Array.from(new Set([
      ...guestModuleDirs,
      resolvedRuntime.libsPath,
    ]));

    if (process.platform !== 'win32') {
      try {
        if (fs.existsSync(targetExe)) {
          try { fs.chmodSync(targetExe, 0o755); } catch {}
        }
        const ensureLinuxExecutablePermissions = (dir: string) => {
          if (!fs.existsSync(dir)) return;
          try {
            const stat = fs.statSync(dir);
            if (stat.isDirectory()) {
              try { fs.chmodSync(dir, 0o755); } catch {}
              const entries = fs.readdirSync(dir);
              for (const entry of entries) {
                ensureLinuxExecutablePermissions(path.join(dir, entry));
              }
            } else if (stat.isFile()) {
              const lower = dir.toLowerCase();
              if (lower.endsWith('.prx') || lower.endsWith('.elf') || lower.endsWith('.so') || !path.extname(dir)) {
                try { fs.chmodSync(dir, 0o755); } catch {}
              }
            }
          } catch {}
        };

        ensureLinuxExecutablePermissions(path.join(game.path, 'app0'));
        ensureLinuxExecutablePermissions(path.join(game.path, 'libs'));
        ensureLinuxExecutablePermissions(resolvedRuntime.libsPath);
        for (const modDir of hierarchyResult?.moduleDirs || []) {
          ensureLinuxExecutablePermissions(path.join(game.path, 'app0', modDir));
        }
      } catch (chmodErr) {
        console.warn('Linux permission configuration warning:', chmodErr);
      }
    }

    if (process.platform === 'win32') {
      const existingPath = childEnv.Path || childEnv.PATH || '';
      const newPath = runtimeDirs.join(';') + (existingPath ? ';' + existingPath : '');
      childEnv.Path = newPath;
      childEnv.PATH = newPath;
    } else {
      const existingLd = childEnv.LD_LIBRARY_PATH || '';
      const newLd = runtimeDirs.join(':') + (existingLd ? ':' + existingLd : '');
      childEnv.LD_LIBRARY_PATH = newLd;
      const existingPath = childEnv.PATH || '';
      const newPath = runtimeDirs.join(':') + (existingPath ? ':' + existingPath : '');
      childEnv.PATH = newPath;
    }

    // anyps5.log is read after exit; move the previous run's log aside so old errors are not replayed.
    try {
      const anyps5Log = path.join(game.path, 'anyps5.log');
      if (fs.existsSync(anyps5Log)) fs.renameSync(anyps5Log, path.join(game.path, 'anyps5.prev.log'));
    } catch {}

    const child = spawn(targetExe, [], {
      cwd: game.path,
      env: childEnv,
      windowsHide: false,
    });
    child.on('error', (spawnErr) => {
      console.error('Game process error:', spawnErr);
      if (activeGameProcess === child) {
        activeGameProcess = null;
        try { getDiscordRpcClient().setIdle(); } catch {}
      }
    });
    if (!child.pid) {
      return { error: `Could not start "${targetExe}". Check that the file exists and that antivirus software is not blocking it.` };
    }
    activeGameProcess = child;
    const startedAt = Date.now();
    // Output and exit of a process that was stopped or replaced must not reach the launcher of the next session.
    const isCurrent = () => activeGameProcess === child;
    try {
      getDiscordRpcClient().setGame(game);
    } catch {}

    sendLog(`[AnyPS5] Launching native ported executable: ${targetExe}`);
    sendLog(`[AnyPS5] Initialized child process PID: ${child.pid}`);
    if (gpuToUse) {
      if (userSettings.preferredGpu && userSettings.preferredGpu !== 'auto' && userSettings.preferredGpu.trim() !== '') {
        sendLog(`[AnyPS5 Graphics] Bound Graphics Device (GPU): "${gpuToUse}" (configured in Settings)`, 'info');
      } else {
        sendLog(`[AnyPS5 Graphics] Auto-selected High-Performance GPU: "${gpuToUse}" (prioritized over virtual display adapters)`, 'info');
      }
      sendLog(`[AnyPS5 Environment] ANYPS5_GPU="${gpuToUse}"`, 'info');
    }

    let capturedOutput = '';
    const MAX_CAPTURED = 2 * 1024 * 1024;

    child.stdout?.on('data', (d) => {
      if (!isCurrent()) return;
      const text = d.toString();
      capturedOutput = (capturedOutput + text + '\n').slice(-MAX_CAPTURED);
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        sendLog(line, 'info');
      }
    });

    child.stderr?.on('data', (d) => {
      if (!isCurrent()) return;
      const text = d.toString();
      capturedOutput = (capturedOutput + text + '\n').slice(-MAX_CAPTURED);
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        sendLog(line, 'warn');
      }
    });

    child.on('close', (code, signal) => {
      recordPlaySession(game.id, startedAt);
      if (!isCurrent()) return;
      const isCrash = (code !== 0 && code !== null) || Boolean(signal);
      const exitCodeHex = code !== null ? '0x' + (code >>> 0).toString(16).toUpperCase() : (signal || 'null');
      sendLog(`[AnyPS5] Game process exited with code ${code} (${exitCodeHex})${signal ? ` killed by signal ${signal}` : ''}`, !isCrash ? 'info' : 'warn');

      try {
        const anyps5Log = path.join(game.path, 'anyps5.log');
        if (fs.existsSync(anyps5Log)) {
          const content = fs.readFileSync(anyps5Log, 'utf8');
          const lines = content.split(/\r?\n/).filter(Boolean);
          if (lines.length > 0) {
            sendLog(`[AnyPS5 Runtime Log] Captured ${lines.length} diagnostic log entries:`, 'info');
            for (const l of lines) {
              sendLog(`[AnyPS5 Runtime Log] ${l}`, 'warn');
            }
          }
        }
      } catch (logErr) {
        console.warn('Failed to read anyps5.log:', logErr);
      }

      if (code === 3221225477 || code === -1073741819 || signal === 'SIGSEGV' || code === 11 || code === 139) {
        sendLog(`[AnyPS5 Diagnostics] Crash detected: Access Violation / Segmentation Fault (SIGSEGV / 0xC0000005). If the title was relinked with aggressive import filtering, ensure 'Unused Import Optimization' is set to Level 0 (Safe / Full Compatibility) to preserve all C++ virtual tables and dynamic function pointers.`, 'error');
      } else if (code === 3221225781 || code === -1073741515) {
        if (capturedOutput.toLowerCase().includes('fakelib')) {
          sendLog(`[AnyPS5 Diagnostics] Crash Root Cause: Stale executable attempting to load legacy "fakelib" dump stubs. Open Relinker Studio and click Relink to rebuild with AnyPS5's native translation libraries.`, 'error');
        } else {
          sendLog(`[AnyPS5 Diagnostics] Crash detected: Missing Dependency DLL / Shared Object (0xC0000135). Ensure all required middleware PRXs and runtime libraries in libs/ are deployed.`, 'error');
        }
      } else if (code === 3221225785 || code === -1073741511) {
        const importMatch = capturedOutput.match(/FAIL:\s*unresolved\s+ELF\s+import\s+([^\r\n]+)/i);
        if (importMatch && importMatch[1]) {
          sendLog(`[AnyPS5 Diagnostics] Crash detected: Unresolved ELF Import (0xC0000139) -> "${importMatch[1].trim()}". Verify exported symbols in the target PRX.`, 'error');
        } else {
          sendLog(`[AnyPS5 Diagnostics] Crash detected: Unresolved Entry Point / Symbol Import (0xC0000139). Inspect the searched libraries and missing symbols above.`, 'error');
        }
      } else if (code === 3221226505 || code === -1073740791 || signal === 'SIGABRT' || code === 6 || code === 134) {
        const whatMatch = capturedOutput.match(/what\(\):\s*([^\r\n]+)/i);
        if (whatMatch && whatMatch[1]) {
          sendLog(`[AnyPS5 Diagnostics] Crash detected: Fatal Exception / Abort -> "${whatMatch[1].trim()}".`, 'error');
        } else {
          sendLog(`[AnyPS5 Diagnostics] Crash detected: Process Abort / Fail-Fast (SIGABRT / 0xC0000409). Check execution log for abort() or assertion failure.`, 'error');
        }
      } else if (signal === 'SIGILL' || code === 4 || code === 132) {
        sendLog(`[AnyPS5 Diagnostics] Crash detected: Illegal Instruction (SIGILL / 4). The host CPU or VM may lack required instruction extensions (AVX2, F16C, BMI2) or encountered an unhandled opcode.`, 'error');
      } else if (signal === 'SIGBUS' || code === 7 || code === 135) {
        sendLog(`[AnyPS5 Diagnostics] Crash detected: Bus Error (SIGBUS / 7). Check memory alignment and mapped host address space.`, 'error');
      } else if (code === 127) {
        sendLog(`[AnyPS5 Diagnostics] Crash detected: Linux Dynamic Linker Failure (0x7F / 127). Ensure all host runtime dependencies (Vulkan, ALSA, PulseAudio/PipeWire) are installed and rebuild the executable in Relinker Studio.`, 'error');
      }

      if (capturedOutput.toLowerCase().includes('not implemented')) {
        const nidMatch = capturedOutput.match(/([A-Za-z0-9+\-_]{4,64})\s+not implemented/i);
        const missingSym = nidMatch ? nidMatch[1] : 'Unknown';
        sendLog(`[AnyPS5 Diagnostics] Unimplemented PlayStation 5 API: "${missingSym}". In AnyPS5 clean-room libraries, unimplemented system calls explicitly throw to avoid silent corruption. Look for community PRs implementing this export or submit a report.`, 'error');
      }

      if (capturedOutput.toLowerCase().includes('no vulkan 1.1') || capturedOutput.toLowerCase().includes('vulkan: no usable device')) {
        sendLog(`[AnyPS5 Diagnostics] Vulkan initialization error: No compatible Vulkan 1.1 physical device detected. In VMware, ensure 'Accelerate 3D graphics' is checked in Virtual Machine Settings -> Display. On Linux/CachyOS, install appropriate Vulkan ICD drivers (e.g. vulkan-radeon, vulkan-intel, or vulkan-swrast).`, 'error');
      }

      if (capturedOutput.includes('APS5_PLAYGO_UNLISTED_CHUNKS') || capturedOutput.includes('scePlayGo: sce_sys/playgo-chunk.dat and sce_sys/playgo-scenario.json are missing')) {
        sendLog('[AnyPS5 Diagnostics] PlayGo Manifest Error: Title dump is missing PlayGo metadata (playgo-chunk.dat / playgo-scenario.json). Set APS5_PLAYGO_UNLISTED_CHUNKS to "installed" or "absent" for this title.', 'error');
      }

      if (capturedOutput.includes('Ran out of memory allocating') && (game.titleId === 'PPSA03490' || effectivePlaygo === 'installed')) {
        sendLog('[AnyPS5 Diagnostics] PlayGo Memory Exhaustion: Title executed an infinite chunk ID search because unlisted chunks was set to "installed". Set PlayGo Unlisted Chunks to "absent" for this title.', 'error');
      }

      mainWindow?.webContents.send('anyps5:game-exit', {
        code,
        signal,
        exitCodeHex,
        isCrash,
      });

      activeGameProcess = null;
      try {
        getDiscordRpcClient().setIdle();
      } catch {}
    });

    return { pid: child.pid };
  } catch (err: any) {
    try { getDiscordRpcClient().setIdle(); } catch {}
    return { error: `Could not start the game executable (${err?.message || err}). It may be damaged, built for another platform, or blocked by antivirus software; try relinking the title.` };
  }
});

// IPC Handler: Stop Running Game
ipcMain.handle('anyps5:stop-game', async () => {
  try {
    getDiscordRpcClient().setIdle();
  } catch {}
  if (activeGameProcess && !activeGameProcess.killed) {
    try {
      activeGameProcess.kill();
    } catch (err) {
      console.error('Failed to kill game process:', err);
    }
    activeGameProcess = null;
    return true;
  }
  return false;
});

ipcMain.handle('anyps5:kill-game', async () => {
  try {
    getDiscordRpcClient().setIdle();
  } catch {}
  if (activeGameProcess && !activeGameProcess.killed) {
    try {
      activeGameProcess.kill();
    } catch (err) {
      console.error('Failed to kill game process:', err);
    }
    activeGameProcess = null;
    return true;
  }
  return false;
});

ipcMain.handle('anyps5:restore-game-layout', async (_, gamePath: unknown) => {
  if (typeof gamePath !== 'string' || !gamePath || !fs.existsSync(gamePath) || !fs.statSync(gamePath).isDirectory()) {
    return { success: false, error: 'Game folder not found.' };
  }
  if (activeGameProcess || activeRelinkerProcess) {
    return { success: false, error: 'Stop the running game or relink before restoring the folder layout.' };
  }
  if (!fs.existsSync(path.join(gamePath, LAYOUT_LOG_NAME))) {
    return { success: false, error: 'AnyPS5 Studio has no recorded changes for this folder.' };
  }
  if (mainWindow) {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restore Original Folder Layout',
      message: 'Move every file AnyPS5 Studio relocated back to where it was?',
      detail: 'Files Studio added (libs/, eboot.elf, app.exe, runtime DLLs) are left in place. Launching the game again will re-apply the AnyPS5 layout.',
    });
    if (answer.response !== 0) return { success: false, cancelled: true };
  }
  try {
    const { restored, failed } = restoreGameLayout(gamePath);
    return failed.length
      ? { success: false, restored, error: `${failed.length} item(s) could not be restored: ${failed.slice(0, 5).join(', ')}` }
      : { success: true, restored };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
});

// IPC Handler: Cancel Running Relinker Pipeline
ipcMain.handle('anyps5:cancel-relinker', async () => {
  if (activeRelinkerProcess && !activeRelinkerProcess.killed) {
    try {
      activeRelinkerProcess.kill();
      activeRelinkerProcess = null;
      return true;
    } catch (err) {
      console.error('Failed to kill relinker process:', err);
    }
  }
  return false;
});

// IPC Handler: System Telemetry & Genuine Hardware Detection
ipcMain.handle('anyps5:get-telemetry', async () => {
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || 'Unknown CPU';
  const cpuArch = os.arch();
  const platform = os.platform();
  const release = os.release();

  let osName = 'Unknown Operating System';
  if (platform === 'win32') {
    const build = parseInt(release.split('.')[2] || '0', 10);
    osName = build >= 22000 ? `Windows 11 (Build ${build}, ${cpuArch})` : `Windows 10 (${release}, ${cpuArch})`;
  } else if (platform === 'darwin') {
    osName = `macOS (${release}, ${cpuArch})`;
  } else if (platform === 'linux') {
    osName = `Linux (${release}, ${cpuArch})`;
  }

  // Detect GPU name safely (prioritizing user settings or discrete physical GPU over virtual display adapters)
  let gpuName = 'DirectX 12 / Vulkan Compatible GPU';
  try {
    const availableGpus = await detectAvailableGpus();
    const userSettings = loadSettings();
    if (userSettings.preferredGpu && userSettings.preferredGpu !== 'auto' && userSettings.preferredGpu.trim() !== '') {
      gpuName = userSettings.preferredGpu;
    } else if (availableGpus.length > 0) {
      const primary = availableGpus.find(g => g.isDiscrete && !g.isVirtual) || availableGpus.find(g => !g.isVirtual) || availableGpus[0];
      gpuName = primary.name;
    }
  } catch {}

  // Locate relinker executable & system PRX libraries
  const resolvedRuntime = getRuntimeManager().resolveRuntime();
  const relinkerPath = resolvedRuntime.relinkerPath;
  const relinkerBinaryFound = resolvedRuntime.isValid && fs.existsSync(relinkerPath);

  // Check clean-room PRX system libraries
  const libsDir = resolvedRuntime.libsPath;
  let prxCount = 0;
  try {
    prxCount = (await fs.promises.readdir(libsDir)).filter((f) => f.toLowerCase().endsWith('.prx')).length;
  } catch {}
  const prxVersion = resolvedRuntime.isValid && prxCount > 0 ? resolvedRuntime.name : 'Not installed';
  const host = await detectHostCapabilities();

  // Determine CPU vendor & translation recommendation
  const isAmd = /AMD|Ryzen|Threadripper|EPYC/i.test(cpuModel);
  const isIntel = /Intel|Core|Xeon|Pentium|Celeron/i.test(cpuModel);
  const isApple = /Apple|M1|M2|M3|M4/i.test(cpuModel) || platform === 'darwin';

  let recommendedCpuTranslation: 'none' | 'intel' | 'rosetta' = 'intel';
  let recommendationReason = '';

  if (isApple) {
    recommendedCpuTranslation = 'rosetta';
    recommendationReason = 'Detected Apple Silicon architecture. Recommends --to-rosetta for translation to Rosetta 2 JIT compatible x86-64 micro-ops.';
  } else if (isAmd) {
    recommendedCpuTranslation = 'none';
    recommendationReason = 'Detected AMD Ryzen processor matching the PlayStation 5 Zen2 instruction set. Zen2 instruction lowering is skipped for raw native execution.';
  } else if (isIntel) {
    recommendedCpuTranslation = 'intel';
    recommendationReason = 'Detected Intel Core processor. Recommends --to-intel to translate AMD-specific Zen2 instructions into standard Intel AVX2 micro-ops.';
  } else {
    recommendedCpuTranslation = 'intel';
    recommendationReason = 'Generic x86-64 host detected. Intel AVX2 instruction lowering selected for maximum compatibility.';
  }

  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
  const memoryUsageMb = totalMemMb - freeMemMb;

  return {
    hostCpu: `${cpuModel} (${cpus.length} Threads)`,
    hasZen2Extensions: host.avx2 === true,
    missingExtensions: host.avx2 === false ? ['AVX2'] : [],
    avx2: host.avx2,
    vulkanAvailable: host.vulkan,
    prxCount,
    gpuName,
    vulkanVersion: host.vulkan ? 'Vulkan loader installed' : 'Vulkan loader not found',
    memoryUsageMb,
    totalMemoryMb: totalMemMb,
    relinkerBinaryFound,
    relinkerPath: relinkerPath || 'Not found',
    prxVersion,
    osName,
    cpuArchitecture: cpuArch,
    recommendedCpuTranslation,
    recommendationReason,
  };
});

// Window Control IPC Handlers (Frameless Window)
ipcMain.handle('anyps5:minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.handle('anyps5:maximize-window', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('anyps5:close-window', () => {
  mainWindow?.close();
});

ipcMain.handle('anyps5:is-maximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

// Settings & File Selection IPC Handlers
ipcMain.handle('anyps5:get-settings', async () => {
  const userSettings = loadSettings();
  const resolved = getRuntimeManager().resolveRuntime();

  return {
    relinkerPath: resolved.relinkerPath,
    prxPath: resolved.libsPath,
    defaultTarget: userSettings.defaultTarget || (process.platform === 'linux' ? 'linux' : (process.platform === 'darwin' ? 'macos' : 'windows')),
    cpuFix: userSettings.cpuFix || 'auto',
    soundEnabled: userSettings.soundEnabled !== undefined ? userSettings.soundEnabled : true,
    hapticsEnabled: userSettings.hapticsEnabled !== undefined ? userSettings.hapticsEnabled : true,
    advanced: userSettings.advanced !== undefined ? userSettings.advanced : false,
    preferredGpu: userSettings.preferredGpu || 'auto',
    defaultRelinkerPath: resolved.relinkerPath,
    defaultPrxPath: resolved.libsPath,
    hasCompletedSetup: userSettings.hasCompletedSetup,
    lastSeenVersion: userSettings.lastSeenVersion,
    gamesDirectory: userSettings.gamesDirectory,
    discordRpcEnabled: userSettings.discordRpcEnabled !== undefined ? userSettings.discordRpcEnabled : true,
    discordClientId: userSettings.discordClientId || '1562955881182920855',
    playgoOverrides: userSettings.playgoOverrides || {},
  };
});

ipcMain.handle('anyps5:save-settings', async (_, newSettings) => {
  saveSettings(newSettings);
  if (newSettings && typeof newSettings.discordRpcEnabled === 'boolean') {
    getDiscordRpcClient().setEnabled(newSettings.discordRpcEnabled);
  }
  if (newSettings && typeof newSettings.discordClientId === 'string' && newSettings.discordClientId.trim()) {
    getDiscordRpcClient().setClientId(newSettings.discordClientId.trim());
  }
  return true;
});

ipcMain.handle('anyps5:get-discord-status', async () => {
  const client = getDiscordRpcClient();
  return {
    enabled: client.isEnabled(),
    connected: client.isConnectedAndReady(),
    currentActivity: client.getCurrentActivity(),
  };
});

ipcMain.handle('anyps5:reconnect-discord', async () => {
  const client = getDiscordRpcClient();
  client.disconnect();
  client.connect();
  return client.isConnectedAndReady();
});

ipcMain.handle('anyps5:get-available-gpus', async () => {
  return detectAvailableGpus();
});

ipcMain.handle('anyps5:select-file', async (_, filters) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select Executable',
    defaultPath: pickerDefaultPath(),
    filters: (filters as Array<{ name: string; extensions: string[] }>) || [
      { name: 'Executables (*.exe, *.elf, *)', extensions: ['exe', 'elf', '*'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  lastPickerDir = path.dirname(result.filePaths[0]);
  return result.filePaths[0];
});

// Software Updates IPC Handlers
ipcMain.handle('anyps5:check-for-updates', async () => {
  if (!app.isPackaged) {
    return { status: 'not-available', currentVersion: app.getVersion() };
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    return {
      status: 'not-available',
      currentVersion: app.getVersion(),
    };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      return {
        status: 'not-available',
        currentVersion: app.getVersion(),
      };
    }
    return {
      status: 'checked',
      currentVersion: app.getVersion(),
      updateInfo: result?.updateInfo,
    };
  } catch (err: any) {
    let msg = err?.message || String(err);
    if (msg.includes('Cannot find latest.yml') || msg.includes('Cannot find latest-linux.yml') || msg.includes('404')) {
      msg = 'New release detected, but installer assets are still uploading to GitHub Releases. Please wait 1-2 minutes and try again.';
    }
    return {
      status: 'error',
      currentVersion: app.getVersion(),
      error: msg,
    };
  }
});

ipcMain.handle('anyps5:quit-and-install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('anyps5:get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('anyps5:open-external', async (_, url: string) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

// Community PR Builds & Artifact Manager IPC Handlers
const getExperimentalBuildsDir = () => {
  const dir = path.join(app.getPath('userData'), 'experimental-builds');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return dir;
};


const prCache = new Map<string, { timestamp: number; data: any[] }>();

ipcMain.handle('anyps5:get-community-prs', async (_, targetRepoArg?: string, forceRefresh?: boolean) => {
  const baseDir = getExperimentalBuildsDir();
  const customRuntimesBase = path.join(app.getPath('userData'), 'runtimes', 'custom');
  const targetRepo = targetRepoArg && targetRepoArg.trim() ? targetRepoArg.trim() : 'boykopovar/AnyPS5';

  const cacheKey = targetRepo.toLowerCase();
  const cached = prCache.get(cacheKey);
  const now = Date.now();

  let prs: any[] = [];
  let fetchedSuccessfully = false;

  if (!forceRefresh && cached && (now - cached.timestamp < 300000)) {
    prs = cached.data;
    fetchedSuccessfully = true;
  } else {
    try {
      const res = await fetch(`https://api.github.com/repos/${targetRepo}/pulls?state=open&per_page=50&sort=updated&direction=desc`, {
        headers: {
          'User-Agent': 'AnyPS5-Studio-Desktop',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (res.ok) {
        const liveData = await res.json();
        if (Array.isArray(liveData)) {
          prs = liveData.map((item: any) => ({
            id: item.id,
            number: item.number,
            title: item.title,
            author: {
              login: item.user?.login || 'contributor',
              avatar_url: item.user?.avatar_url || '',
              html_url: item.user?.html_url || ''
            },
            html_url: item.html_url,
            state: item.state,
            created_at: item.created_at,
            updated_at: item.updated_at,
            body: item.body || '',
            headSha: item.head?.sha?.substring(0, 7) || 'HEAD',
            headBranch: item.head?.ref || 'main',
            labels: (item.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
          }));
          prCache.set(cacheKey, { timestamp: now, data: prs });
          fetchedSuccessfully = true;
        }
      } else {
        console.warn(`GitHub API returned status ${res.status} for ${targetRepo}`);
      }
    } catch (err) {
      console.warn(`Could not fetch live GitHub PRs from ${targetRepo}:`, err);
    }
  }

  // If live fetch failed due to network error, use cached data if available, otherwise return empty
  if (!fetchedSuccessfully && cached) {
    prs = cached.data;
  }

  const activeRuntime = getRuntimeManager().resolveRuntime();
  const binName = getRelinkerBinaryName();

  // Annotate with local installation & active status
  return prs.map((pr) => {
    const customPrDir = path.join(customRuntimesBase, `pr-${pr.number}`);
    const customPrExe = path.join(customPrDir, binName);
    const legacyPrExe = path.join(baseDir, `pr-${pr.number}`, binName);

    const isInstalled = fs.existsSync(customPrExe) || fs.existsSync(legacyPrExe);
    let artifactSizeMb: number | undefined;
    if (isInstalled) {
      try {
        const activePath = fs.existsSync(customPrExe) ? customPrExe : legacyPrExe;
        const stats = fs.statSync(activePath);
        artifactSizeMb = Math.round((stats.size / (1024 * 1024)) * 10) / 10;
      } catch {}
    }

    const isActive = isInstalled && (
      activeRuntime.id === `custom-pr-${pr.number}` ||
      (activeRuntime.relinkerPath && (
        path.normalize(activeRuntime.relinkerPath) === path.normalize(customPrExe) ||
        path.normalize(activeRuntime.relinkerPath) === path.normalize(legacyPrExe)
      ))
    );

    return {
      ...pr,
      isInstalled,
      isActive,
      artifactSizeMb,
    };
  });
});

// Building a pull request compiles code from a contributor's fork; the resulting relinker runs on the user's
// PC and its libraries are loaded into games. Asked in the main process so no UI path can skip it.
async function confirmCommunityBuild(prNumbers: number[], headSha?: string): Promise<boolean> {
  if (!mainWindow) return false;
  const known = prCache.get('boykopovar/anyps5')?.data || [];
  const lines = prNumbers.map((n) => {
    const pr = known.find((p: any) => p.number === n);
    return pr ? `#${n} "${pr.title}" by ${pr.author?.login || 'unknown'}` : `#${n}`;
  });
  if (headSha && headSha !== 'HEAD') lines.push(`Commit: ${headSha}`);
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Build', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Build Community Code',
    message: prNumbers.length > 1 ? 'Build these pull requests from unreviewed community code?' : 'Build this pull request from unreviewed community code?',
    detail:
      `${lines.join('\n')}\n\n` +
      "This compiles code from the contributor's fork. The resulting relinker runs on your PC and its libraries are " +
      'loaded into your games, with the same access to your files as any program you run. Only continue if you trust ' +
      'the author or have read the changes on GitHub.',
  });
  return response === 0;
}

// Real Pull Request Compilation via Local Builder
ipcMain.handle('anyps5:build-pr', async (_, { prNumber, headSha, title }: { prNumber: number; headSha: string; title: string }) => {
  if (!isPrNumber(prNumber)) return { success: false, error: 'Invalid pull request number.' };
  if (!(await confirmCommunityBuild([prNumber], headSha))) return { success: false, cancelled: true, error: 'Build cancelled.' };
  return getLocalBuilderService().buildPullRequest(
    prNumber,
    headSha,
    title,
    getRuntimeManager(),
    (logMsg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:builder-log', logMsg);
      }
    },
    (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:builder-status', status);
        mainWindow.webContents.send('anyps5:pr-download-progress', {
          prNumber,
          status: status.status === 'completed' ? 'ready' : status.status === 'error' ? 'error' : status.status,
          progress: status.progress,
          message: status.message,
          error: status.error,
        });
      }
    }
  );
});

// Delegate download-pr-build to real buildPullRequest
ipcMain.handle('anyps5:download-pr-build', async (_, { prNumber, artifactUrl, headSha, title }: { prNumber: number; artifactUrl?: string; headSha?: string; title?: string }) => {
  if (!isPrNumber(prNumber)) return { success: false, error: 'Invalid pull request number.' };
  if (!(await confirmCommunityBuild([prNumber], headSha))) return { success: false, cancelled: true, error: 'Build cancelled.' };
  return getLocalBuilderService().buildPullRequest(
    prNumber,
    headSha || 'HEAD',
    title || `PR #${prNumber}`,
    getRuntimeManager(),
    (logMsg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:builder-log', logMsg);
      }
    },
    (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:builder-status', status);
        mainWindow.webContents.send('anyps5:pr-download-progress', {
          prNumber,
          status: status.status === 'completed' ? 'ready' : status.status === 'error' ? 'error' : status.status,
          progress: status.progress,
          message: status.message,
          error: status.error,
        });
      }
    }
  );
});

const isPrNumber = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
const isMergedBuildId = (id: unknown): id is string => typeof id === 'string' && /^custom-merged-\d+(?:-\d+)*$/.test(id);

ipcMain.handle('anyps5:set-active-pr-build', async (_, prNumber: number) => {
  if (!isPrNumber(prNumber)) return false;
  const runtimeId = `custom-pr-${prNumber}`;
  const success = getRuntimeManager().setActiveGlobalRuntime(runtimeId);
  if (success) {
    const resolved = getRuntimeManager().resolveRuntime(runtimeId);
    const current = loadSettings();
    saveSettings({ ...current, relinkerPath: resolved.relinkerPath, prxPath: resolved.libsPath });
    return true;
  }

  // Fallback for legacy builds
  const legacyPrExe = path.join(getExperimentalBuildsDir(), `pr-${prNumber}`, getRelinkerBinaryName());
  if (fs.existsSync(legacyPrExe)) {
    const current = loadSettings();
    saveSettings({ ...current, relinkerPath: legacyPrExe });
    return true;
  }
  return false;
});

ipcMain.handle('anyps5:revert-to-default-build', async () => {
  getRuntimeManager().setActiveGlobalRuntime('bundled');
  const resolved = getRuntimeManager().resolveRuntime('bundled');
  const current = loadSettings();
  saveSettings({ ...current, relinkerPath: resolved.relinkerPath, prxPath: resolved.libsPath });
  return true;
});

ipcMain.handle('anyps5:delete-pr-build', async (_, prNumber: number) => {
  if (!isPrNumber(prNumber)) return false;
  const runtimeId = `custom-pr-${prNumber}`;
  getRuntimeManager().removeRuntime(runtimeId);

  const customPrDir = path.join(app.getPath('userData'), 'runtimes', 'custom', `pr-${prNumber}`);
  const legacyPrDir = path.join(getExperimentalBuildsDir(), `pr-${prNumber}`);
  if (fs.existsSync(customPrDir)) {
    try { fs.rmSync(customPrDir, { recursive: true, force: true }); } catch {}
  }
  if (fs.existsSync(legacyPrDir)) {
    try { fs.rmSync(legacyPrDir, { recursive: true, force: true }); } catch {}
  }

  const active = getRuntimeManager().resolveRuntime();
  const current = loadSettings();
  saveSettings({ ...current, relinkerPath: active.relinkerPath, prxPath: active.libsPath });
  return true;
});

ipcMain.handle('anyps5:merge-and-build-prs', async (_, prNumbers: number[]) => {
  if (!Array.isArray(prNumbers) || prNumbers.length === 0) {
    return { success: false, error: 'No pull requests selected for merge.' };
  }
  if (!prNumbers.every(isPrNumber)) return { success: false, error: 'Invalid pull request numbers.' };
  if (!(await confirmCommunityBuild(prNumbers))) return { success: false, cancelled: true, error: 'Build cancelled.' };

  return getLocalBuilderService().mergeAndBuildPRs(
    prNumbers,
    getRuntimeManager(),
    (logMsg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:builder-log', logMsg);
      }
    },
    (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:builder-status', status);
      }
    }
  );
});

// Combined builds are registered as runtimes (`custom-merged-<pr>-<pr>...`, files under runtimes/custom/),
// so list, activate and delete them through the runtime manager like any other runtime.
ipcMain.handle('anyps5:get-merged-builds', async () => {
  const rm = getRuntimeManager();
  const activeId = rm.getManifest().activeGlobalRuntimeId;
  return rm.listRuntimes()
    .filter((r) => isMergedBuildId(r.id) && r.isValid)
    .map((r) => ({
      id: r.id,
      name: r.name,
      prNumbers: r.id.replace('custom-merged-', '').split('-').map(Number),
      installedAt: r.date || '',
      relinkerPath: r.relinkerPath,
      isActive: r.id === activeId,
    }));
});

ipcMain.handle('anyps5:set-active-merged-build', async (_, buildId: string) => {
  if (!isMergedBuildId(buildId)) return false;
  return getRuntimeManager().setActiveGlobalRuntime(buildId);
});

ipcMain.handle('anyps5:delete-merged-build', async (_, buildId: string) => {
  if (!isMergedBuildId(buildId)) return false;
  return getRuntimeManager().removeRuntime(buildId);
});

// Runtime Manager IPC Handlers
ipcMain.handle('anyps5:runtimes-get-manifest', async () => {
  return getRuntimeManager().getManifest();
});

ipcMain.handle('anyps5:runtimes-list', async () => {
  return getRuntimeManager().listRuntimes();
});

ipcMain.handle('anyps5:runtimes-resolve', async (_, runtimeId?: string) => {
  return getRuntimeManager().resolveRuntime(runtimeId);
});

ipcMain.handle('anyps5:runtimes-set-active-global', async (_, runtimeId: string) => {
  return getRuntimeManager().setActiveGlobalRuntime(runtimeId);
});

ipcMain.handle('anyps5:runtimes-register-custom', async (_, args: { name: string; customPath: string; relinkerOverride?: string; libsOverride?: string }) => {
  return getRuntimeManager().registerCustomRuntime(args.name, args.customPath, args.relinkerOverride, args.libsOverride);
});

ipcMain.handle('anyps5:runtimes-remove', async (_, runtimeId: string) => {
  return getRuntimeManager().removeRuntime(runtimeId);
});

// Per-Game Runtime Selection IPC Handlers
ipcMain.handle('anyps5:set-game-runtime', async (_, { titleId, runtimeId }: { titleId: string; runtimeId: string }) => {
  try {
    const current = loadSettings();
    const gameRuntimes = { ...(current.gameRuntimes || {}) };
    if (runtimeId && runtimeId !== 'bundled' && runtimeId !== 'inherit') {
      gameRuntimes[titleId] = runtimeId;
    } else {
      delete gameRuntimes[titleId];
    }
    saveSettings({ ...current, gameRuntimes });
    return true;
  } catch (err) {
    console.error('Failed to set game runtime:', err);
    return false;
  }
});

ipcMain.handle('anyps5:get-game-runtime', async (_, titleId: string) => {
  const current = loadSettings();
  return current.gameRuntimes?.[titleId];
});

ipcMain.handle('anyps5:set-playgo-override', async (_, { titleId, mode }: { titleId: string; mode: 'installed' | 'absent' | 'default' }) => {
  try {
    const current = loadSettings();
    const playgoOverrides = { ...(current.playgoOverrides || {}) };
    if (mode === 'installed' || mode === 'absent') {
      playgoOverrides[titleId] = mode;
    } else {
      delete playgoOverrides[titleId];
    }
    saveSettings({ ...current, playgoOverrides });
    return true;
  } catch (err) {
    console.error('Failed to set playgo override:', err);
    return false;
  }
});

ipcMain.handle('anyps5:get-playgo-override', async (_, titleId: string) => {
  const current = loadSettings();
  const custom = current.playgoOverrides?.[titleId];
  const preset = KNOWN_PLAYGO_PROFILES[titleId];
  return {
    effective: custom || preset || null,
    custom: custom || null,
    preset: preset || null,
  };
});

// GitHub Device Flow & CI Artifacts IPC Handlers
ipcMain.handle('anyps5:github-get-auth-status', async () => {
  return getGitHubAuthService().getAuthStatus();
});

ipcMain.handle('anyps5:github-request-device-code', async () => {
  try {
    return await getGitHubAuthService().requestDeviceCode();
  } catch (err: any) {
    console.error('IPC github-request-device-code error:', err);
    throw err;
  }
});

ipcMain.handle('anyps5:github-check-device-code', async (_, deviceCode: string) => {
  try {
    return await getGitHubAuthService().checkDeviceCode(deviceCode);
  } catch (err: any) {
    console.error('IPC github-check-device-code error:', err);
    return { status: 'error', error: err?.message || String(err) };
  }
});

ipcMain.handle('anyps5:github-set-pat', async (_, token: string) => {
  return getGitHubAuthService().setPersonalAccessToken(token);
});

ipcMain.handle('anyps5:github-disconnect', async () => {
  return getGitHubAuthService().disconnect();
});

ipcMain.handle('anyps5:github-fetch-commits', async (_, args?: { repo?: string; page?: number; perPage?: number }) => {
  const repo = args?.repo || 'boykopovar/AnyPS5';
  const page = args?.page || 1;
  const perPage = args?.perPage || 100;
  return getGitHubAuthService().fetchCommits(repo, page, perPage, getRuntimeManager());
});

ipcMain.handle('anyps5:github-compare-commits', async (_, args?: { baseSha?: string; headRef?: string; repo?: string }) => {
  const baseSha = args?.baseSha;
  const headRef = args?.headRef || 'main';
  const repo = args?.repo || 'boykopovar/AnyPS5';
  return getGitHubAuthService().compareWithHead(baseSha, headRef, repo, getRuntimeManager());
});

ipcMain.handle('anyps5:github-download-commit', async (_, commit: { sha: string; shortSha: string; message: string; date?: string }) => {
  return getGitHubAuthService().downloadCommitArtifact(
    commit,
    getRuntimeManager(),
    (status, progress, error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:commit-download-progress', {
          shortSha: commit.shortSha,
          status,
          progress,
          error,
        });
      }
    }
  );
});

// Local Builder & Dev Studio IPC Handlers
ipcMain.handle('anyps5:builder-inspect-toolchain', async () => {
  return getLocalBuilderService().inspectToolchain();
});

ipcMain.handle('anyps5:builder-install-toolchain', async () => {
  return getLocalBuilderService().installManagedToolchain((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('anyps5:builder-toolchain-progress', progress);
    }
  });
});

ipcMain.handle('anyps5:builder-get-source-status', async () => {
  return getLocalBuilderService().getSourceStatus();
});

ipcMain.handle('anyps5:builder-sync-source', async () => {
  return getLocalBuilderService().syncSource((logMsg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('anyps5:builder-log', logMsg);
    }
  });
});

ipcMain.handle('anyps5:builder-start-build', async () => {
  return getLocalBuilderService().startBuild(
    getRuntimeManager(),
    (logMsg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:builder-log', logMsg);
      }
    },
    (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('anyps5:builder-status', status);
      }
    }
  );
});

ipcMain.handle('anyps5:builder-cancel-build', async () => {
  return getLocalBuilderService().cancelBuild();
});

ipcMain.handle('anyps5:builder-get-active-build', async () => {
  return getLocalBuilderService().getActiveBuild();
});




