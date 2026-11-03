import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  GitPullRequest,
  GitMerge,
  Check,
  Hammer,
  Trash2,
  ExternalLink,
  RefreshCw,
  Search,
  X,
  AlertCircle,
  Square,
  CheckSquare,
  ChevronRight,
  Terminal,
  Loader2,
  SlidersHorizontal,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { CommunityPR, PRBuildDownloadProgress, MergedBuildInfo, BuilderLogMessage } from '../types';
import { apiBridge } from '../services/apiBridge';
import { audioService } from '../services/audioService';

interface CommunityPRBuildsProps {
  initialSearch?: string;
  onClearInitialSearch?: () => void;
  onNavigateToGames?: () => void;
  onNavigateToRelinker?: () => void;
}

export const CommunityPRBuilds: React.FC<CommunityPRBuildsProps> = ({
  initialSearch = '',
  onClearInitialSearch,
  onNavigateToRelinker,
}) => {
  const [prs, setPrs] = useState<CommunityPR[]>([]);
  const [mergedBuilds, setMergedBuilds] = useState<MergedBuildInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [filter, setFilter] = useState<'all' | 'open' | 'installed' | 'merged-builds'>('all');
  const [selectedRepo, setSelectedRepo] = useState<string>('boykopovar/AnyPS5');
  const [downloading, setDownloading] = useState<Record<number, PRBuildDownloadProgress>>({});
  const [activePRNumber, setActivePRNumber] = useState<number | null>(null);
  const [activeMergedId, setActiveMergedId] = useState<string | null>(null);
  const [selectedPRDetail, setSelectedPRDetail] = useState<CommunityPR | null>(null);

  // Active build & live compiler logs state
  const [buildingPR, setBuildingPR] = useState<number | null>(null);
  const [showConsole, setShowConsole] = useState<boolean>(false);
  const [logs, setLogs] = useState<BuilderLogMessage[]>([]);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const terminalBottomRef = useRef<HTMLDivElement>(null);

  // PR Lookup Form
  const [customPRNumber, setCustomPRNumber] = useState<string>('');
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);

  // Multi-PR Selection & Merge
  const [selectedPRNumbers, setSelectedPRNumbers] = useState<Set<number>>(new Set());
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [mergeProgress, setMergeProgress] = useState<number>(0);
  const [mergeStatusText, setMergeStatusText] = useState<string>('');
  const [mergeError, setMergeError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSearch) {
      setSearchQuery(initialSearch);
    }
  }, [initialSearch]);

  const loadData = async (forceRefresh?: boolean, repoToFetch?: string) => {
    setLoading(true);
    const targetRepo = repoToFetch || selectedRepo;
    try {
      const [prData, mergedData] = await Promise.all([
        apiBridge.getCommunityPRs(targetRepo, forceRefresh),
        apiBridge.getMergedBuilds(),
      ]);
      setPrs(prData);
      setMergedBuilds(mergedData);

      const activePR = prData.find((p) => p.isActive);
      const activeMerged = mergedData.find((m) => m.isActive);

      setActivePRNumber(activePR ? activePR.number : null);
      setActiveMergedId(activeMerged ? activeMerged.id : null);

      if (selectedPRDetail) {
        const refreshedSelected = prData.find((p) => p.number === selectedPRDetail.number);
        if (refreshedSelected) setSelectedPRDetail(refreshedSelected);
      }
    } catch (err) {
      console.error('Failed to load community PRs and merged builds:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRepoChange = (repo: string) => {
    if (repo !== selectedRepo) {
      audioService.playNavTick();
      setSelectedRepo(repo);
      setSelectedPRDetail(null);
      loadData(false, repo);
    }
  };

  useEffect(() => {
    loadData();

    // Check active build status for console and button rehydration
    apiBridge.getActiveBuild().then((active) => {
      if (active.isBuilding && active.buildingPR) {
        setBuildingPR(active.buildingPR);
        setShowConsole(true);
        if (active.recentLogs && active.recentLogs.length > 0) {
          setLogs(active.recentLogs);
        }
      }
    }).catch(() => {});

    // Subscribe to progress updates
    const unsubProgress = apiBridge.onPRDownloadProgress((prog) => {
      setDownloading((prev) => ({
        ...prev,
        [prog.prNumber]: prog,
      }));

      if (prog.status === 'ready') {
        audioService.playConfirm();
        setBuildingPR(null);
        loadData();
      } else if (prog.status === 'error') {
        setBuildingPR(null);
      }
    });

    // Subscribe to real-time build logs from LocalBuilder
    const unsubLogs = apiBridge.onBuilderLog((logMsg) => {
      setLogs((prev) => [...prev, logMsg]);
    });

    return () => {
      unsubProgress();
      unsubLogs();
    };
  }, []);

  // Auto-scroll terminal console
  useEffect(() => {
    if (autoScroll && terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredPRs = useMemo(() => {
    return prs.filter((pr) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        pr.title.toLowerCase().includes(q) ||
        pr.number.toString().includes(q) ||
        pr.author.login.toLowerCase().includes(q) ||
        pr.body.toLowerCase().includes(q) ||
        pr.labels.some((l) => l.name.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (filter === 'installed') return pr.isInstalled;
      if (filter === 'open') return pr.state === 'open';
      return true;
    });
  }, [prs, searchQuery, filter]);

  const toggleSelectPR = (num: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    audioService.playNavTick();
    setSelectedPRNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(num)) {
        next.delete(num);
      } else {
        next.add(num);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    audioService.playNavTick();
    const allFilteredNums = filteredPRs.map((p) => p.number);
    const allSelected = allFilteredNums.every((num) => selectedPRNumbers.has(num));

    if (allSelected) {
      setSelectedPRNumbers((prev) => {
        const next = new Set(prev);
        allFilteredNums.forEach((num) => next.delete(num));
        return next;
      });
    } else {
      setSelectedPRNumbers((prev) => {
        const next = new Set(prev);
        allFilteredNums.forEach((num) => next.add(num));
        return next;
      });
    }
  };

  const handleBuildPR = async (pr: CommunityPR, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (buildingPR !== null) return;

    audioService.playNavTick();
    setBuildingPR(pr.number);
    setShowConsole(true);
    setLogs([]);

    setDownloading((prev) => ({
      ...prev,
      [pr.number]: {
        prNumber: pr.number,
        status: 'configuring',
        progress: 5,
        message: 'Initializing build environment...',
      },
    }));

    try {
      const res = await apiBridge.buildPR(pr.number, pr.headSha, pr.title);
      if (res.success || res.cancelled) {
        if (res.success) audioService.playConfirm();
        setDownloading((prev) => {
          const next = { ...prev };
          delete next[pr.number];
          return next;
        });
        await loadData();
      } else {
        setDownloading((prev) => ({
          ...prev,
          [pr.number]: {
            prNumber: pr.number,
            status: 'error',
            progress: 0,
            error: res.error || 'Build process failed.',
          },
        }));
      }
    } catch (err: any) {
      setDownloading((prev) => ({
        ...prev,
        [pr.number]: {
          prNumber: pr.number,
          status: 'error',
          progress: 0,
          error: err?.message || 'Compilation failed.',
        },
      }));
    } finally {
      setBuildingPR(null);
      await loadData();
    }
  };

  const handleCancelBuild = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    audioService.playNavTick();
    await apiBridge.cancelBuild();
    setBuildingPR(null);
    if (buildingPR) {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[buildingPR];
        return next;
      });
    }
  };

  const handleActivatePR = async (prNumber: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    audioService.playConfirm();
    const success = await apiBridge.setActivePRBuild(prNumber);
    if (success) {
      setActivePRNumber(prNumber);
      setActiveMergedId(null);
      setSelectedPRDetail((prev) =>
        prev && prev.number === prNumber
          ? { ...prev, isActive: true }
          : prev
          ? { ...prev, isActive: false }
          : prev
      );
      await loadData();
    }
  };

  const handleActivateMerged = async (buildId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    audioService.playConfirm();
    const success = await apiBridge.setActiveMergedBuild(buildId);
    if (success) {
      setActiveMergedId(buildId);
      setActivePRNumber(null);
      setSelectedPRDetail((prev) => (prev ? { ...prev, isActive: false } : prev));
      await loadData();
    }
  };

  const handleRevert = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    audioService.playConfirm();
    const success = await apiBridge.revertToDefaultBuild();
    if (success) {
      setActivePRNumber(null);
      setActiveMergedId(null);
      setSelectedPRDetail((prev) => (prev ? { ...prev, isActive: false } : prev));
      await loadData();
    }
  };

  const handleDeletePR = async (prNumber: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    audioService.playNavTick();
    const success = await apiBridge.deletePRBuild(prNumber);
    if (success) {
      if (activePRNumber === prNumber) setActivePRNumber(null);
      setSelectedPRDetail((prev) =>
        prev && prev.number === prNumber ? { ...prev, isInstalled: false, isActive: false } : prev
      );
      setSelectedPRNumbers((prev) => {
        if (prev.has(prNumber)) {
          const next = new Set(prev);
          next.delete(prNumber);
          return next;
        }
        return prev;
      });
      await loadData();
    }
  };

  const handleDeleteMerged = async (buildId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    audioService.playNavTick();
    const success = await apiBridge.deleteMergedBuild(buildId);
    if (success) {
      if (activeMergedId === buildId) setActiveMergedId(null);
      await loadData();
    }
  };

  const handleMergeAndBuild = async () => {
    const numbers = Array.from(selectedPRNumbers);
    if (numbers.length === 0) return;

    audioService.playConfirm();
    setIsMerging(true);
    setMergeError(null);
    setMergeProgress(15);
    setMergeStatusText(`Staging ${numbers.length} PR branches into combined workspace...`);
    setShowConsole(true);
    setLogs([]);

    try {
      setMergeProgress(35);
      setMergeStatusText(`Merging PRs #${numbers.join(', #')} sequentially...`);
      const res = await apiBridge.mergeAndBuildPRs(numbers);

      if (res.success && res.buildId) {
        setMergeProgress(100);
        setMergeStatusText('Combined build successfully compiled!');
        audioService.playConfirm();
        setSelectedPRNumbers(new Set());
        await loadData();
        await handleActivateMerged(res.buildId);
      } else if (!res.cancelled) {
        setMergeError(res.error || res.conflict || 'Merge or compilation failed.');
      }
    } catch (err: any) {
      setMergeError(err?.message || 'Merge process failed.');
    } finally {
      setIsMerging(false);
    }
  };

  const handleLookupCustomPR = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(customPRNumber.replace(/[^0-9]/g, ''), 10);
    if (!num) return;

    audioService.playNavTick();
    setIsLookingUp(true);
    setLookupMessage(null);

    try {
      const res = await fetch(`https://api.github.com/repos/${selectedRepo}/pulls/${num}`, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });

      if (res.ok) {
        const item = await res.json();
        const customPR: CommunityPR = {
          id: item.id,
          number: item.number,
          title: item.title,
          author: {
            login: item.user?.login || 'contributor',
            avatar_url: item.user?.avatar_url || '',
            html_url: item.user?.html_url || '',
          },
          html_url: item.html_url,
          state: item.state,
          created_at: item.created_at,
          updated_at: item.updated_at,
          body: item.body || '',
          headSha: item.head?.sha?.substring(0, 7) || 'HEAD',
          headBranch: item.head?.ref || 'main',
          labels: (item.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
          artifactAvailable: false,
          isInstalled: false,
          isActive: false,
        };

        setPrs((prev) => {
          if (prev.some((p) => p.number === customPR.number)) return prev;
          return [customPR, ...prev];
        });
        setSelectedPRDetail(customPR);
        setLookupMessage(`Loaded PR #${num}: ${customPR.title}`);
        setCustomPRNumber('');
      } else {
        setLookupMessage(`Pull Request #${num} was not found on ${selectedRepo} (HTTP ${res.status}).`);
      }
    } catch {
      setLookupMessage(`Could not connect to GitHub API for PR #${num}.`);
    } finally {
      setIsLookingUp(false);
    }
  };

  const activePR = prs.find((p) => p.isActive);
  const activeMerged = mergedBuilds.find((m) => m.isActive);
  const installedCount = prs.filter((p) => p.isInstalled).length;

  return (
    <div className="relative w-full h-full flex flex-col pt-20 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 pb-8 overflow-hidden select-none bg-[#07090e] text-white">
      {/* Top Section: Breadcrumb & Title with Active Runtime Status */}
      <div className="w-full flex flex-col md:flex-row md:items-end justify-between pb-4 border-b border-white/5 gap-4">
        <div>
          <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1">
            System Software / Community Experiments
          </span>
          <div className="flex items-center space-x-3">
            <h2 className="text-2xl font-bold text-white tracking-tight">Community PR Builds</h2>
            <span className="text-xs font-mono text-neutral-500">•</span>
            <span className="text-xs font-mono text-neutral-400">
              {filter === 'merged-builds'
                ? `${mergedBuilds.length} combined build${mergedBuilds.length === 1 ? '' : 's'} created`
                : `${filteredPRs.length} pull request${filteredPRs.length === 1 ? '' : 's'} available`}
            </span>
          </div>
        </div>

        {/* Minimalist Active Runtime Status & Action Controls */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                activeMerged || activePR ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'
              }`}
            />
            <span className="text-neutral-400">Active:</span>
            <span className="text-white font-medium truncate max-w-[200px]">
              {activeMerged
                ? activeMerged.name
                : activePR
                ? `PR #${activePR.number} (${activePR.headBranch})`
                : 'Official Bundled Stable'}
            </span>

            {(activePR || activeMerged) && (
              <button
                type="button"
                onClick={handleRevert}
                className="ml-2 text-xs text-neutral-400 hover:text-white underline underline-offset-2 transition-colors font-sans"
              >
                Revert to Default
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowConsole(!showConsole)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors flex items-center space-x-1.5 ${
              showConsole
                ? 'bg-white/15 text-white border-white/30'
                : 'bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white border-white/10'
            }`}
            title="Toggle Live Compiler Console"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Console</span>
            {buildingPR && <Loader2 className="w-3 h-3 animate-spin text-amber-400 ml-1" />}
          </button>

          <button
            type="button"
            onClick={() => {
              audioService.playNavTick();
              loadData(true);
            }}
            disabled={loading}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white text-xs border border-white/10 transition-colors"
            title="Refresh from GitHub"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Lookup Alert Banner */}
      {lookupMessage && (
        <div className="mt-3 px-4 py-2 rounded-lg bg-neutral-900 border border-white/10 text-xs text-neutral-300 flex items-center justify-between">
          <span>{lookupMessage}</span>
          <button
            type="button"
            onClick={() => setLookupMessage(null)}
            className="text-neutral-500 hover:text-white text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Toolbar: Repository Source Switcher, Search Input, Direct PR Query, Filter Tabs */}
      <div className="w-full flex flex-wrap items-center justify-between gap-3 py-3 border-b border-white/5">
        {/* Left: Search input & Direct PR Query */}
        <div className="flex items-center space-x-2 flex-1 min-w-[280px] max-w-lg">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, PR #, author, symbol..."
              className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs focus:outline-none focus:border-white/30 transition-all placeholder:text-neutral-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  onClearInitialSearch?.();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <form onSubmit={handleLookupCustomPR} className="flex items-center space-x-1">
            <input
              type="text"
              value={customPRNumber}
              onChange={(e) => setCustomPRNumber(e.target.value)}
              placeholder="PR #"
              className="w-16 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-white/30 transition-all placeholder:text-neutral-500"
            />
            <button
              type="submit"
              disabled={isLookingUp || !customPRNumber.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-neutral-300 hover:text-white text-xs font-medium border border-white/10 transition-colors"
            >
              {isLookingUp ? '...' : 'Go'}
            </button>
          </form>
        </div>

        {/* Right: Repository Source & Filter Tabs */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Source Toggle */}
          <div className="flex items-center bg-black/60 p-0.5 rounded-lg border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => handleRepoChange('boykopovar/AnyPS5')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                selectedRepo === 'boykopovar/AnyPS5'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Upstream Core
            </button>
            <button
              type="button"
              onClick={() => handleRepoChange('ramsforge/AnyPS5-Studio')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                selectedRepo === 'ramsforge/AnyPS5-Studio'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Studio UI
            </button>
          </div>

          {/* View Filter Tabs */}
          <div className="flex items-center space-x-1 bg-white/[0.02] p-0.5 rounded-lg border border-white/10">
            {(['all', 'open', 'installed', 'merged-builds'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  audioService.playNavTick();
                  setFilter(tab);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-all ${
                  filter === tab
                    ? 'bg-white/15 text-white font-semibold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {tab === 'installed'
                  ? `Built (${installedCount})`
                  : tab === 'merged-builds'
                  ? `Combined (${mergedBuilds.length})`
                  : tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area: Master List + Context Inspector Pane */}
      <div className="flex-1 flex overflow-hidden pt-3 gap-6">
        {/* Left Column: Dense, Structured PR List Table */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Table Header Row */}
          {filter === 'merged-builds' ? (
            <div className="flex items-center justify-between px-4 py-1.5 text-[11px] font-mono text-neutral-500 border-b border-white/5 uppercase tracking-wider">
              <span>Combined Hybrid Build & Merged Pull Requests</span>
              <span className="w-32 text-right pr-2">Actions</span>
            </div>
          ) : (
            <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-mono text-neutral-500 border-b border-white/5 uppercase tracking-wider">
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="hover:text-white transition-colors"
                  title="Select all filtered for multi-PR build"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
                <span>Pull Request</span>
              </div>
              <div className="flex items-center pr-2 space-x-2 sm:space-x-4">
                <span className="w-24 sm:w-36 text-right pr-2 sm:pr-8">Status</span>
                <span className="min-w-[90px] sm:min-w-[120px] text-right">Actions</span>
              </div>
            </div>
          )}

          {/* Scrollable Rows */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {/* VIEW 1: COMBINED BUILDS TAB */}
            {filter === 'merged-builds' ? (
              mergedBuilds.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center space-y-2 text-center">
                  <GitMerge className="w-8 h-8 text-neutral-600 mb-1" />
                  <p className="text-sm font-semibold text-neutral-300">No Combined Multi-PR Builds Created Yet</p>
                  <p className="text-xs text-neutral-500 max-w-sm">
                    Switch to the All tab, check two or more PRs using the selection boxes, and click Merge & Build Combined Binary.
                  </p>
                </div>
              ) : (
                mergedBuilds.map((mb) => (
                  <div
                    key={mb.id}
                    className={`p-4 flex items-center justify-between transition-colors ${
                      mb.isActive ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-neutral-800 text-neutral-300 border border-white/10">
                          HYBRID
                        </span>
                        <h4 className="text-sm font-semibold text-white tracking-wide">{mb.name}</h4>
                        {mb.isActive && (
                          <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider font-semibold">
                            [Active Runtime]
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400">
                        Merged pull requests: #{mb.prNumbers.join(', #')}
                      </p>
                      <p className="text-[11px] font-mono text-neutral-600">
                        Path: {mb.relinkerPath}
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      {mb.isActive ? (
                        <>
                          <button
                            type="button"
                            onClick={handleRevert}
                            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
                          >
                            Deactivate
                          </button>
                          {onNavigateToRelinker && (
                            <button
                              type="button"
                              onClick={() => {
                                audioService.playNavTick();
                                onNavigateToRelinker();
                              }}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium border border-emerald-500/20 transition-colors"
                            >
                              Open in Relinker
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => handleActivateMerged(mb.id, e)}
                          className="px-3 py-1.5 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-semibold transition-all shadow-sm"
                        >
                          Build
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteMerged(mb.id, e)}
                        className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-rose-400 transition-colors"
                        title="Delete hybrid build"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )
            ) : (
              /* VIEW 2: INDIVIDUAL PRS DENSE LIST */
              loading && prs.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center space-y-3">
                  <RefreshCw className="w-5 h-5 text-neutral-500 animate-spin" />
                  <p className="text-xs text-neutral-400 font-mono">Querying GitHub pull requests...</p>
                </div>
              ) : filteredPRs.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center space-y-2 text-center">
                  <GitPullRequest className="w-8 h-8 text-neutral-600 mb-1" />
                  <p className="text-sm font-semibold text-neutral-300">
                    {selectedRepo === 'ramsforge/AnyPS5-Studio' && !searchQuery
                      ? 'No Open Pull Requests in Studio UI'
                      : 'No matching pull requests found'}
                  </p>
                  <p className="text-xs text-neutral-500 max-w-sm">
                    {selectedRepo === 'ramsforge/AnyPS5-Studio' && !searchQuery
                      ? 'There are currently no active pull requests in ramsforge/AnyPS5-Studio. Switch to Upstream Core to view game compatibility patches.'
                      : 'Try adjusting your search query, or enter a specific PR number in the box above.'}
                  </p>
                </div>
              ) : (
                filteredPRs.map((pr) => {
                  const isInstalled = pr.isInstalled;
                  const isActive = pr.isActive;
                  const isSelectedForMerge = selectedPRNumbers.has(pr.number);
                  const isInspected = selectedPRDetail?.number === pr.number;
                  const isCompiling = buildingPR === pr.number;
                  const progressObj = downloading[pr.number];

                  return (
                    <div
                      key={pr.number}
                      onClick={() => setSelectedPRDetail(pr)}
                      className={`group flex items-center justify-between px-3 py-2.5 transition-colors cursor-pointer ${
                        isInspected
                          ? 'bg-white/[0.06] border-l-2 border-white'
                          : isActive
                          ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                          : isSelectedForMerge
                          ? 'bg-neutral-800/40 hover:bg-neutral-800/60'
                          : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      {/* Left: Checkbox + PR Number + Title & Labels */}
                      <div className="flex items-center space-x-3 min-w-0 flex-1 mr-4">
                        <button
                          type="button"
                          onClick={(e) => toggleSelectPR(pr.number, e)}
                          className="text-neutral-500 hover:text-white transition-colors shrink-0"
                          title={isSelectedForMerge ? 'Remove from multi-merge' : 'Select for multi-merge'}
                        >
                          {isSelectedForMerge ? (
                            <CheckSquare className="w-4 h-4 text-white" />
                          ) : (
                            <Square className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400" />
                          )}
                        </button>

                        <span className="text-xs font-mono text-neutral-400 shrink-0 w-12">
                          #{pr.number}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2 truncate">
                            <span className="text-xs font-semibold text-white truncate group-hover:text-neutral-200">
                              {pr.title}
                            </span>

                            {isActive && (
                              <span className="shrink-0 px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                ACTIVE
                              </span>
                            )}
                          </div>

                          <div className="flex items-center space-x-2 mt-0.5 text-[11px] text-neutral-500 font-mono">
                            <span>{pr.author.login}</span>
                            <span>•</span>
                            <span className="truncate">{pr.headBranch}</span>
                            {pr.labels.length > 0 && (
                              <>
                                <span>•</span>
                                <div className="flex items-center space-x-1 truncate">
                                  {pr.labels.slice(0, 3).map((l) => (
                                    <span
                                      key={l.name}
                                      className="px-1.5 py-0.2 rounded text-[10px] font-sans font-medium text-neutral-400 bg-white/[0.04]"
                                    >
                                      {l.name}
                                    </span>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Status column + Actions */}
                      <div className="flex items-center shrink-0 pr-2 space-x-2 sm:space-x-4">
                        {/* Status Column */}
                        <div className="w-24 sm:w-36 text-right pr-2 sm:pr-8 flex justify-end items-center">
                          {isCompiling ? (
                            <span className="text-amber-400 font-mono text-[11px] flex items-center space-x-1.5 whitespace-nowrap">
                              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                              <span className="hidden sm:inline">Compiling</span>
                              <span>({progressObj?.progress || 0}%)</span>
                            </span>
                          ) : isActive ? (
                            <span className="text-emerald-400 font-mono text-[11px] font-semibold flex items-center space-x-1 whitespace-nowrap">
                              <Check className="w-3 h-3 shrink-0" />
                              <span>Active</span>
                            </span>
                          ) : isInstalled ? (
                            <span className="text-neutral-300 font-mono text-[11px] whitespace-nowrap">
                              Ready
                            </span>
                          ) : (
                            <span className="text-neutral-500 font-mono text-[11px] whitespace-nowrap">
                              Not Built
                            </span>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div
                          className="flex items-center space-x-1 sm:space-x-1.5 min-w-[90px] sm:min-w-[120px] justify-end shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isCompiling ? (
                            <button
                              type="button"
                              onClick={handleCancelBuild}
                              className="px-2 sm:px-2.5 py-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs font-medium border border-rose-500/20 transition-colors whitespace-nowrap"
                            >
                              Cancel
                            </button>
                          ) : isInstalled ? (
                            <>
                              {isActive ? (
                                <button
                                  type="button"
                                  onClick={handleRevert}
                                  disabled={buildingPR !== null}
                                  className={`px-2 sm:px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                                    buildingPR !== null
                                      ? 'bg-white/5 text-neutral-500 cursor-not-allowed opacity-40'
                                      : 'bg-white/10 hover:bg-white/15 text-neutral-300 hover:text-white cursor-pointer'
                                  }`}
                                  title={
                                    buildingPR !== null
                                      ? `Build in progress (PR #${buildingPR})`
                                      : 'Revert to official default relinker'
                                  }
                                >
                                  Revert
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => handleActivatePR(pr.number, e)}
                                  disabled={buildingPR !== null}
                                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-all shadow-sm whitespace-nowrap ${
                                    buildingPR !== null
                                      ? 'bg-white/10 text-neutral-500 cursor-not-allowed opacity-40'
                                      : 'bg-white text-black hover:bg-neutral-200 cursor-pointer'
                                  }`}
                                  title={
                                    buildingPR !== null
                                      ? `Build in progress (PR #${buildingPR})`
                                      : 'Activate this build as current relinker'
                                  }
                                >
                                  Build
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={(e) => handleDeletePR(pr.number, e)}
                                disabled={buildingPR !== null}
                                className={`p-1 sm:p-1.5 rounded transition-colors shrink-0 ${
                                  buildingPR !== null
                                    ? 'text-neutral-600 cursor-not-allowed opacity-40'
                                    : 'text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer'
                                }`}
                                title="Delete compiled build from disk"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => handleBuildPR(pr, e)}
                              disabled={buildingPR !== null}
                              className={`px-2 sm:px-2.5 py-1 rounded text-xs font-medium border transition-colors flex items-center space-x-1 sm:space-x-1.5 whitespace-nowrap ${
                                buildingPR === pr.number
                                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300 cursor-not-allowed shadow-sm'
                                  : buildingPR !== null
                                  ? 'bg-white/5 border-white/5 text-neutral-500 cursor-not-allowed opacity-40'
                                  : 'bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white border-white/10 cursor-pointer'
                              }`}
                              title={
                                buildingPR === pr.number
                                  ? `Compiling PR #${pr.number}...`
                                  : buildingPR !== null
                                  ? `Build in progress (PR #${buildingPR})`
                                  : 'Compile this PR locally using CMake + Ninja'
                              }
                            >
                              {buildingPR === pr.number ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
                                  <span>Compiling...</span>
                                </>
                              ) : (
                                <>
                                  <Hammer className="w-3 h-3 text-neutral-400 shrink-0" />
                                  <span className="hidden sm:inline">Build PR</span>
                                  <span className="sm:hidden">Build</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              apiBridge.openExternal(pr.html_url);
                            }}
                            className="p-1 rounded text-neutral-500 hover:text-white hover:bg-white/5 transition-colors focus:outline-none"
                            title="Open on GitHub in browser"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            )}
          </div>
        </div>

        {/* Right Column: Contextual PR Inspector Drawer */}
        {selectedPRDetail && (
          <div className="w-80 lg:w-96 shrink-0 flex flex-col h-full bg-[#0b0e14] border border-white/10 rounded-xl p-4 overflow-y-auto animate-fade-in text-xs space-y-4">
            {/* Header: PR # & Close */}
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-neutral-400 font-semibold">#{selectedPRDetail.number}</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-white/5 text-neutral-300">
                  {selectedPRDetail.state}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPRDetail(null)}
                className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Title & Author */}
            <div>
              <h3 className="text-sm font-semibold text-white leading-snug mb-2">
                {selectedPRDetail.title}
              </h3>
              <div className="flex items-center space-x-2 text-neutral-400">
                <img
                  src={selectedPRDetail.author.avatar_url || 'https://github.com/ghost.png'}
                  alt={selectedPRDetail.author.login}
                  className="w-4 h-4 rounded-full border border-white/10"
                />
                <span className="font-medium text-neutral-300">{selectedPRDetail.author.login}</span>
              </div>
            </div>

            {/* Git Metadata Matrix */}
            <div className="space-y-2 py-2 border-y border-white/5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-neutral-500">Branch</span>
                <span className="text-neutral-300 truncate max-w-[180px]">{selectedPRDetail.headBranch}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-500">Commit</span>
                <span className="text-neutral-300">{selectedPRDetail.headSha}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-500">Status</span>
                <span
                  className={
                    selectedPRDetail.isInstalled
                      ? selectedPRDetail.isActive
                        ? 'text-emerald-400 font-semibold'
                        : 'text-neutral-300'
                      : buildingPR === selectedPRDetail.number
                      ? 'text-amber-400'
                      : 'text-neutral-500'
                  }
                >
                  {selectedPRDetail.isActive
                    ? 'Active Engine'
                    : selectedPRDetail.isInstalled
                    ? 'Ready (Built)'
                    : buildingPR === selectedPRDetail.number
                    ? 'Compiling...'
                    : 'Not Built'}
                </span>
              </div>
            </div>

            {/* Description Body */}
            <div>
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1">
                PR Description
              </span>
              <div className="p-2.5 rounded bg-black/40 border border-white/5 text-neutral-300 leading-relaxed font-sans max-h-48 overflow-y-auto whitespace-pre-wrap">
                {selectedPRDetail.body || 'No description provided by author.'}
              </div>
            </div>

            {/* Primary Action Button */}
            <div className="pt-2 space-y-2">
              {selectedPRDetail.isInstalled ? (
                <div className="space-y-2">
                  {selectedPRDetail.isActive ? (
                    <>
                      <button
                        type="button"
                        onClick={handleRevert}
                        className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors"
                      >
                        Revert to Default Runtime
                      </button>
                      {onNavigateToRelinker && (
                        <button
                          type="button"
                          onClick={() => {
                            audioService.playNavTick();
                            onNavigateToRelinker();
                          }}
                          className="w-full py-2 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-semibold text-xs border border-emerald-500/30 transition-colors"
                        >
                          Open in Relinker Studio
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleActivatePR(selectedPRDetail.number)}
                      disabled={buildingPR !== null}
                      className={`w-full py-2 rounded-lg font-semibold text-xs transition-all shadow-sm ${
                        buildingPR !== null
                          ? 'bg-white/10 text-neutral-500 cursor-not-allowed opacity-40'
                          : 'bg-white text-black hover:bg-neutral-200 cursor-pointer'
                      }`}
                      title={
                        buildingPR !== null
                          ? `Build in progress (PR #${buildingPR})`
                          : 'Use Build as Active Engine'
                      }
                    >
                      Use Build as Active Engine
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDeletePR(selectedPRDetail.number)}
                    disabled={buildingPR !== null}
                    className={`w-full py-1.5 rounded-lg border font-medium text-xs transition-colors flex items-center justify-center space-x-1.5 ${
                      buildingPR !== null
                        ? 'border-white/5 bg-white/[0.02] text-neutral-600 cursor-not-allowed opacity-40'
                        : 'border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-400 hover:text-rose-300 cursor-pointer'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Compiled Build from Disk</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleBuildPR(selectedPRDetail)}
                  disabled={buildingPR !== null}
                  className={`w-full py-2 rounded-lg font-semibold text-xs transition-all shadow-sm flex items-center justify-center space-x-1.5 ${
                    buildingPR === selectedPRDetail.number
                      ? 'bg-blue-500/20 border border-blue-500/40 text-blue-300 cursor-not-allowed opacity-90'
                      : buildingPR !== null
                      ? 'bg-white/5 border border-white/5 text-neutral-500 cursor-not-allowed opacity-40'
                      : 'bg-white text-black hover:bg-neutral-200 cursor-pointer'
                  }`}
                  title={
                    buildingPR === selectedPRDetail.number
                      ? `Compiling PR #${selectedPRDetail.number}...`
                      : buildingPR !== null
                      ? `Another build is currently in progress (PR #${buildingPR})`
                      : 'Build PR with Local Builder'
                  }
                >
                  {buildingPR === selectedPRDetail.number ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                      <span>Compiling...</span>
                    </>
                  ) : (
                    <>
                      <Hammer className="w-3.5 h-3.5" />
                      <span>Build PR with Local Builder</span>
                    </>
                  )}
                </button>
              )}

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => toggleSelectPR(selectedPRDetail.number)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    selectedPRNumbers.has(selectedPRDetail.number)
                      ? 'bg-white/15 border-white/30 text-white'
                      : 'bg-white/[0.03] border-white/10 text-neutral-400 hover:text-white'
                  }`}
                >
                  {selectedPRNumbers.has(selectedPRDetail.number)
                    ? 'Deselect from Multi-Build'
                    : 'Select for Multi-Build'}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    apiBridge.openExternal(selectedPRDetail.html_url);
                  }}
                  className="p-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/10 text-neutral-300 hover:text-white transition-colors focus:outline-none"
                  title="View on GitHub in browser"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Embedded Live Compiler Console Drawer */}
      {showConsole && (
        <div className="w-full mt-4 h-52 bg-[#090c10] border border-white/10 rounded-xl flex flex-col overflow-hidden text-xs font-mono animate-fade-in shadow-2xl">
          {/* Console Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-neutral-900 border-b border-white/5">
            <div className="flex items-center space-x-2">
              <Terminal className="w-3.5 h-3.5 text-neutral-400" />
              <span className="text-xs text-neutral-300 font-semibold">
                Native Compiler Console
                {buildingPR ? ` (PR #${buildingPR}: CMake / Ninja)` : ''}
              </span>
              {buildingPR && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400 flex items-center space-x-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>Compiling</span>
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {buildingPR && (
                <button
                  type="button"
                  onClick={handleCancelBuild}
                  className="px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-sans border border-rose-500/20 transition-colors"
                >
                  Cancel Build
                </button>
              )}
              <button
                type="button"
                onClick={() => setLogs([])}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white text-[11px] font-sans transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setShowConsole(false)}
                className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
                title="Hide Console"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Console Output */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1 text-[11px] leading-relaxed bg-[#05070a]">
            {logs.length === 0 ? (
              <div className="text-neutral-600 italic">
                {buildingPR
                  ? 'Initializing build process and fetching PR ref from Git...'
                  : 'Ready. Click "Build PR" on any pull request to begin local compilation.'}
              </div>
            ) : (
              logs.map((msg, i) => (
                <div
                  key={i}
                  className={
                    msg.type === 'error'
                      ? 'text-rose-400'
                      : msg.type === 'info'
                      ? 'text-neutral-300 font-semibold'
                      : msg.type === 'stderr'
                      ? 'text-amber-300/80'
                      : 'text-neutral-400'
                  }
                >
                  <span className="text-neutral-600 mr-2">[{msg.timestamp}]</span>
                  <span>{msg.text}</span>
                </div>
              ))
            )}
            <div ref={terminalBottomRef} />
          </div>
        </div>
      )}

      {/* Contextual Floating Dock: Multi-PR Merge Operations */}
      {selectedPRNumbers.size > 0 && filter !== 'merged-builds' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-[#0e121a] border border-white/15 shadow-2xl rounded-2xl px-5 py-3 flex items-center space-x-4 animate-fade-in backdrop-blur-md">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-xs font-semibold text-white">
              {selectedPRNumbers.size} PR{selectedPRNumbers.size > 1 ? 's' : ''} Selected
            </span>
            <span className="text-xs font-mono text-neutral-500">
              (#{Array.from(selectedPRNumbers).sort((a, b) => a - b).join(', #')})
            </span>
          </div>

          <div className="h-4 w-px bg-white/10" />

          {isMerging ? (
            <div className="flex items-center space-x-3 text-xs text-neutral-300 font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              <span>{mergeStatusText || 'Merging...'}</span>
              <span className="text-white font-semibold">{mergeProgress}%</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => {
                  audioService.playNavTick();
                  setSelectedPRNumbers(new Set());
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleMergeAndBuild}
                disabled={isMerging || buildingPR !== null}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md flex items-center space-x-1.5 ${
                  isMerging || buildingPR !== null
                    ? 'bg-white/10 text-neutral-500 cursor-not-allowed opacity-40'
                    : 'bg-white text-black hover:bg-neutral-200 cursor-pointer'
                }`}
                title={
                  buildingPR !== null
                    ? `Build in progress (PR #${buildingPR})`
                    : 'Merge & Build Combined Binary'
                }
              >
                <GitMerge className="w-3.5 h-3.5" />
                <span>Merge & Build Combined Binary</span>
              </button>
            </div>
          )}

          {mergeError && (
            <div className="text-xs text-rose-400 flex items-center space-x-1 pl-2">
              <AlertCircle className="w-3.5 h-3.5" />
              <span className="truncate max-w-[200px]">{mergeError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
