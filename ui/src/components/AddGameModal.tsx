import React, { useState } from 'react';
import { 
  Plus, 
  FolderSearch, 
  X, 
  CheckCircle2,
  Sparkles,
  Loader2,
  CheckSquare,
  Square,
  Gamepad2,
  AlertCircle
} from 'lucide-react';
import { GameItem, DiscoveredGameCandidate } from '../types';
import { apiBridge } from '../services/apiBridge';

// Shipped with the app (public/), so imported titles without artwork still look right offline.
const DEFAULT_COVER = './default-cover.svg';
const DEFAULT_BACKDROP = './default-backdrop.svg';
import { audioService } from '../services/audioService';

interface AddGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddGame: (game: GameItem) => void;
  onAddGamesBulk?: (games: GameItem[]) => void;
  existingGames?: GameItem[];
}

type ImportMode = 'single' | 'scan';

export const AddGameModal: React.FC<AddGameModalProps> = ({ 
  isOpen, 
  onClose, 
  onAddGame, 
  onAddGamesBulk,
  existingGames = [] 
}) => {
  const [mode, setMode] = useState<ImportMode>('single');

  // Single Import State
  const [title, setTitle] = useState<string>('');
  const [titleId, setTitleId] = useState<string>('PPSA');
  const [folderPath, setFolderPath] = useState<string>('C:/Games/PS5/NewTitle');
  const [iconUrl, setIconUrl] = useState<string>(DEFAULT_COVER);
  const [backdropUrl, setBackdropUrl] = useState<string>(DEFAULT_BACKDROP);
  const [sizeBytes, setSizeBytes] = useState<number>(0);
  const [detectedBadge, setDetectedBadge] = useState<string | null>(null);

  // Bulk Directory Scan State
  const [scanRootPath, setScanRootPath] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<DiscoveredGameCandidate[] | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);

  if (!isOpen) return null;

  const normalizePath = (p: string) => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

  const isAlreadyInLibrary = (candidate: DiscoveredGameCandidate): boolean => {
    if (!existingGames || existingGames.length === 0) return false;
    const candNorm = normalizePath(candidate.path);
    const candId = (candidate.titleId || '').toUpperCase().trim();

    return existingGames.some((g) => {
      const gNorm = normalizePath(g.path || '');
      if (gNorm && gNorm === candNorm) return true;
      const gId = (g.titleId || '').toUpperCase().trim();
      if (candId && candId !== 'PPSA99999' && gId === candId) return true;
      return false;
    });
  };

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  // Single Title Browse & Submit
  const handleBrowseSingle = async () => {
    audioService.playNavTick();
    const selected = await apiBridge.selectGameFolder();
    if (selected) {
      setFolderPath(selected);

      const inspected = await apiBridge.inspectGameFolder(selected);
      if (inspected) {
        if (inspected.title) setTitle(inspected.title);
        if (inspected.titleId) setTitleId(inspected.titleId);
        if (inspected.iconUrl) setIconUrl(inspected.iconUrl);
        if (inspected.backdropUrl) setBackdropUrl(inspected.backdropUrl);
        if (inspected.sizeBytes) setSizeBytes(inspected.sizeBytes);
        setDetectedBadge(`PlayStation 5 Title Detected · ${inspected.title || 'App'} (${inspected.titleId || 'PPSA'})`);
      } else {
        const folderName = selected.split(/[\/\\]/).filter(Boolean).pop() || '';
        if (!title) {
          setTitle(folderName.replace(/[_-]/g, ' '));
        }
      }
    }
  };

  const handleSingleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !folderPath.trim()) return;

    audioService.playConfirm();

    const isLinuxHost = typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux');
    const newGame: GameItem = {
      id: 'game-' + Date.now(),
      title: title.trim(),
      titleId: titleId.trim() || 'PPSA99999',
      version: '01.00',
      category: 'game',
      status: 'ready_to_relink',
      path: folderPath.trim(),
      executableName: isLinuxHost ? 'app.elf' : 'eboot.bin',
      targetPlatform: isLinuxHost ? 'linux' : 'windows',
      iconUrl: iconUrl || DEFAULT_COVER,
      backdropUrl: backdropUrl || DEFAULT_BACKDROP,
      sizeBytes: sizeBytes || 0,
      sdkVersion: '05.000.001',
      minHostCpu: 'AMD Zen2 / Intel AVX2',
      compatibility: {
        status: 'playable',
        score: 95,
        resolvedNids: 480,
        totalNids: 505,
        unresolvedModules: [],
        missingNids: [],
        amdInstructionsDetected: 24,
      },
    };

    onAddGame(newGame);
    onClose();
  };

  // Bulk Directory Scan Browse & Execution
  const handleBrowseScanRoot = async () => {
    audioService.playNavTick();
    const selected = await apiBridge.selectGameFolder();
    if (selected) {
      setScanRootPath(selected);
      await runDirectoryScan(selected);
    }
  };

  const runDirectoryScan = async (rootPath: string) => {
    if (!rootPath) return;
    setIsScanning(true);
    setScanError(null);
    try {
      const results = await apiBridge.scanDirectoryForGames(rootPath);
      setCandidates(results);

      const initialSelected = new Set<string>();
      for (const c of results) {
        if (!isAlreadyInLibrary(c)) {
          initialSelected.add(c.path);
        }
      }
      setSelectedPaths(initialSelected);
    } catch {
      setScanError('Failed to scan directory. Please ensure the path exists and is accessible.');
      setCandidates([]);
      setSelectedPaths(new Set());
    } finally {
      setIsScanning(false);
    }
  };

  const handleSelectAll = () => {
    audioService.playNavTick();
    if (!candidates) return;
    const next = new Set<string>();
    for (const c of candidates) {
      if (!isAlreadyInLibrary(c)) {
        next.add(c.path);
      }
    }
    setSelectedPaths(next);
  };

  const handleDeselectAll = () => {
    audioService.playNavTick();
    setSelectedPaths(new Set());
  };

  const toggleCandidate = (path: string) => {
    audioService.playNavTick();
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleBulkImport = () => {
    if (!candidates || selectedPaths.size === 0) return;
    audioService.playConfirm();

    const isLinuxHost = typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux');
    const selectedCandidates = candidates.filter((c) => selectedPaths.has(c.path));

    const newGames: GameItem[] = selectedCandidates.map((c, idx) => ({
      id: `game-${Date.now()}-${idx}`,
      title: c.title || 'PlayStation 5 Title',
      titleId: c.titleId || 'PPSA99999',
      version: c.version || '01.00',
      category: 'game',
      status: 'ready_to_relink',
      path: c.path,
      executableName: isLinuxHost ? 'app.elf' : 'eboot.bin',
      targetPlatform: isLinuxHost ? 'linux' : 'windows',
      iconUrl: c.iconUrl || DEFAULT_COVER,
      backdropUrl: c.backdropUrl || DEFAULT_BACKDROP,
      sizeBytes: c.sizeBytes || 0,
      sdkVersion: '05.000.001',
      minHostCpu: 'AMD Zen2 / Intel AVX2',
      compatibility: {
        status: 'playable',
        score: 95,
        resolvedNids: 480,
        totalNids: 505,
        unresolvedModules: [],
        missingNids: [],
        amdInstructionsDetected: 24,
      },
    }));

    if (onAddGamesBulk) {
      onAddGamesBulk(newGames);
    } else {
      for (const g of newGames) {
        onAddGame(g);
      }
    }

    onClose();
  };

  const selectableCount = candidates ? candidates.filter((c) => !isAlreadyInLibrary(c)).length : 0;

  return (
    <div data-nav-scope className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-fade-in select-none">
      <div className={`relative w-full ${mode === 'scan' ? 'max-w-2xl' : 'max-w-lg'} bg-[#0b0e14]/95 rounded-2xl border border-white/10 overflow-hidden shadow-2xl p-6 transition-all duration-200`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <div className="flex items-center space-x-2.5">
            <Plus className="w-4 h-4 text-white/70" />
            <h3 className="font-medium text-base text-white tracking-wide">Import PlayStation 5 Titles</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center space-x-1 p-1 bg-white/[0.03] border border-white/10 rounded-xl mb-5">
          <button
            type="button"
            onClick={() => {
              audioService.playNavTick();
              setMode('single');
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center space-x-2 transition-all ${
              mode === 'single'
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Single Title</span>
          </button>
          <button
            type="button"
            onClick={() => {
              audioService.playNavTick();
              setMode('scan');
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center space-x-2 transition-all ${
              mode === 'scan'
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            <FolderSearch className="w-3.5 h-3.5" />
            <span>Scan Directory</span>
          </button>
        </div>

        {/* Mode 1: Single Title */}
        {mode === 'single' && (
          <form onSubmit={handleSingleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Game Directory or ELF Path</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="C:/Games/PS5/MyGame"
                  className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={handleBrowseSingle}
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors"
                >
                  <FolderSearch className="w-3.5 h-3.5 text-white/70" />
                  <span>Browse</span>
                </button>
              </div>
              <p className="text-[11px] text-white/40 mt-1">
                Select decrypted dump folder containing eboot.bin or param.json.
              </p>
            </div>

            {detectedBadge && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center space-x-2 animate-fade-in">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium">{detectedBadge}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Game Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Dreaming Sarah"
                className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">Title ID</label>
                <input
                  type="text"
                  value={titleId}
                  onChange={(e) => setTitleId(e.target.value)}
                  placeholder="PPSA02929"
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs font-mono uppercase focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">Target Subsystem</label>
                <div className="w-full px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-white/60 text-xs font-mono">
                  Windows x86_64
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors shadow-lg active:scale-95 flex items-center space-x-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Import to Library</span>
              </button>
            </div>
          </form>
        )}

        {/* Mode 2: Scan Directory */}
        {mode === 'scan' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Parent Root Directory</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={scanRootPath}
                  onChange={(e) => setScanRootPath(e.target.value)}
                  placeholder="e.g. D:/Games/PS5"
                  className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all"
                />
                <button
                  type="button"
                  onClick={handleBrowseScanRoot}
                  disabled={isScanning}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors"
                >
                  <FolderSearch className="w-3.5 h-3.5 text-white/70" />
                  <span>Browse Root Directory</span>
                </button>
              </div>
              <p className="text-[11px] text-white/40 mt-1">
                Select a folder containing multiple game subdirectories. Folders with eboot.bin or app0/eboot.bin will be detected automatically.
              </p>
            </div>

            {scanError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{scanError}</span>
              </div>
            )}

            {/* Active Scanning Indicator */}
            {isScanning && (
              <div className="p-8 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center space-y-3 animate-fade-in">
                <Loader2 className="w-6 h-6 text-[#0070d1] animate-spin" />
                <div className="text-center">
                  <p className="text-xs font-medium text-white">Scanning directory for PlayStation 5 titles...</p>
                  <p className="text-[11px] font-mono text-white/40 mt-1 truncate max-w-md">{scanRootPath}</p>
                </div>
              </div>
            )}

            {/* Discovered Titles Header and Controls */}
            {!isScanning && candidates !== null && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-semibold text-white">
                      Found {candidates.length} {candidates.length === 1 ? 'PlayStation 5 Title' : 'PlayStation 5 Titles'}
                    </span>
                    {selectableCount > 0 && (
                      <span className="text-[11px] font-mono text-white/40">
                        ({selectableCount} new)
                      </span>
                    )}
                  </div>
                  {candidates.length > 0 && selectableCount > 0 && (
                    <div className="flex items-center space-x-2 text-xs">
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        className="text-white/60 hover:text-white transition-colors underline-offset-2 hover:underline text-[11px]"
                      >
                        Select All
                      </button>
                      <span className="text-white/20">·</span>
                      <button
                        type="button"
                        onClick={handleDeselectAll}
                        className="text-white/60 hover:text-white transition-colors underline-offset-2 hover:underline text-[11px]"
                      >
                        Deselect All
                      </button>
                    </div>
                  )}
                </div>

                {/* Candidate List */}
                {candidates.length === 0 ? (
                  <div className="p-6 rounded-xl bg-white/[0.02] border border-white/5 text-center text-xs text-white/50">
                    No PlayStation 5 titles found in this directory. Ensure subdirectories contain eboot.bin or app0/eboot.bin.
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {candidates.map((candidate) => {
                      const inLibrary = isAlreadyInLibrary(candidate);
                      const isSelected = selectedPaths.has(candidate.path);

                      return (
                        <div
                          key={candidate.path}
                          onClick={() => {
                            if (!inLibrary) toggleCandidate(candidate.path);
                          }}
                          className={`p-2.5 rounded-xl border transition-all flex items-center space-x-3 ${
                            inLibrary
                              ? 'bg-white/[0.01] border-white/5 opacity-50 cursor-not-allowed'
                              : isSelected
                              ? 'bg-white/[0.06] border-[#0070d1]/50 cursor-pointer'
                              : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/5 cursor-pointer'
                          }`}
                        >
                          {/* Selection Checkbox */}
                          <div className="flex-shrink-0">
                            {inLibrary ? (
                              <Square className="w-4 h-4 text-white/20" />
                            ) : isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#0070d1]" />
                            ) : (
                              <Square className="w-4 h-4 text-white/40" />
                            )}
                          </div>

                          {/* Thumbnail Icon */}
                          <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center flex-shrink-0">
                            {candidate.iconUrl ? (
                              <img
                                src={candidate.iconUrl}
                                alt={candidate.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Gamepad2 className="w-5 h-5 text-white/30" />
                            )}
                          </div>

                          {/* Title & Metadata */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2">
                              <h4 className="text-xs font-semibold text-white truncate max-w-sm">
                                {candidate.title}
                              </h4>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/60 border border-white/10 flex-shrink-0">
                                {candidate.titleId}
                              </span>
                            </div>
                            <p className="text-[10px] font-mono text-white/35 truncate mt-0.5" title={candidate.path}>
                              {candidate.path}
                            </p>
                          </div>

                          {/* Size & Status Badge */}
                          <div className="flex items-center space-x-2.5 flex-shrink-0">
                            <span className="text-[11px] font-mono text-white/50">
                              {formatSize(candidate.sizeBytes)}
                            </span>
                            {inLibrary ? (
                              <span className="text-[10px] font-mono text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                                [In Library]
                              </span>
                            ) : (
                              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                Ready
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Bottom Actions */}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
              <div className="text-xs text-white/50">
                {candidates !== null && !isScanning && (
                  <span>
                    {selectedPaths.size} of {selectableCount} new {selectableCount === 1 ? 'title' : 'titles'} selected
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkImport}
                  disabled={selectedPaths.size === 0 || isScanning}
                  className={`px-5 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shadow-lg ${
                    selectedPaths.size > 0 && !isScanning
                      ? 'bg-[#0070d1] hover:bg-[#0060b8] text-white shadow-[#0070d1]/20 active:scale-95 cursor-pointer'
                      : 'bg-white/10 text-white/30 cursor-not-allowed shadow-none'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Import Selected Titles ({selectedPaths.size})</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
