import { 
  GameItem, 
  RelinkerOptions, 
  SystemTelemetry, 
  ConversionStage, 
  ConversionLog, 
  AppSettings, 
  DetectedGpu,
  UpdateStatus,
  CommunityPR,
  PRBuildDownloadProgress,
  MultiPRBuildResult,
  MergedBuildInfo,
  RuntimeProfile,
  RuntimesManifest,
  ResolvedRuntime,
  GitHubAuthStatus,
  GitHubDeviceCodeResponse,
  UpstreamCommit,
  UpstreamComparison,
  CommitsPageResult,
  ToolchainStatus,
  ToolchainInspectionResult,
  ToolchainInstallProgress,
  SourceSyncStatus,
  BuilderLogMessage,
  BuildProgressStatus,
  BuildResult,
  DiscoveredGameCandidate,
  NidAuditResult,
  PlaygoMode,
  PlaygoOverrideInfo
} from '../types';
import { INITIAL_GAMES } from './sampleData';

declare global {
  interface Window {
    anyps5?: {
      selectFolder: () => Promise<string | null>;
      selectFile?: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
      inspectFolder: (folderPath: string) => Promise<{
        title?: string;
        titleId?: string;
        version?: string;
        iconUrl?: string;
        backdropUrl?: string;
        hasEboot?: boolean;
        sizeBytes?: number;
      } | null>;
      scanDirectory?: (rootPath: string) => Promise<DiscoveredGameCandidate[]>;
      auditGameNids?: (game: any, forceRefresh?: boolean) => Promise<NidAuditResult>;
      getGames: () => Promise<GameItem[]>;
      restoreGameLayout?: (gamePath: string) => Promise<{ success: boolean; restored?: number; cancelled?: boolean; error?: string }>;
      saveGames: (games: GameItem[]) => Promise<void>;
      getSettings?: () => Promise<AppSettings>;
      saveSettings?: (settings: Partial<AppSettings>) => Promise<boolean>;
      getAvailableGpus?: () => Promise<DetectedGpu[]>;
      checkForUpdates?: () => Promise<{ status: string; currentVersion: string; error?: string; updateInfo?: any }>;
      quitAndInstallUpdate?: () => void;
      getAppVersion?: () => Promise<string>;
      openExternal?: (url: string) => Promise<boolean>;
      getDiscordStatus?: () => Promise<{ enabled: boolean; connected: boolean; currentActivity?: any }>;
      reconnectDiscord?: () => Promise<boolean>;
      onUpdateStatus?: (callback: (status: UpdateStatus) => void) => () => void;
      getCommunityPRs?: (repo?: string, forceRefresh?: boolean) => Promise<CommunityPR[]>;
      downloadPRBuild?: (args: { prNumber: number; artifactUrl?: string; headSha?: string; title?: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
      buildPR?: (args: { prNumber: number; headSha: string; title: string }) => Promise<BuildResult>;
      setActivePRBuild?: (prNumber: number) => Promise<boolean>;
      revertToDefaultBuild?: () => Promise<boolean>;
      deletePRBuild?: (prNumber: number) => Promise<boolean>;
      mergeAndBuildPRs?: (prNumbers: number[]) => Promise<MultiPRBuildResult>;
      getMergedBuilds?: () => Promise<MergedBuildInfo[]>;
      setActiveMergedBuild?: (buildId: string) => Promise<boolean>;
      deleteMergedBuild?: (buildId: string) => Promise<boolean>;
      onPRDownloadProgress?: (callback: (progress: PRBuildDownloadProgress) => void) => () => void;
      runRelinker: (
        game: GameItem,
        options: RelinkerOptions,
        callbackId: string
      ) => Promise<boolean>;
      cancelRelinker: () => Promise<boolean>;
      launchGame: (game: GameItem) => Promise<{ pid?: number; error?: string }>;
      stopGame: (pid?: number) => Promise<boolean>;
      getSystemTelemetry: () => Promise<SystemTelemetry>;
      onRelinkerEvent: (
        callback: (event: { type: 'stage' | 'log' | 'finish' | 'error'; data: any }) => void
      ) => () => void;
      onGameLog: (
        callback: (data: { level: string; message: string; timestamp?: string }) => void
      ) => () => void;
      onGameExit?: (
        callback: (data: { code: number | null; signal?: string | null; exitCodeHex: string; isCrash: boolean }) => void
      ) => () => void;
      minimizeWindow?: () => Promise<void>;
      maximizeWindow?: () => Promise<void>;
      closeWindow?: () => Promise<void>;
      isWindowMaximized?: () => Promise<boolean>;
      onWindowMaximizedChange?: (callback: (isMax: boolean) => void) => () => void;
      getRuntimesManifest?: () => Promise<RuntimesManifest>;
      listRuntimes?: () => Promise<ResolvedRuntime[]>;
      resolveRuntime?: (runtimeId?: string) => Promise<ResolvedRuntime>;
      setActiveGlobalRuntime?: (runtimeId: string) => Promise<boolean>;
      registerCustomRuntime?: (args: { name: string; customPath: string; relinkerOverride?: string; libsOverride?: string }) => Promise<RuntimeProfile>;
      removeRuntime?: (runtimeId: string) => Promise<boolean>;
      setGameRuntime?: (titleId: string, runtimeId: string) => Promise<boolean>;
      getGameRuntime?: (titleId: string) => Promise<string | undefined>;
      setPlaygoOverride?: (titleId: string, mode: PlaygoMode) => Promise<boolean>;
      getPlaygoOverride?: (titleId: string) => Promise<PlaygoOverrideInfo>;
      getGitHubAuthStatus?: () => Promise<GitHubAuthStatus>;
      requestGitHubDeviceCode?: () => Promise<GitHubDeviceCodeResponse>;
      checkGitHubDeviceCode?: (deviceCode: string) => Promise<{ status: 'pending' | 'slow_down' | 'approved' | 'expired' | 'error'; accessToken?: string; interval?: number; error?: string }>;
      setGitHubPersonalAccessToken?: (token: string) => Promise<{ success: boolean; username?: string; error?: string }>;
      disconnectGitHub?: () => Promise<boolean>;
      fetchUpstreamCommits?: (args?: { repo?: string; page?: number; perPage?: number }) => Promise<CommitsPageResult>;
      compareUpstreamCommits?: (args?: { baseSha?: string; headRef?: string; repo?: string }) => Promise<UpstreamComparison>;
      downloadCommitArtifact?: (commit: { sha: string; shortSha: string; message: string; date?: string }) => Promise<{ success: boolean; runtimeId?: string; error?: string }>;
      onCommitDownloadProgress?: (callback: (data: { shortSha: string; status: string; progress: number; error?: string }) => void) => () => void;
      inspectToolchain?: () => Promise<ToolchainInspectionResult>;
      installManagedToolchain?: () => Promise<{ success: boolean; error?: string }>;
      onToolchainInstallProgress?: (callback: (data: ToolchainInstallProgress) => void) => () => void;
      getSourceStatus?: () => Promise<SourceSyncStatus>;
      syncSource?: () => Promise<{ success: boolean; commit?: string; error?: string }>;
      startBuild?: () => Promise<BuildResult>;
      cancelBuild?: () => Promise<{ success: boolean }>;
      getActiveBuild?: () => Promise<{ isBuilding: boolean; buildingPR: number | null; recentLogs?: BuilderLogMessage[] }>;
      onBuilderLog?: (callback: (data: BuilderLogMessage) => void) => () => void;
      onBuildStatus?: (callback: (data: BuildProgressStatus) => void) => () => void;
    };
  }
}

class ApiBridge {
  private games: GameItem[] = [...INITIAL_GAMES];

  public async getGames(): Promise<GameItem[]> {
    if (window.anyps5) {
      const electronGames = await window.anyps5.getGames();
      return Array.isArray(electronGames) ? electronGames : [];
    }
    const stored = localStorage.getItem('anyps5_games');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Fallback
      }
    }
    return this.games;
  }

  public async saveGames(games: GameItem[]): Promise<void> {
    this.games = games;
    if (window.anyps5) {
      await window.anyps5.saveGames(games);
    } else {
      localStorage.setItem('anyps5_games', JSON.stringify(games));
    }
  }

  public async selectGameFolder(): Promise<string | null> {
    if (window.anyps5) {
      return await window.anyps5.selectFolder();
    }
    // Browser simulated file/folder dialog
    const simulatedPath = prompt("Enter the path to your decrypted PS5 game folder or ELF:\n(e.g., C:/Games/PS5/MyGame)", "C:/Games/PS5/NewTitle");
    return simulatedPath;
  }

  public async selectFolder(): Promise<string | null> {
    return this.selectGameFolder();
  }

  public async inspectGameFolder(folderPath: string): Promise<{
    title?: string;
    titleId?: string;
    version?: string;
    iconUrl?: string;
    backdropUrl?: string;
    hasEboot?: boolean;
    sizeBytes?: number;
  } | null> {
    if (window.anyps5?.inspectFolder) {
      return await window.anyps5.inspectFolder(folderPath);
    }
    return null;
  }

  public async auditGameNids(game: GameItem, forceRefresh = false): Promise<NidAuditResult> {
    if (window.anyps5?.auditGameNids) {
      return await window.anyps5.auditGameNids(game, forceRefresh);
    }

    await new Promise((resolve) => setTimeout(resolve, 400));

    const sampleImports = [
      { nid: '0x1A2B3C4D5E6F7001', module: 'libkernel.prx', symbol: 'sceKernelCreateEqueue', status: 'implemented' as const, implementationNotes: 'Native IOCP/kqueue wait queue translation' },
      { nid: '0x1A2B3C4D5E6F7002', module: 'libkernel.prx', symbol: 'sceKernelWaitEqueue', status: 'implemented' as const, implementationNotes: 'Event queue poll loop' },
      { nid: '0x2F3A4B5C6D7E8001', module: 'libkernel.prx', symbol: 'scePthreadCreate', status: 'implemented' as const, implementationNotes: 'FreeBSD pthread cancellation semantics' },
      { nid: '0x2F3A4B5C6D7E8002', module: 'libkernel.prx', symbol: 'scePthreadJoin', status: 'implemented' as const, implementationNotes: 'Maps directly to host Win32 thread' },
      { nid: '0x3A4B5C6D7E8F9001', module: 'libSceAgcDriver.prx', symbol: 'sceAgcDriverSubmitDcb', status: 'implemented' as const, implementationNotes: 'Direct Vulkan queue submission' },
      { nid: '0x3A4B5C6D7E8F9002', module: 'libSceAgcDriver.prx', symbol: 'sceAgcDriverRegisterShader', status: 'implemented' as const, implementationNotes: 'RDNA ISA to SPIR-V JIT compiler' },
      { nid: '0x4A5B6C7D8E9F0001', module: 'libScePad.prx', symbol: 'scePadOpen', status: 'implemented' as const, implementationNotes: 'DirectInput / XInput DualSense HID layer' },
      { nid: '0x4A5B6C7D8E9F0002', module: 'libScePad.prx', symbol: 'scePadReadState', status: 'implemented' as const, implementationNotes: 'High precision state polling' },
      { nid: '0x5A6B7C8D9E0F1001', module: 'libSceAudioOut.prx', symbol: 'sceAudioOutOpen', status: 'implemented' as const, implementationNotes: 'WASAPI 48kHz float multichannel stream' },
      { nid: '0xAA88442200000001', module: 'libSceSaveData.prx', symbol: 'sceSaveDataMountCloud', status: 'stub' as const, implementationNotes: 'Redirected to local host folder app0/savedata' },
      { nid: '0x99A3F12D00000001', module: 'libSceHaptic.prx', symbol: 'sceHapticTriggerFeedback', status: 'stub' as const, implementationNotes: 'Stubbed return SCE_OK (no motor passthrough)' },
      { nid: '0xE8912C0400000001', module: 'libSceNpMatching2.prx', symbol: 'sceNpMatching2CreateRoom', status: 'missing' as const, implementationNotes: 'Network matchmaking unsupported' },
    ];

    return {
      summary: {
        totalImports: 12,
        resolvedCount: 9,
        stubCount: 2,
        missingCount: 1,
        coveragePercentage: 75.0,
      },
      imports: sampleImports,
    };
  }

  public async scanDirectoryForGames(rootPath: string): Promise<DiscoveredGameCandidate[]> {
    if (window.anyps5?.scanDirectory) {
      return await window.anyps5.scanDirectory(rootPath);
    }

    await new Promise((resolve) => setTimeout(resolve, 600));

    const simulatedTitles = [
      { name: "Demon's Souls", id: 'PPSA01339', size: 52 * 1024 * 1024 * 1024 },
      { name: 'Returnal', id: 'PPSA01285', size: 56 * 1024 * 1024 * 1024 },
      { name: 'Ratchet and Clank: Rift Apart', id: 'PPSA01473', size: 42 * 1024 * 1024 * 1024 },
      { name: "Marvel's Spider-Man 2", id: 'PPSA02188', size: 98 * 1024 * 1024 * 1024 },
    ];

    const cleanRoot = rootPath ? rootPath.replace(/\\/g, '/').replace(/\/+$/, '') : 'D:/Games/PS5';

    return simulatedTitles.map((item, idx) => ({
      path: cleanRoot + '/' + item.name.replace(/[^a-zA-Z0-9]/g, '_'),
      title: item.name,
      titleId: item.id,
      version: '01.00',
      iconUrl: INITIAL_GAMES[idx % INITIAL_GAMES.length]?.iconUrl || '',
      backdropUrl: INITIAL_GAMES[idx % INITIAL_GAMES.length]?.backdropUrl || '',
      sizeBytes: item.size,
      hasEboot: true,
    }));
  }

  public async selectFile(filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null> {
    if (window.anyps5?.selectFile) {
      return await window.anyps5.selectFile(filters);
    }
    return null;
  }

  public async getSettings(): Promise<AppSettings> {
    if (window.anyps5?.getSettings) {
      return await window.anyps5.getSettings();
    }
    const local = localStorage.getItem('anyps5_settings');
    if (local) {
      try {
        return JSON.parse(local);
      } catch {}
    }
    return {
      relinkerPath: '',
      prxPath: '',
      defaultTarget: (typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux')) ? 'linux' : 'windows',
      cpuFix: 'auto',
      soundEnabled: true,
      hapticsEnabled: true,
      advanced: false,
      preferredGpu: 'auto',
      discordRpcEnabled: true,
    };
  }

  public async getAvailableGpus(): Promise<DetectedGpu[]> {
    if (window.anyps5?.getAvailableGpus) {
      return await window.anyps5.getAvailableGpus();
    }
    return [
      {
        name: 'NVIDIA GeForce RTX 4060',
        vendor: 'nvidia',
        isDiscrete: true,
        isVirtual: false,
        adapterRamMb: 8192,
      },
    ];
  }

  public async saveSettings(settings: Partial<AppSettings>): Promise<void> {
    if (window.anyps5?.saveSettings) {
      await window.anyps5.saveSettings(settings);
    }
    try {
      const existing = localStorage.getItem('anyps5_settings');
      const current = existing ? JSON.parse(existing) : {};
      localStorage.setItem('anyps5_settings', JSON.stringify({ ...current, ...settings }));
    } catch {}
  }

  public async getDiscordStatus(): Promise<{ enabled: boolean; connected: boolean; currentActivity?: any }> {
    if (window.anyps5?.getDiscordStatus) {
      return await window.anyps5.getDiscordStatus();
    }
    return { enabled: true, connected: false };
  }

  public async reconnectDiscord(): Promise<boolean> {
    if (window.anyps5?.reconnectDiscord) {
      return await window.anyps5.reconnectDiscord();
    }
    return false;
  }

  public async getTelemetry(): Promise<SystemTelemetry> {
    if (window.anyps5) {
      return await window.anyps5.getSystemTelemetry();
    }
    return {
      hostCpu: 'Intel(R) Core(TM) i5-14400F (16 Threads)',
      hasZen2Extensions: true,
      missingExtensions: [],
      gpuName: 'NVIDIA GeForce RTX 4060',
      vulkanVersion: '1.3.280 (Direct DCB/ACB Queue Support)',
      memoryUsageMb: 3410,
      totalMemoryMb: 32768,
      relinkerBinaryFound: true,
      relinkerPath: 'build/relinker.exe',
      prxVersion: 'v0.8.4-cleanroom',
      osName: 'Windows 11 (Build 26200, x64)',
      cpuArchitecture: 'x64',
      recommendedCpuTranslation: 'intel',
      recommendationReason: 'Detected Intel Core processor. Recommends --to-intel to translate AMD-specific Zen2 instructions into standard Intel AVX2 micro-ops.',
    };
  }

  public async cancelRelinker(): Promise<boolean> {
    if (window.anyps5?.cancelRelinker) {
      return await window.anyps5.cancelRelinker();
    }
    return true;
  }

  public async launchGame(game: GameItem): Promise<{ pid?: number; error?: string }> {
    if (window.anyps5) {
      return await window.anyps5.launchGame(game);
    }
    return { pid: 12345 };
  }

  public async stopGame(pid?: number): Promise<boolean> {
    if (window.anyps5) {
      return await window.anyps5.stopGame(pid);
    }
    return true;
  }

  public async restoreGameLayout(gamePath: string): Promise<{ success: boolean; restored?: number; cancelled?: boolean; error?: string }> {
    if (window.anyps5?.restoreGameLayout) {
      return await window.anyps5.restoreGameLayout(gamePath);
    }
    return { success: false, error: 'Restoring folder layout requires the desktop app.' };
  }

  public onGameLog(callback: (data: { level: string; message: string; timestamp?: string }) => void): () => void {
    if (window.anyps5) {
      return window.anyps5.onGameLog(callback);
    }
    return () => {};
  }

  public onGameExit(callback: (data: { code: number | null; signal?: string | null; exitCodeHex: string; isCrash: boolean }) => void): () => void {
    if (window.anyps5?.onGameExit) {
      return window.anyps5.onGameExit(callback);
    }
    return () => {};
  }

  public async minimizeWindow(): Promise<void> {
    if (window.anyps5?.minimizeWindow) {
      await window.anyps5.minimizeWindow();
    }
  }

  public async maximizeWindow(): Promise<void> {
    if (window.anyps5?.maximizeWindow) {
      await window.anyps5.maximizeWindow();
    }
  }

  public async closeWindow(): Promise<void> {
    if (window.anyps5?.closeWindow) {
      await window.anyps5.closeWindow();
    }
  }

  public async isWindowMaximized(): Promise<boolean> {
    if (window.anyps5?.isWindowMaximized) {
      return await window.anyps5.isWindowMaximized();
    }
    return false;
  }

  public onWindowMaximizedChange(callback: (isMax: boolean) => void): () => void {
    if (window.anyps5?.onWindowMaximizedChange) {
      return window.anyps5.onWindowMaximizedChange(callback);
    }
    return () => {};
  }

  public async checkForUpdates(): Promise<{ status: string; currentVersion: string; error?: string; updateInfo?: any }> {
    if (window.anyps5?.checkForUpdates) {
      return await window.anyps5.checkForUpdates();
    }
    return { status: 'not-available', currentVersion: '1.0.0' };
  }

  public quitAndInstallUpdate(): void {
    if (window.anyps5?.quitAndInstallUpdate) {
      window.anyps5.quitAndInstallUpdate();
    }
  }

  public async getAppVersion(): Promise<string> {
    if (window.anyps5?.getAppVersion) {
      return await window.anyps5.getAppVersion();
    }
    return '1.3.0';
  }

  public async openExternal(url: string): Promise<boolean> {
    if (window.anyps5?.openExternal) {
      return await window.anyps5.openExternal(url);
    }
    window.open(url, '_blank');
    return true;
  }

  public onUpdateStatus(callback: (status: UpdateStatus) => void): () => void {
    if (window.anyps5?.onUpdateStatus) {
      return window.anyps5.onUpdateStatus(callback);
    }
    return () => {};
  }

  private getSimulatedInstalledPRs(): Set<number> {
    try {
      const stored = localStorage.getItem('anyps5_sim_installed_prs');
      return new Set(stored ? JSON.parse(stored) : [7057]);
    } catch {
      return new Set([7057]);
    }
  }

  private saveSimulatedInstalledPRs(set: Set<number>): void {
    try {
      localStorage.setItem('anyps5_sim_installed_prs', JSON.stringify(Array.from(set)));
    } catch {}
  }

  public async getCommunityPRs(repo?: string, forceRefresh?: boolean): Promise<CommunityPR[]> {
    if (window.anyps5?.getCommunityPRs) {
      return await window.anyps5.getCommunityPRs(repo, forceRefresh);
    }
    const targetRepo = repo || 'boykopovar/AnyPS5';
    try {
      const res = await fetch(`https://api.github.com/repos/${targetRepo}/pulls?state=open&per_page=30&sort=updated&direction=desc`);
      if (res.ok) {
        const liveData = await res.json();
        const installedSet = this.getSimulatedInstalledPRs();
        const activePRNum = parseInt(localStorage.getItem('anyps5_sim_active_pr') || '0', 10);
        return liveData.map((item: any) => ({
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
          artifactAvailable: true,
          artifactSizeMb: 15.0,
          isInstalled: installedSet.has(item.number),
          isActive: activePRNum === item.number,
        }));
      }
    } catch {}
    return [];
  }

  public async buildPR(prNumber: number, headSha: string, title: string): Promise<BuildResult> {
    if (window.anyps5?.buildPR) {
      return await window.anyps5.buildPR({ prNumber, headSha, title });
    }
    return { success: false, error: 'Local Builder is not available in browser mode.' };
  }

  public async downloadPRBuild(prNumber: number, artifactUrl?: string, headSha?: string, title?: string): Promise<{ success: boolean; path?: string; error?: string }> {
    if (window.anyps5?.buildPR) {
      return await window.anyps5.buildPR({ prNumber, headSha: headSha || 'HEAD', title: title || ('PR #' + prNumber) });
    }
    const set = this.getSimulatedInstalledPRs();
    set.add(prNumber);
    this.saveSimulatedInstalledPRs(set);
    return { success: true, path: `relinker-pr-${prNumber}.exe` };
  }

  public async setActivePRBuild(prNumber: number): Promise<boolean> {
    if (window.anyps5?.setActivePRBuild) {
      return await window.anyps5.setActivePRBuild(prNumber);
    }
    localStorage.setItem('anyps5_sim_active_pr', String(prNumber));
    return true;
  }

  public async revertToDefaultBuild(): Promise<boolean> {
    if (window.anyps5?.revertToDefaultBuild) {
      return await window.anyps5.revertToDefaultBuild();
    }
    localStorage.removeItem('anyps5_sim_active_pr');
    return true;
  }

  public async deletePRBuild(prNumber: number): Promise<boolean> {
    if (window.anyps5?.deletePRBuild) {
      return await window.anyps5.deletePRBuild(prNumber);
    }
    const set = this.getSimulatedInstalledPRs();
    set.delete(prNumber);
    this.saveSimulatedInstalledPRs(set);
    const active = parseInt(localStorage.getItem('anyps5_sim_active_pr') || '0', 10);
    if (active === prNumber) {
      localStorage.removeItem('anyps5_sim_active_pr');
    }
    return true;
  }

  public async mergeAndBuildPRs(prNumbers: number[]): Promise<MultiPRBuildResult> {
    if (window.anyps5?.mergeAndBuildPRs) {
      return await window.anyps5.mergeAndBuildPRs(prNumbers);
    }
    const buildId = `merged-${prNumbers.sort().join('-')}`;
    return {
      success: true,
      buildId,
      relinkerPath: `experimental-builds/${buildId}/relinker.exe`,
      mergedPRs: prNumbers
    };
  }

  public async getMergedBuilds(): Promise<MergedBuildInfo[]> {
    if (window.anyps5?.getMergedBuilds) {
      return await window.anyps5.getMergedBuilds();
    }
    return [
      {
        id: 'merged-7049-7053',
        name: 'Combined Build: PR #7049 + #7053',
        prNumbers: [7049, 7053],
        installedAt: '2026-10-17T08:30:00Z',
        relinkerPath: 'userData/experimental-builds/merged-7049-7053/relinker.exe',
        isActive: false
      }
    ];
  }

  public async setActiveMergedBuild(buildId: string): Promise<boolean> {
    if (window.anyps5?.setActiveMergedBuild) {
      return await window.anyps5.setActiveMergedBuild(buildId);
    }
    return true;
  }

  public async deleteMergedBuild(buildId: string): Promise<boolean> {
    if (window.anyps5?.deleteMergedBuild) {
      return await window.anyps5.deleteMergedBuild(buildId);
    }
    return true;
  }

  public onPRDownloadProgress(callback: (progress: PRBuildDownloadProgress) => void): () => void {
    if (window.anyps5?.onPRDownloadProgress) {
      return window.anyps5.onPRDownloadProgress(callback);
    }
    return () => {};
  }

  public async getRuntimesManifest(): Promise<RuntimesManifest> {
    if (window.anyps5?.getRuntimesManifest) {
      return await window.anyps5.getRuntimesManifest();
    }
    return {
      activeGlobalRuntimeId: 'bundled',
      runtimes: [
        {
          id: 'bundled',
          name: 'Bundled Stable (v0.1.2)',
          type: 'bundled',
          commitHash: 'v0.1.2',
          date: '2026-10-14T08:56:52Z',
          path: 'bundled',
          isRemovable: false,
        },
      ],
    };
  }

  public async listRuntimes(): Promise<ResolvedRuntime[]> {
    if (window.anyps5?.listRuntimes) {
      return await window.anyps5.listRuntimes();
    }
    return [
      {
        id: 'bundled',
        name: 'Bundled Stable (v0.1.2)',
        type: 'bundled',
        commitHash: 'v0.1.2',
        date: '2026-10-14T08:56:52Z',
        relinkerPath: 'bundled/relinker.exe',
        libsPath: 'bundled/libs',
        isRemovable: false,
        isValid: true,
      },
    ];
  }

  public async resolveRuntime(runtimeId?: string): Promise<ResolvedRuntime> {
    if (window.anyps5?.resolveRuntime) {
      return await window.anyps5.resolveRuntime(runtimeId);
    }
    return {
      id: runtimeId || 'bundled',
      name: 'Bundled Stable (v0.1.2)',
      type: 'bundled',
      commitHash: 'v0.1.2',
      date: '2026-10-14T08:56:52Z',
      relinkerPath: 'bundled/relinker.exe',
      libsPath: 'bundled/libs',
      isRemovable: false,
      isValid: true,
    };
  }

  public async setActiveGlobalRuntime(runtimeId: string): Promise<boolean> {
    if (window.anyps5?.setActiveGlobalRuntime) {
      return await window.anyps5.setActiveGlobalRuntime(runtimeId);
    }
    return true;
  }

  public async registerCustomRuntime(args: {
    name: string;
    customPath: string;
    relinkerOverride?: string;
    libsOverride?: string;
  }): Promise<RuntimeProfile> {
    if (window.anyps5?.registerCustomRuntime) {
      return await window.anyps5.registerCustomRuntime(args);
    }
    return {
      id: `custom-${Date.now()}`,
      name: args.name,
      type: 'custom',
      date: new Date().toISOString(),
      path: args.customPath,
      relinkerPath: args.relinkerOverride,
      libsPath: args.libsOverride,
      isRemovable: true,
    };
  }

  public async removeRuntime(runtimeId: string): Promise<boolean> {
    if (window.anyps5?.removeRuntime) {
      return await window.anyps5.removeRuntime(runtimeId);
    }
    return true;
  }

  public async setGameRuntime(titleId: string, runtimeId: string): Promise<boolean> {
    if (window.anyps5?.setGameRuntime) {
      return await window.anyps5.setGameRuntime(titleId, runtimeId);
    }
    try {
      const stored = localStorage.getItem('anyps5_game_runtimes');
      const map = stored ? JSON.parse(stored) : {};
      map[titleId] = runtimeId;
      localStorage.setItem('anyps5_game_runtimes', JSON.stringify(map));
    } catch {}
    return true;
  }

  public async getGameRuntime(titleId: string): Promise<string | undefined> {
    if (window.anyps5?.getGameRuntime) {
      return await window.anyps5.getGameRuntime(titleId);
    }
    try {
      const stored = localStorage.getItem('anyps5_game_runtimes');
      const map = stored ? JSON.parse(stored) : {};
      return map[titleId];
    } catch {
      return undefined;
    }
  }

  public async setPlaygoOverride(titleId: string, mode: PlaygoMode): Promise<boolean> {
    if (window.anyps5?.setPlaygoOverride) {
      return await window.anyps5.setPlaygoOverride(titleId, mode);
    }
    try {
      const stored = localStorage.getItem('anyps5_settings');
      const settings = stored ? JSON.parse(stored) : {};
      const overrides = { ...(settings.playgoOverrides || {}) };
      if (mode === 'installed' || mode === 'absent') {
        overrides[titleId] = mode;
      } else {
        delete overrides[titleId];
      }
      settings.playgoOverrides = overrides;
      localStorage.setItem('anyps5_settings', JSON.stringify(settings));
    } catch {}
    return true;
  }

  public async getPlaygoOverride(titleId: string): Promise<PlaygoOverrideInfo> {
    if (window.anyps5?.getPlaygoOverride) {
      return await window.anyps5.getPlaygoOverride(titleId);
    }
    const presets: Record<string, 'installed' | 'absent'> = {
      'PPSA10112': 'installed',
      'PPSA15388': 'installed',
      'PPSA03001': 'absent',
      'PPSA03490': 'absent',
    };
    try {
      const stored = localStorage.getItem('anyps5_settings');
      const settings = stored ? JSON.parse(stored) : {};
      const custom = settings.playgoOverrides?.[titleId] || null;
      const preset = presets[titleId] || null;
      return {
        effective: custom || preset || null,
        custom,
        preset,
      };
    } catch {
      const preset = presets[titleId] || null;
      return {
        effective: preset,
        custom: null,
        preset,
      };
    }
  }

  public async getGitHubAuthStatus(): Promise<GitHubAuthStatus> {
    if (window.anyps5?.getGitHubAuthStatus) {
      return await window.anyps5.getGitHubAuthStatus();
    }
    return { isConnected: false };
  }

  public async requestGitHubDeviceCode(): Promise<GitHubDeviceCodeResponse> {
    if (window.anyps5?.requestGitHubDeviceCode) {
      return await window.anyps5.requestGitHubDeviceCode();
    }
    return {
      device_code: 'simulated_device_code',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    };
  }

  public async checkGitHubDeviceCode(deviceCode: string): Promise<{
    status: 'pending' | 'slow_down' | 'approved' | 'expired' | 'error';
    accessToken?: string;
    interval?: number;
    error?: string;
  }> {
    if (window.anyps5?.checkGitHubDeviceCode) {
      return await window.anyps5.checkGitHubDeviceCode(deviceCode);
    }
    return { status: 'approved', accessToken: 'gho_simulated_token' };
  }

  public async setGitHubPersonalAccessToken(token: string): Promise<{ success: boolean; username?: string; error?: string }> {
    if (window.anyps5?.setGitHubPersonalAccessToken) {
      return await window.anyps5.setGitHubPersonalAccessToken(token);
    }
    return { success: true, username: 'demo-user' };
  }

  public async disconnectGitHub(): Promise<boolean> {
    if (window.anyps5?.disconnectGitHub) {
      return await window.anyps5.disconnectGitHub();
    }
    return true;
  }

  public async fetchUpstreamCommits(args?: { repo?: string; page?: number; perPage?: number }): Promise<CommitsPageResult> {
    if (window.anyps5?.fetchUpstreamCommits) {
      return await window.anyps5.fetchUpstreamCommits(args);
    }
    return {
      commits: [
        {
          sha: 'a4f912c49921b0e2f5c1d9b3a7e8f01234567890',
          shortSha: 'a4f912c',
          message: 'Fix AGC texture swizzling for tiled surfaces',
          author: 'boykopovar',
          date: '2026-10-18T18:42:10Z',
          htmlUrl: 'https://github.com/boykopovar/AnyPS5/commit/a4f912c',
          isInstalled: false,
          isActive: false,
          artifactAvailable: true,
        },
        {
          sha: '8c3e091b617290a1f2e3d4c5b6a7890123456789',
          shortSha: '8c3e091',
          message: 'Implement ScePfs path canonicalization for app0 guest root',
          author: 'contributor',
          date: '2026-10-18T14:15:00Z',
          htmlUrl: 'https://github.com/boykopovar/AnyPS5/commit/8c3e091',
          isInstalled: false,
          isActive: false,
          artifactAvailable: true,
        },
      ],
      hasMore: false,
      page: args?.page || 1,
    };
  }

  public async compareUpstreamCommits(args?: { baseSha?: string; headRef?: string; repo?: string }): Promise<UpstreamComparison> {
    if (window.anyps5?.compareUpstreamCommits) {
      return await window.anyps5.compareUpstreamCommits(args);
    }
    return {
      status: 'ahead',
      aheadBy: 14,
      behindBy: 0,
      headSha: 'a4f912c49921b0e2f5c1d9b3a7e8f01234567890',
      headShortSha: 'a4f912c',
      headCommitMessage: 'Fix AGC texture swizzling for tiled surfaces',
      headCommitDate: '2026-10-18T18:42:10Z',
      headCommitAuthor: 'boykopovar',
      isUpToDate: false,
    };
  }

  public async downloadCommitArtifact(commit: {
    sha: string;
    shortSha: string;
    message: string;
    date?: string;
  }): Promise<{ success: boolean; runtimeId?: string; error?: string }> {
    if (window.anyps5?.downloadCommitArtifact) {
      return await window.anyps5.downloadCommitArtifact(commit);
    }
    return { success: true, runtimeId: `commit-${commit.shortSha}` };
  }

  public onCommitDownloadProgress(
    callback: (data: { shortSha: string; status: string; progress: number; error?: string }) => void
  ): () => void {
    if (window.anyps5?.onCommitDownloadProgress) {
      return window.anyps5.onCommitDownloadProgress(callback);
    }
    return () => {};
  }

  public async inspectToolchain(): Promise<ToolchainInspectionResult> {
    if (window.anyps5?.inspectToolchain) {
      return await window.anyps5.inspectToolchain();
    }
    return {
      tools: [
        { name: 'Git', command: 'git', version: 'git version 2.54.0.windows.1', isManaged: false, isAvailable: true },
        { name: 'Python 3', command: 'python', version: 'Python 3.14.5', isManaged: false, isAvailable: true },
        { name: 'CMake', command: 'cmake', version: 'cmake version 4.4.4', isManaged: false, isAvailable: true },
        { name: 'Ninja', command: 'ninja', version: '1.13.2', isManaged: false, isAvailable: true },
        { name: 'C++ Compiler', command: 'g++', version: 'g++ (MinGW-W64) 15.2.0', isManaged: false, isAvailable: true },
      ],
      allRequiredAvailable: true,
    };
  }

  public async installManagedToolchain(): Promise<{ success: boolean; error?: string }> {
    if (window.anyps5?.installManagedToolchain) {
      return await window.anyps5.installManagedToolchain();
    }
    return { success: true };
  }

  public onToolchainInstallProgress(callback: (data: ToolchainInstallProgress) => void): () => void {
    if (window.anyps5?.onToolchainInstallProgress) {
      return window.anyps5.onToolchainInstallProgress(callback);
    }
    return () => {};
  }

  public async getSourceStatus(): Promise<SourceSyncStatus> {
    if (window.anyps5?.getSourceStatus) {
      return await window.anyps5.getSourceStatus();
    }
    return {
      exists: true,
      repoUrl: 'https://github.com/boykopovar/AnyPS5.git',
      currentCommit: '4ffb0cd04746f32e92cfa717fe1d78cb1ae77c61',
      shortCommit: '4ffb0cd',
      commitMessage: 'Merge pull request #7377 from EagleBearerYS/fix/shader-pixel-bda-single-exit',
      branch: 'main',
      isSyncing: false,
    };
  }

  public async syncSource(): Promise<{ success: boolean; commit?: string; error?: string }> {
    if (window.anyps5?.syncSource) {
      return await window.anyps5.syncSource();
    }
    return { success: true, commit: '4ffb0cd' };
  }

  public async startBuild(): Promise<BuildResult> {
    if (window.anyps5?.startBuild) {
      return await window.anyps5.startBuild();
    }
    return { success: true, runtimeId: 'commit-4ffb0cd' };
  }

  public async cancelBuild(): Promise<{ success: boolean }> {
    if (window.anyps5?.cancelBuild) {
      return await window.anyps5.cancelBuild();
    }
    return { success: true };
  }

  public async getActiveBuild(): Promise<{ isBuilding: boolean; buildingPR: number | null; recentLogs?: BuilderLogMessage[] }> {
    if (window.anyps5?.getActiveBuild) {
      return await window.anyps5.getActiveBuild();
    }
    return { isBuilding: false, buildingPR: null, recentLogs: [] };
  }

  public onBuilderLog(callback: (data: BuilderLogMessage) => void): () => void {
    if (window.anyps5?.onBuilderLog) {
      return window.anyps5.onBuilderLog(callback);
    }
    return () => {};
  }

  public onBuildStatus(callback: (data: BuildProgressStatus) => void): () => void {
    if (window.anyps5?.onBuildStatus) {
      return window.anyps5.onBuildStatus(callback);
    }
    return () => {};
  }





  /**
   * Run the AnyPS5 Relinker pipeline with live step updates and realistic log streaming
   */
  public async executeRelinker(
    game: GameItem,
    options: RelinkerOptions,
    onStageUpdate: (stage: ConversionStage) => void,
    onLog: (log: ConversionLog) => void,
    onFinish?: (updatedGame?: GameItem) => void
  ): Promise<boolean> {
    if (window.anyps5) {
      // In Electron native mode: subscribe to IPC events and invoke
      return new Promise((resolve) => {
        const cleanup = window.anyps5!.onRelinkerEvent((event: any) => {
          if (event.type === 'stage') onStageUpdate(event.data);
          if (event.type === 'log') onLog(event.data);
          if (event.type === 'finish') {
            cleanup();
            if (onFinish && event.data?.updatedGame) {
              onFinish(event.data.updatedGame);
            }
            resolve(true);
          }
          if (event.type === 'error') {
            cleanup();
            resolve(false);
          }
        });
        window.anyps5!.runRelinker(game, options, 'conv-' + Date.now());
      });
    }

    // Web simulation / Interactive demonstration mode
    const stages = [
      { id: 1, title: 'Validating Decrypted ELF', description: 'Inspecting ELF headers, PT_LOAD segments & SELF boundaries' },
      { id: 2, title: 'Scanning System Imports (NIDs)', description: 'Resolving PS5 library imports against clean-room PRX exports' },
      { id: 3, title: 'Scanning Bundled Modules', description: 'Parsing modules in sce_module/ for runtime PRX dependencies' },
      { id: 4, title: 'AMD to Intel Codegen Translation', description: options.cpuTranslation === 'intel' ? 'Rewriting AMD-specific Zen2 instructions' : 'Instruction lowering skipped (AMD Native)' },
      { id: 5, title: 'Unused Import Filter & PLT Optimization', description: `Analyzing call graph with unused-filter=${options.unusedFilter}` },
      { id: 6, title: options.target === 'linux' ? 'Relinking Native ELF Executable' : 'Relinking PE Executable', description: options.target === 'linux' ? 'Generating Linux ELF headers, dynamic tags, and entry RVA' : 'Generating Windows PE headers, import tables, and entry RVA' },
      { id: 7, title: 'Copying Clean-room PRX Libraries', description: 'Deploying libkernel.prx, libSceAgcDriver.prx, libScePad.prx' },
      { id: 8, title: 'Finalizing Native Package', description: options.target === 'linux' ? 'Writing app.elf and runtime configuration' : 'Writing app.exe and registry metadata' },
    ];

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `[AnyPS5] Initializing relinker for ${game.title} (${game.titleId})`,
    });
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `[AnyPS5] Options: target=${options.target}, subsystem=${options.subsystem}, cpu=${options.cpuTranslation}, unused-filter=${options.unusedFilter}`,
    });

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      onStageUpdate({
        ...stage,
        status: 'active',
        progress: 0,
      });

      // Realistic log events for each stage
      await new Promise((r) => setTimeout(r, 600));
      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: `Stage ${i + 1}/${stages.length}: ${stage.title} - ${stage.description}`,
      });

      if (i === 1) {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'success',
          message: `[NID-Patcher] Resolved ${game.compatibility.resolvedNids}/${game.compatibility.totalNids} imported functions (${game.compatibility.score}%)`,
        });
      }

      if (i === 3 && options.cpuTranslation === 'intel') {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'info',
          message: `[Codegen] Replaced ${game.compatibility.amdInstructionsDetected} AMD Zen2 instructions with Intel AVX2 equivalents`,
        });
      }

      await new Promise((r) => setTimeout(r, 450));
      onStageUpdate({
        ...stage,
        status: 'completed',
        progress: 100,
      });
    }

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `[AnyPS5] Conversion completed successfully! Output: ${game.path}/app.exe ready to run natively.`,
    });

    return true;
  }
}

export const apiBridge = new ApiBridge();
