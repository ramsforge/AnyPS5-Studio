import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('anyps5', {
  selectFolder: () => ipcRenderer.invoke('anyps5:select-folder'),
  inspectFolder: (folderPath: string) => ipcRenderer.invoke('anyps5:inspect-folder', folderPath),
  scanDirectory: (rootPath: string) => ipcRenderer.invoke('anyps5:scan-directory', rootPath),
  auditGameNids: (game: unknown, forceRefresh?: boolean) => ipcRenderer.invoke('anyps5:audit-game-nids', game, forceRefresh),
  getGames: () => ipcRenderer.invoke('anyps5:get-games'),
  saveGames: (games: unknown) => ipcRenderer.invoke('anyps5:save-games', games),
  runRelinker: (game: unknown, options: unknown, callbackId: string) => 
    ipcRenderer.invoke('anyps5:run-relinker', { game, options, callbackId }),
  cancelRelinker: () => ipcRenderer.invoke('anyps5:cancel-relinker'),
  launchGame: (game: unknown) => ipcRenderer.invoke('anyps5:launch-game', game),
  stopGame: (pid?: number) => ipcRenderer.invoke('anyps5:stop-game', pid),
  restoreGameLayout: (gamePath: string) => ipcRenderer.invoke('anyps5:restore-game-layout', gamePath),
  getSystemTelemetry: () => ipcRenderer.invoke('anyps5:get-telemetry'),
  getSettings: () => ipcRenderer.invoke('anyps5:get-settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('anyps5:save-settings', settings),
  getAvailableGpus: () => ipcRenderer.invoke('anyps5:get-available-gpus'),
  selectFile: (filters?: unknown) => ipcRenderer.invoke('anyps5:select-file', filters),
  checkForUpdates: () => ipcRenderer.invoke('anyps5:check-for-updates'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('anyps5:quit-and-install-update'),
  getAppVersion: () => ipcRenderer.invoke('anyps5:get-app-version'),
  openExternal: (url: string) => ipcRenderer.invoke('anyps5:open-external', url),
  getDiscordStatus: () => ipcRenderer.invoke('anyps5:get-discord-status'),
  reconnectDiscord: () => ipcRenderer.invoke('anyps5:reconnect-discord'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_: unknown, status: unknown) => callback(status);
    ipcRenderer.on('anyps5:update-status', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:update-status', handler);
    };
  },
  getCommunityPRs: (repo?: string, forceRefresh?: boolean) => ipcRenderer.invoke('anyps5:get-community-prs', repo, forceRefresh),
  downloadPRBuild: (args: { prNumber: number; artifactUrl?: string; headSha?: string; title?: string }) => 
    ipcRenderer.invoke('anyps5:download-pr-build', args),
  buildPR: (args: { prNumber: number; headSha: string; title: string }) => 
    ipcRenderer.invoke('anyps5:build-pr', args),
  setActivePRBuild: (prNumber: number) => ipcRenderer.invoke('anyps5:set-active-pr-build', prNumber),
  revertToDefaultBuild: () => ipcRenderer.invoke('anyps5:revert-to-default-build'),
  deletePRBuild: (prNumber: number) => ipcRenderer.invoke('anyps5:delete-pr-build', prNumber),
  mergeAndBuildPRs: (prNumbers: number[]) => ipcRenderer.invoke('anyps5:merge-and-build-prs', prNumbers),
  getMergedBuilds: () => ipcRenderer.invoke('anyps5:get-merged-builds'),
  setActiveMergedBuild: (buildId: string) => ipcRenderer.invoke('anyps5:set-active-merged-build', buildId),
  deleteMergedBuild: (buildId: string) => ipcRenderer.invoke('anyps5:delete-merged-build', buildId),
  onPRDownloadProgress: (callback: (progress: unknown) => void) => {
    const handler = (_: unknown, progress: unknown) => callback(progress);
    ipcRenderer.on('anyps5:pr-download-progress', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:pr-download-progress', handler);
    };
  },
  onRelinkerEvent: (callback: (event: { type: string; data: unknown }) => void) => {
    const handler = (_: unknown, event: { type: string; data: unknown }) => callback(event);
    ipcRenderer.on('anyps5:relinker-event', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:relinker-event', handler);
    };
  },
  onGameLog: (callback: (data: { level: string; message: string; timestamp?: string }) => void) => {
    const handler = (_: unknown, data: { level: string; message: string; timestamp?: string }) => callback(data);
    ipcRenderer.on('anyps5:game-log', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:game-log', handler);
    };
  },
  onGameExit: (callback: (data: { code: number | null; signal?: string | null; exitCodeHex: string; isCrash: boolean }) => void) => {
    const handler = (_: unknown, data: { code: number | null; signal?: string | null; exitCodeHex: string; isCrash: boolean }) => callback(data);
    ipcRenderer.on('anyps5:game-exit', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:game-exit', handler);
    };
  },
  minimizeWindow: () => ipcRenderer.invoke('anyps5:minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('anyps5:maximize-window'),
  closeWindow: () => ipcRenderer.invoke('anyps5:close-window'),
  isWindowMaximized: () => ipcRenderer.invoke('anyps5:is-maximized'),
  onWindowMaximizedChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_: unknown, isMax: boolean) => callback(isMax);
    ipcRenderer.on('anyps5:window-maximized-change', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:window-maximized-change', handler);
    };
  },
  getRuntimesManifest: () => ipcRenderer.invoke('anyps5:runtimes-get-manifest'),
  listRuntimes: () => ipcRenderer.invoke('anyps5:runtimes-list'),
  resolveRuntime: (runtimeId?: string) => ipcRenderer.invoke('anyps5:runtimes-resolve', runtimeId),
  setActiveGlobalRuntime: (runtimeId: string) => ipcRenderer.invoke('anyps5:runtimes-set-active-global', runtimeId),
  registerCustomRuntime: (args: { name: string; customPath: string; relinkerOverride?: string; libsOverride?: string }) =>
    ipcRenderer.invoke('anyps5:runtimes-register-custom', args),
  removeRuntime: (runtimeId: string) => ipcRenderer.invoke('anyps5:runtimes-remove', runtimeId),
  setGameRuntime: (titleId: string, runtimeId: string) => ipcRenderer.invoke('anyps5:set-game-runtime', { titleId, runtimeId }),
  getGameRuntime: (titleId: string) => ipcRenderer.invoke('anyps5:get-game-runtime', titleId),
  setPlaygoOverride: (titleId: string, mode: string) => ipcRenderer.invoke('anyps5:set-playgo-override', { titleId, mode }),
  getPlaygoOverride: (titleId: string) => ipcRenderer.invoke('anyps5:get-playgo-override', titleId),
  getGitHubAuthStatus: () => ipcRenderer.invoke('anyps5:github-get-auth-status'),
  requestGitHubDeviceCode: () => ipcRenderer.invoke('anyps5:github-request-device-code'),
  checkGitHubDeviceCode: (deviceCode: string) => ipcRenderer.invoke('anyps5:github-check-device-code', deviceCode),
  setGitHubPersonalAccessToken: (token: string) => ipcRenderer.invoke('anyps5:github-set-pat', token),
  disconnectGitHub: () => ipcRenderer.invoke('anyps5:github-disconnect'),
  fetchUpstreamCommits: (args?: { repo?: string; page?: number; perPage?: number }) => ipcRenderer.invoke('anyps5:github-fetch-commits', args),
  compareUpstreamCommits: (args?: { baseSha?: string; headRef?: string; repo?: string }) => ipcRenderer.invoke('anyps5:github-compare-commits', args),
  downloadCommitArtifact: (commit: { sha: string; shortSha: string; message: string; date?: string }) =>
    ipcRenderer.invoke('anyps5:github-download-commit', commit),
  onCommitDownloadProgress: (callback: (data: { shortSha: string; status: string; progress: number; error?: string }) => void) => {
    const handler = (_: unknown, data: any) => callback(data);
    ipcRenderer.on('anyps5:commit-download-progress', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:commit-download-progress', handler);
    };
  },
  inspectToolchain: () => ipcRenderer.invoke('anyps5:builder-inspect-toolchain'),
  installManagedToolchain: () => ipcRenderer.invoke('anyps5:builder-install-toolchain'),
  onToolchainInstallProgress: (callback: (data: any) => void) => {
    const handler = (_: unknown, data: any) => callback(data);
    ipcRenderer.on('anyps5:builder-toolchain-progress', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:builder-toolchain-progress', handler);
    };
  },
  getSourceStatus: () => ipcRenderer.invoke('anyps5:builder-get-source-status'),
  syncSource: () => ipcRenderer.invoke('anyps5:builder-sync-source'),
  startBuild: () => ipcRenderer.invoke('anyps5:builder-start-build'),
  cancelBuild: () => ipcRenderer.invoke('anyps5:builder-cancel-build'),
  getActiveBuild: () => ipcRenderer.invoke('anyps5:builder-get-active-build'),
  onBuilderLog: (callback: (data: any) => void) => {
    const handler = (_: unknown, data: any) => callback(data);
    ipcRenderer.on('anyps5:builder-log', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:builder-log', handler);
    };
  },
  onBuildStatus: (callback: (data: any) => void) => {
    const handler = (_: unknown, data: any) => callback(data);
    ipcRenderer.on('anyps5:builder-status', handler);
    return () => {
      ipcRenderer.removeListener('anyps5:builder-status', handler);
    };
  },
});


