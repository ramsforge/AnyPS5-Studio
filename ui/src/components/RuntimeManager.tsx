import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu,
  GitCommit,
  Trash2,
  ExternalLink,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  FolderOpen,
  Key,
  ShieldCheck,
  Check,
  Copy,
  Plus,
  Loader2,
  RotateCcw,
  Lock,
  User,
  Power,
  History,
  Sparkles,
  ArrowUpRight,
  Hammer,
  X
} from 'lucide-react';
import { LocalBuilder } from './LocalBuilder';
import {
  RuntimeProfile,
  RuntimesManifest,
  ResolvedRuntime,
  GitHubAuthStatus,
  GitHubDeviceCodeResponse,
  UpstreamCommit,
  UpstreamComparison
} from '../types';
import { apiBridge } from '../services/apiBridge';
import { audioService } from '../services/audioService';

interface RuntimeManagerProps {
  onNavigateToGames?: () => void;
  onNavigateToRelinker?: () => void;
}

export const RuntimeManager: React.FC<RuntimeManagerProps> = ({
  onNavigateToGames,
  onNavigateToRelinker
}) => {
  const [manifest, setManifest] = useState<RuntimesManifest | null>(null);
  const [resolvedRuntimes, setResolvedRuntimes] = useState<ResolvedRuntime[]>([]);
  const [commits, setCommits] = useState<UpstreamCommit[]>([]);
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus>({ isConnected: false });
  const [loadingCommits, setLoadingCommits] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'custom' | 'installed' | 'upstream'>('custom');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Pagination & Upstream Comparison State
  const [commitsPage, setCommitsPage] = useState<number>(1);
  const [hasMoreCommits, setHasMoreCommits] = useState<boolean>(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState<boolean>(false);
  const [comparison, setComparison] = useState<UpstreamComparison | null>(null);
  const [loadingComparison, setLoadingComparison] = useState<boolean>(false);

  // Device Code Modal State
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [deviceCodeData, setDeviceCodeData] = useState<GitHubDeviceCodeResponse | null>(null);
  const [isPollingDeviceCode, setIsPollingDeviceCode] = useState<boolean>(false);
  const [devicePollError, setDevicePollError] = useState<string | null>(null);
  const [isCodeCopied, setIsCodeCopied] = useState<boolean>(false);
  const [isVerifyingAuth, setIsVerifyingAuth] = useState<boolean>(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Commit Download Progress

  interface ActionNotification {
    message: string;
    type: 'success' | 'error' | 'info';
  }

  // Status banners / action feedback
  const [actionNotice, setActionNotice] = useState<ActionNotification | null>(null);
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showNotification = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    setActionNotice({ message: msg, type });
    noticeTimerRef.current = setTimeout(() => {
      setActionNotice(null);
    }, 5000);
  };

  const loadRuntimes = useCallback(async () => {
    try {
      const [man, list, auth] = await Promise.all([
        apiBridge.getRuntimesManifest(),
        apiBridge.listRuntimes(),
        apiBridge.getGitHubAuthStatus(),
      ]);
      setManifest(man);
      setResolvedRuntimes(list);
      setAuthStatus(auth);
    } catch (err) {
      console.error('Failed to load runtime data:', err);
    }
  }, []);

  const loadComparison = useCallback(async () => {
    setLoadingComparison(true);
    try {
      const comp = await apiBridge.compareUpstreamCommits();
      setComparison(comp);
    } catch (err) {
      console.warn('Could not compare upstream commits:', err);
    } finally {
      setLoadingComparison(false);
    }
  }, []);

  const loadCommits = useCallback(async (page: number = 1, append: boolean = false) => {
    if (append) {
      setLoadingMoreCommits(true);
    } else {
      setLoadingCommits(true);
    }
    try {
      const pageResult = await apiBridge.fetchUpstreamCommits({ page, perPage: 100 });
      if (append) {
        setCommits((prev) => [...prev, ...pageResult.commits]);
      } else {
        setCommits(pageResult.commits);
      }
      setCommitsPage(pageResult.page);
      setHasMoreCommits(pageResult.hasMore);
    } catch (err) {
      console.warn('Could not fetch upstream commits:', err);
    } finally {
      setLoadingCommits(false);
      setLoadingMoreCommits(false);
    }
  }, []);

  useEffect(() => {
    loadRuntimes();
    loadCommits(1, false);
    loadComparison();
  }, [loadRuntimes, loadCommits, loadComparison]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setIsPollingDeviceCode(false);
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const checkAuthStatusOnce = async (deviceCode: string, isManual: boolean = false): Promise<{ success: boolean; nextInterval?: number }> => {
    if (isManual) {
      setIsVerifyingAuth(true);
      setDevicePollError(null);
    }

    try {
      const res = await apiBridge.checkGitHubDeviceCode(deviceCode);
      if (res.status === 'approved') {
        stopPolling();
        setIsVerifyingAuth(false);
        setIsAuthModalOpen(false);
        audioService.playConfirm();
        showNotification('GitHub account authorized successfully!');
        const updatedAuth = await apiBridge.getGitHubAuthStatus();
        setAuthStatus(updatedAuth);
        loadCommits(1, false);
        loadComparison();
        return { success: true };
      } else if (res.status === 'expired' || res.status === 'error') {
        stopPolling();
        setIsVerifyingAuth(false);
        setDevicePollError(res.error || 'Authorization expired or failed.');
        return { success: false };
      } else if (res.status === 'pending') {
        if (isManual) {
          setIsVerifyingAuth(false);
          setDevicePollError('Authorization pending: Please confirm you entered the code and clicked "Authorize" in your browser, then try again.');
        }
        return { success: false };
      } else if (res.status === 'slow_down') {
        const nextInt = (res.interval && res.interval > 0) ? res.interval : 10;
        if (isManual) {
          setIsVerifyingAuth(false);
          setDevicePollError(`GitHub rate limit: Waiting ${nextInt} seconds before re-checking...`);
        }
        return { success: false, nextInterval: nextInt };
      }
    } catch (err: any) {
      if (isManual) {
        setIsVerifyingAuth(false);
        setDevicePollError(err?.message || 'Failed to verify authorization.');
      }
    }
    return { success: false };
  };

  // Start Device Flow
  const handleStartDeviceFlow = async () => {
    stopPolling();
    setIsAuthModalOpen(true);
    setDevicePollError(null);
    setDeviceCodeData(null);
    setIsPollingDeviceCode(true);
    setIsVerifyingAuth(false);

    try {
      const data = await apiBridge.requestGitHubDeviceCode();
      setDeviceCodeData(data);

      // Recursive polling that dynamically adjusts to GitHub's slow_down interval
      let currentInterval = Math.max(data.interval || 5, 5);
      const scheduleNextPoll = (delaySec: number) => {
        pollTimerRef.current = setTimeout(async () => {
          const result = await checkAuthStatusOnce(data.device_code, false);
          if (!result.success) {
            if (result.nextInterval) {
              currentInterval = result.nextInterval;
            }
            scheduleNextPoll(currentInterval);
          }
        }, delaySec * 1000);
      };

      scheduleNextPoll(currentInterval);

      // Auto-expire after timeout
      setTimeout(() => {
        stopPolling();
      }, (data.expires_in || 900) * 1000);

    } catch (err: any) {
      stopPolling();
      setDevicePollError(err?.message || 'Failed to initiate GitHub Device authorization.');
    }
  };

  const handleManualVerify = async () => {
    if (!deviceCodeData?.device_code || isVerifyingAuth) return;
    await checkAuthStatusOnce(deviceCodeData.device_code, true);
  };

  const handleCopyCodeAndOpenBrowser = () => {
    if (deviceCodeData) {
      navigator.clipboard.writeText(deviceCodeData.user_code);
      setIsCodeCopied(true);
      setTimeout(() => setIsCodeCopied(false), 3000);
      const targetUrl = deviceCodeData.verification_uri || 'https://github.com/login/device';
      if (window.anyps5?.openExternal) {
        window.anyps5.openExternal(targetUrl);
      } else {
        window.open(targetUrl, '_blank');
      }
    }
  };

  const handleDisconnect = async () => {
    audioService.playCancel();
    await apiBridge.disconnectGitHub();
    setAuthStatus({ isConnected: false });
    showNotification('Disconnected GitHub account.', 'info');
    loadCommits(1, false);
    loadComparison();
  };

  const handleSetActiveGlobal = async (runtimeId: string) => {
    audioService.playConfirm();
    await apiBridge.setActiveGlobalRuntime(runtimeId);
    showNotification(`Active global runtime set to "${runtimeId}".`, 'success');
    await loadRuntimes();
    await loadComparison();
    await loadCommits(commitsPage, false);
  };

  const handleRemoveRuntime = async (runtimeId: string) => {
    audioService.playCancel();
    const ok = await apiBridge.removeRuntime(runtimeId);
    if (ok) {
      showNotification(`Runtime "${runtimeId}" removed.`, 'info');
      await loadRuntimes();
      await loadComparison();
      await loadCommits(commitsPage, false);
    }
  };

  const activeGlobalId = manifest?.activeGlobalRuntimeId || 'bundled';
  const activeRuntime = resolvedRuntimes.find((r) => r.id === activeGlobalId) || resolvedRuntimes[0];

  const filteredCommits = commits.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.shortSha.toLowerCase().includes(q) ||
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q)
    );
  });

  return (
    <div className="relative w-full h-[calc(100vh-64px)] mt-16 p-6 md:p-8 lg:p-10 overflow-y-auto select-none animate-fade-in text-slate-100">
      {/* Action Notification Toast (Top-Right, capped max-w-md, wrapped text, dismissible X) */}
      {actionNotice && (
        <div className="fixed top-20 right-6 z-50 max-w-md w-full animate-fade-in pointer-events-auto">
          <div
            className={`p-3.5 rounded-xl border shadow-2xl backdrop-blur-md flex items-start space-x-3 transition-all ${
              actionNotice.type === 'error'
                ? 'bg-[#180a0d]/95 border-rose-500/40 text-rose-200 shadow-rose-950/60'
                : actionNotice.type === 'info'
                ? 'bg-[#0a1018]/95 border-blue-500/40 text-blue-200 shadow-blue-950/60'
                : 'bg-[#0b1510]/95 border-emerald-500/40 text-emerald-200 shadow-emerald-950/60'
            }`}
          >
            {actionNotice.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            ) : actionNotice.type === 'info' ? (
              <Clock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            )}

            <div className="flex-1 min-w-0 text-xs font-medium leading-relaxed break-words">
              {actionNotice.message}
            </div>

            <button
              onClick={() => {
                audioService.playNavTick();
                if (noticeTimerRef.current) {
                  clearTimeout(noticeTimerRef.current);
                }
                setActionNotice(null);
              }}
              className="p-1 -mr-1 -mt-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              title="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Header & GitHub Connection Bar */}
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/5">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Cpu className="w-4 h-4" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Runtime Manager</h1>
          </div>

          {/* GitHub Connection Status / Action */}
          <div className="flex items-center space-x-3 bg-white/[0.02] border border-white/10 rounded-xl px-3 py-1.5 shrink-0">
            {authStatus.isConnected ? (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    {authStatus.avatarUrl ? (
                      <img src={authStatus.avatarUrl} alt="avatar" className="w-6 h-6 rounded-full border border-white/10" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                        <User className="w-3 h-3 text-neutral-300" />
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-white leading-tight">@{authStatus.username || 'authorized'}</div>
                    <div className="text-[10px] text-neutral-400 font-mono">
                      {authStatus.rateLimit
                        ? `${authStatus.rateLimit.remaining.toLocaleString()} / ${authStatus.rateLimit.limit.toLocaleString()} req/hr`
                        : '5,000 req/hr unlocked'}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleDisconnect}
                  className="p-1 rounded-md text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  title="Disconnect GitHub account"
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <div className="text-[11px] text-neutral-400">
                  <span className="text-neutral-400">Rate Limit: </span>
                  <span className="font-mono text-neutral-300">
                    {authStatus.rateLimit ? `${authStatus.rateLimit.remaining}/60` : '60'} req/hr
                  </span>
                </div>
                <button
                  onClick={handleStartDeviceFlow}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium text-xs border border-white/10 transition-all shadow-sm"
                >
                  <Key className="w-3 h-3" />
                  <span>Connect GitHub</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Unified Engine Status Bar */}
        <div className="min-h-[64px] rounded-xl bg-white/[0.02] border border-white/5 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          {/* Left Section: Active Engine */}
          <div className="space-y-1 min-w-0 flex-1 max-w-full">
            <div className="flex items-center space-x-2.5 min-w-0">
              {/* Bound Dot + Truncated Title */}
              <div className="flex items-center space-x-2 min-w-0 shrink">
                <span className={`w-2 h-2 rounded-full shrink-0 ${activeRuntime?.isValid ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span
                  className="text-sm font-semibold text-white truncate"
                  title={activeRuntime?.name || 'Bundled Stable (v0.1.4)'}
                >
                  {activeRuntime?.name || 'Bundled Stable (v0.1.4)'}
                </span>
              </div>

              {/* Version & Verification Badges */}
              <div className="flex items-center space-x-2 shrink-0">
                <span className="font-mono text-[10px] text-neutral-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                  {activeRuntime?.commitHash?.substring(0, 7) || activeRuntime?.type || 'baseline'}
                </span>
                {activeRuntime?.isValid ? (
                  <span className="text-[11px] text-emerald-400/90 font-mono inline-flex items-center space-x-1 whitespace-nowrap">
                    <CheckCircle2 className="w-3 h-3 inline shrink-0" />
                    <span>verified</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-400 font-mono whitespace-nowrap">missing binaries</span>
                )}
              </div>
            </div>

            <div className="text-[11px] font-mono text-neutral-500 truncate" title={activeRuntime?.relinkerPath}>
              {activeRuntime?.relinkerPath || 'Default bundled relinker'}
            </div>
          </div>

          {/* Divider */}
          <div className="hidden md:block h-8 w-px bg-white/10 shrink-0" />

          {/* Right Section: Upstream Status & Actions */}
          <div className="flex items-center space-x-3 shrink-0 flex-wrap gap-y-2">
            {loadingComparison && !comparison ? (
              <div className="flex items-center space-x-2 text-xs text-neutral-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                <span>Checking upstream...</span>
              </div>
            ) : comparison ? (
              !comparison.isUpToDate && comparison.aheadBy > 0 ? (
                <div className="text-left md:text-right">
                  <div className="text-xs font-medium text-blue-300">
                    Upstream is {comparison.aheadBy.toLocaleString()} commits ahead <span className="font-mono text-[11px] text-neutral-400">({comparison.headShortSha})</span>
                  </div>
                  <div className="text-[10px] text-neutral-500 truncate max-w-xs" title={comparison.headCommitMessage}>
                    {comparison.headCommitMessage}
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-xs text-neutral-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Up to date with main <span className="font-mono text-[11px] text-neutral-400">({comparison.headShortSha})</span></span>
                </div>
              )
            ) : null}

            {!comparison?.isUpToDate && (comparison?.aheadBy ?? 0) > 0 && (
              <button
                onClick={() => {
                  audioService.playNavTick();
                  setActiveTab('custom');
                }}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white font-medium text-xs transition-all shadow-sm whitespace-nowrap active:scale-95"
              >
                <Hammer className="w-3.5 h-3.5" />
                <span>Open Local Builder</span>
              </button>
            )}

            {activeGlobalId !== 'bundled' && (
              <button
                onClick={() => handleSetActiveGlobal('bundled')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white font-medium text-xs border border-white/10 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Bundled Stable</span>
              </button>
            )}

            <button
              onClick={() => {
                audioService.playNavTick();
                loadComparison();
                loadCommits(1, false);
              }}
              disabled={loadingComparison || loadingCommits}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white border border-white/10 transition-colors disabled:opacity-50"
              title="Check for updates"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingComparison || loadingCommits ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex items-center space-x-1 border-b border-white/5 pb-2">
          <button
            onClick={() => {
              audioService.playNavTick();
              setActiveTab('custom');
            }}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'custom'
                ? 'bg-white/10 text-white font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03]'
            }`}
          >
            <Hammer className="w-3.5 h-3.5" />
            <span>Local Builder & Dev Studio</span>
          </button>

          <button
            onClick={() => {
              audioService.playNavTick();
              setActiveTab('installed');
            }}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'installed'
                ? 'bg-white/10 text-white font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Installed Profiles ({resolvedRuntimes.length})</span>
          </button>

          <button
            onClick={() => {
              audioService.playNavTick();
              setActiveTab('upstream');
            }}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'upstream'
                ? 'bg-white/10 text-white font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03]'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>Changelog / History ({commits.length}{hasMoreCommits ? '+' : ''})</span>
          </button>
        </div>

        {/* Tab 1: Local Builder & Dev Studio */}
        {activeTab === 'custom' && (
          <LocalBuilder
            onRuntimeRegistered={() => {
              loadRuntimes();
              loadComparison();
            }}
            onNotification={showNotification}
          />
        )}

        {/* Tab 2: Installed Profiles Table */}
        {activeTab === 'installed' && (
          <div className="space-y-3">
            {resolvedRuntimes.map((r) => {
              const isActive = activeGlobalId === r.id;
              return (
                <div
                  key={r.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-blue-950/20 border-blue-500/40 ring-1 ring-blue-500/30'
                      : 'bg-white/5 border-white/10'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2.5">
                        <span className="text-white font-semibold text-sm">{r.name}</span>
                        <span className={`px-2 py-0.5 rounded-md font-mono text-[9px] uppercase font-semibold ${
                          r.type === 'bundled'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : r.type === 'custom'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                        }`}>
                          {r.type}
                        </span>
                        {isActive && (
                          <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 font-mono text-[9px] font-semibold">
                            Active Global
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-neutral-400 font-mono space-y-0.5 pt-1">
                        <div>relinker: <span className="text-neutral-300">{r.relinkerPath}</span></div>
                        <div>libs: <span className="text-neutral-300">{r.libsPath}</span></div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {!isActive && (
                        <button
                          onClick={() => handleSetActiveGlobal(r.id)}
                          className="px-3.5 py-1.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
                        >
                          Set Global Active
                        </button>
                      )}
                      {r.isRemovable && (
                        <button
                          onClick={() => handleRemoveRuntime(r.id)}
                          className="p-2 rounded-xl text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Remove runtime profile"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}


        {/* Tab 3: Upstream Changelog / History */}
        {activeTab === 'upstream' && (
          <div className="space-y-4">
            {/* Informational Callout: Changelog & Bisect History */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-start space-x-3.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <History className="w-4 h-4" />
              </div>
              <div className="text-xs space-y-1">
                <div className="font-semibold text-white">Upstream Changelog</div>
                <p className="text-neutral-400 leading-relaxed">
                  Recent commits merged into upstream <code className="text-neutral-300 font-mono">boykopovar/AnyPS5</code>.
                  Inspect diffs to view code changes on GitHub, or switch to the Local Builder tab to compile upstream changes directly on your machine.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  placeholder="Filter commits by SHA, message, or author..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white/30"
                />
              </div>

              <button
                onClick={() => {
                  audioService.playNavTick();
                  loadComparison();
                  loadCommits(1, false);
                }}
                disabled={loadingCommits || loadingComparison}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium border border-white/10 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingCommits || loadingComparison ? 'animate-spin' : ''}`} />
                <span>Refresh Commits</span>
              </button>
            </div>

            {loadingCommits && commits.length === 0 ? (
              <div className="flex items-center justify-center p-12 text-neutral-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span>Fetching recent commits from boykopovar/AnyPS5...</span>
              </div>
            ) : filteredCommits.length === 0 ? (
              <div className="p-8 text-center text-neutral-400 text-xs bg-white/5 rounded-2xl border border-white/10">
                No commits found matching query.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCommits.map((c) => {
                  const runtimeId = `commit-${c.shortSha}`;
                  const isInstalled = manifest?.runtimes.some((r) => r.id === runtimeId || (r.commitHash && r.commitHash.startsWith(c.shortSha)));
                  const isActive = activeGlobalId === runtimeId;

                  return (
                    <div
                      key={c.sha}
                      className={`flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${
                        isActive
                          ? 'bg-blue-950/20 border-blue-500/40 ring-1 ring-blue-500/30'
                          : isInstalled
                          ? 'bg-white/5 border-white/15 hover:border-white/25'
                          : 'bg-neutral-900/30 border-white/5 hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-start space-x-3 min-w-0">
                        <div className={`mt-0.5 w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                          isActive
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                            : isInstalled
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-white/5 text-neutral-400'
                        }`}>
                          <GitCommit className="w-3.5 h-3.5" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            <span className="font-mono text-xs font-semibold text-blue-300">
                              {c.shortSha}
                            </span>
                            <span className="text-white text-xs font-medium truncate max-w-md">
                              {c.message}
                            </span>
                            {isActive && (
                              <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono text-[9px] font-semibold">
                                Active Core
                              </span>
                            )}
                            {isInstalled && !isActive && (
                              <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[9px]">
                                Installed
                              </span>
                            )}
                          </div>

                          <div className="flex items-center space-x-3 text-[11px] text-neutral-400 pt-1">
                            <span>by {c.author}</span>
                            <span>•</span>
                            <span>{new Date(c.date).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0 self-end md:self-center">
                        <a
                          href={c.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white text-xs font-medium border border-white/10 transition-colors"
                          title="View commit on GitHub"
                        >
                          <span>Inspect diff</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>

                        {isInstalled && (
                          <>
                            {!isActive && (
                              <button
                                onClick={() => handleSetActiveGlobal(runtimeId)}
                                className="px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-500/30 text-xs font-semibold transition-colors"
                              >
                                Activate Global
                              </button>
                            )}
                            {!isActive && (
                              <button
                                onClick={() => handleRemoveRuntime(runtimeId)}
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                title="Delete commit runtime files"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Pagination: Load More Commits */}
                {hasMoreCommits && (
                  <div className="pt-4 flex justify-center pb-2">
                    <button
                      onClick={() => {
                        audioService.playNavTick();
                        loadCommits(commitsPage + 1, true);
                      }}
                      disabled={loadingMoreCommits}
                      className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold border border-white/15 transition-all shadow-md active:scale-95 disabled:opacity-50"
                    >
                      {loadingMoreCommits ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5 text-blue-400" />
                          <span>Loading Older Commits...</span>
                        </>
                      ) : (
                        <>
                          <History className="w-3.5 h-3.5 mr-1 text-neutral-300" />
                          <span>Load More Commits from History</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* GitHub Authentication Modal (RFC 8628 Device Flow) */}
      {isAuthModalOpen && (
        <div data-nav-scope className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#080b11] border border-white/10 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-2 text-white font-semibold text-sm">
                <Key className="w-4 h-4 text-blue-400" />
                <span>Connect GitHub Account</span>
              </div>
              <button
                onClick={() => {
                  stopPolling();
                  setIsAuthModalOpen(false);
                }}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-neutral-400 leading-relaxed">
                Connect your GitHub account using the official AnyPS5 Studio OAuth device flow. Authorizes read-only access to download pre-compiled upstream CI artifacts and unlocks 5,000 req/hr. Encrypted on your machine using Windows DPAPI.
              </p>

              {devicePollError && (
                <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs">
                  {devicePollError}
                </div>
              )}

              {deviceCodeData ? (
                <div className="space-y-4 text-center">
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                    <div className="text-[11px] text-neutral-400">Your GitHub Device Authorization Code:</div>
                    <div className="font-mono text-2xl font-bold tracking-widest text-blue-300">
                      {deviceCodeData.user_code}
                    </div>
                  </div>

                  <button
                    onClick={handleCopyCodeAndOpenBrowser}
                    className="w-full flex items-center justify-center space-x-2 py-3 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-all shadow-lg active:scale-95"
                  >
                    {isCodeCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    <span>{isCodeCopied ? 'Code Copied! Opening Browser...' : 'Copy Code & Authorize on GitHub'}</span>
                  </button>

                  <div className="flex items-center justify-center space-x-2 text-xs text-neutral-400 pt-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span>Waiting for authorization at github.com/login/device...</span>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleManualVerify}
                      disabled={isVerifyingAuth}
                      className="inline-flex items-center justify-center space-x-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50 py-1"
                    >
                      {isVerifyingAuth ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                          <span>Checking authorization...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" />
                          <span className="underline decoration-white/20 underline-offset-4 hover:decoration-white/50">Already authorized? Complete login manually</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center p-8 text-xs text-neutral-400">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  <span>Requesting authorization code from GitHub...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
