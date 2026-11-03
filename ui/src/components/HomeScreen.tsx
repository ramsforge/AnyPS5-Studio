import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Play, 
  Sparkles, 
  Code2, 
  CheckCircle2, 
  Info, 
  X,
  HardDrive, 
  Cpu, 
  ShieldCheck, 
  Clock, 
  Layers, 
  Activity,
  FileCode2,
  FolderSearch,
  Plus,
  Trash2,
  AlertTriangle,
  Undo2
} from 'lucide-react';
import { GameItem, RuntimeProfile, PlaygoOverrideInfo, PlaygoMode } from '../types';
import { audioService } from '../services/audioService';
import { apiBridge } from '../services/apiBridge';

interface HomeScreenProps {
  games: GameItem[];
  selectedGameIndex: number;
  onSelectGame: (index: number) => void;
  onLaunchGame: (game: GameItem) => void;
  onStartRelinking: (game: GameItem) => void;
  onOpenNidAudit: (game: GameItem) => void;
  onOpenAddGame: () => void;
  onDeleteGame?: (id: string) => void;
  onClearDemoGames?: () => void;
  onResetDemoGames?: () => void;
}

function formatPlaytime(game: GameItem): string {
  if (game.playTimeSeconds === undefined) return game.playTime || '0 mins';
  const mins = Math.floor(game.playTimeSeconds / 60);
  if (mins < 1) return 'Under 1 min';
  const hrs = Math.floor(mins / 60);
  return hrs > 0 ? `${hrs} hr${hrs === 1 ? '' : 's'} ${mins % 60} mins` : `${mins} min${mins === 1 ? '' : 's'}`;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  games,
  selectedGameIndex,
  onSelectGame,
  onLaunchGame,
  onStartRelinking,
  onOpenNidAudit,
  onOpenAddGame,
  onDeleteGame,
  onClearDemoGames,
  onResetDemoGames,
}) => {
  const [showTechnicalDrawer, setShowTechnicalDrawer] = useState<boolean>(false);
  const [sampleNoticeGame, setSampleNoticeGame] = useState<GameItem | null>(null);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const selectedGame = games[selectedGameIndex] || games[0];

  // Remove asks once more before acting; any change of game or closing the panel cancels it.
  const [confirmRemove, setConfirmRemove] = useState<boolean>(false);
  useEffect(() => {
    setLayoutNotice(null);
    setConfirmRemove(false);
  }, [selectedGame?.id, showTechnicalDrawer]);

  const handleRestoreLayout = async () => {
    if (!selectedGame) return;
    const res = await apiBridge.restoreGameLayout(selectedGame.path);
    if (res.cancelled) return;
    setLayoutNotice(res.success ? `Restored ${res.restored ?? 0} item(s) to their original location.` : res.error || 'Restore failed.');
  };
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [availableRuntimes, setAvailableRuntimes] = useState<RuntimeProfile[]>([]);
  const [selectedGameRuntimeId, setSelectedGameRuntimeId] = useState<string>('inherit');
  const [selectedGamePlaygoInfo, setSelectedGamePlaygoInfo] = useState<PlaygoOverrideInfo | null>(null);

  useEffect(() => {
    if (selectedGame) {
      apiBridge.getRuntimesManifest().then((m) => {
        setAvailableRuntimes(m.runtimes);
      }).catch(() => {});

      apiBridge.getGameRuntime(selectedGame.titleId).then((rId) => {
        setSelectedGameRuntimeId(rId || selectedGame.runtimeId || 'inherit');
      }).catch(() => {});

      apiBridge.getPlaygoOverride(selectedGame.titleId).then((info) => {
        setSelectedGamePlaygoInfo(info);
      }).catch(() => {});
    }
  }, [selectedGame, showTechnicalDrawer]);

  const handleRuntimeChange = async (newRuntimeId: string) => {
    audioService.playNavTick();
    setSelectedGameRuntimeId(newRuntimeId);
    if (selectedGame) {
      selectedGame.runtimeId = newRuntimeId === 'inherit' ? undefined : newRuntimeId;
      await apiBridge.setGameRuntime(selectedGame.titleId, newRuntimeId);
    }
  };

  const handlePlaygoChange = async (mode: PlaygoMode) => {
    audioService.playNavTick();
    if (selectedGame) {
      await apiBridge.setPlaygoOverride(selectedGame.titleId, mode);
      const updated = await apiBridge.getPlaygoOverride(selectedGame.titleId);
      setSelectedGamePlaygoInfo(updated);
    }
  };

  // Smoothly center the active game tile when selection changes
  useEffect(() => {
    if (itemRefs.current[selectedGameIndex]) {
      itemRefs.current[selectedGameIndex]?.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [selectedGameIndex]);

  // Handle Escape key to dismiss drawer or notice modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showTechnicalDrawer) {
          audioService.playCancel();
          setShowTechnicalDrawer(false);
        } else if (sampleNoticeGame) {
          audioService.playCancel();
          setSampleNoticeGame(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTechnicalDrawer, sampleNoticeGame]);

  const handleTileClick = (index: number) => {
    if (index !== selectedGameIndex) {
      audioService.playNavTick();
      onSelectGame(index);
    } else {
      audioService.playNavTick();
      setShowTechnicalDrawer((prev) => !prev);
    }
  };

  const handlePlayAction = (game: GameItem) => {
    if (game.isSample) {
      audioService.playNavTick();
      setSampleNoticeGame(game);
    } else {
      audioService.playLaunch();
      onLaunchGame(game);
    }
  };

  const handleRelinkAction = (game: GameItem) => {
    if (game.isSample) {
      audioService.playNavTick();
      setSampleNoticeGame(game);
    } else {
      audioService.playConfirm();
      onStartRelinking(game);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  const hasSampleTitles = games.some((g) => g.isSample);

  // PlayStation 5 Empty Library State
  if (games.length === 0) {
    return (
      <div className="relative w-full h-[calc(100vh-56px)] flex flex-col items-center justify-center p-8 text-center select-none animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-5 text-neutral-400">
          <FolderSearch className="w-7 h-7" />
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight mb-2">No Titles Installed</h2>
        <p className="text-sm text-neutral-400 max-w-md mb-8 leading-relaxed">
          AnyPS5 relinks real PlayStation 5 binaries into native Windows executables. Import your decrypted <span className="text-white font-mono text-xs">eboot.bin</span> or game folder to begin.
        </p>

        <div className="flex items-center space-x-3.5">
          <button
            onClick={() => {
              audioService.playConfirm();
              onOpenAddGame();
            }}
            className="flex items-center space-x-2 px-6 py-2.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-all shadow-lg active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Import PS5 Title</span>
          </button>

          {onResetDemoGames && (
            <button
              onClick={onResetDemoGames}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs border border-white/10 transition-all"
            >
              <span>Load UI Demo Presets</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col justify-between overflow-hidden select-none">
      {/* Full-viewport Dynamic Background Hero Artwork - Extends to the very top behind floating navbar */}
      <div className="absolute inset-0 z-0 pointer-events-none transition-all duration-500 ease-out">
        {selectedGame?.backdropUrl && (
          <img
            key={selectedGame.id}
            src={selectedGame.backdropUrl}
            alt={selectedGame.title}
            className="w-full h-full object-cover object-top opacity-65 scale-100 transition-opacity duration-700 ease-in-out"
          />
        )}
        {/* Layered cinematic masks on the artwork layer itself: subtle top fade for navbar text legibility, zero horizontal seam */}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#04060a]/80 via-[#04060a]/30 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#04060a] via-[#04060a]/80 via-35% to-transparent w-full md:w-3/4" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#04060a] via-[#04060a]/50 to-transparent" />
      </div>

      {/* Top Section: Game Carousel Shelf (Positioned naturally below floating navbar in upper-left) */}
      <div className="relative z-10 pt-20 md:pt-22 px-8 md:px-12">
        <div className="flex items-center justify-between text-xs font-medium text-neutral-400 mb-3">
          <div className="flex items-center space-x-2">
            <span className="text-white font-semibold text-sm">Your Games</span>
            <span className="text-neutral-500 text-xs font-normal">({games.length})</span>
            {hasSampleTitles && (
              <span className="text-[10px] text-amber-400/80 font-mono">
                (includes demo presets)
              </span>
            )}
          </div>

          {hasSampleTitles && onClearDemoGames && (
            <button
              onClick={onClearDemoGames}
              className="text-[11px] text-neutral-400 hover:text-white transition-colors"
              title="Remove sample demonstration games from library"
            >
              Clear demo presets
            </button>
          )}
        </div>

        {/* Shelf scroll container with 25% larger box art covers and generous outline padding */}
        <div className="flex items-center space-x-5 md:space-x-6 overflow-x-auto pb-6 pt-3 px-4 -mx-4 scrollbar-none scroll-smooth">
          {games.map((game, idx) => {
            const isSelected = idx === selectedGameIndex;
            return (
              <button
                key={game.id}
                data-game-tile
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                onClick={() => handleTileClick(idx)}
                className={`relative flex-shrink-0 w-36 h-48 rounded-xl overflow-hidden transition-all duration-200 ease-out focus:outline-none motion-reduce:transition-none ${
                  isSelected
                    ? 'scale-[1.04] ring-2 ring-white ring-offset-2 ring-offset-[#04060a] z-20 shadow-2xl opacity-100'
                    : 'opacity-70 hover:opacity-95 hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#04060a]'
                }`}
              >
                <img
                  src={game.iconUrl}
                  alt={game.title}
                  className="w-full h-full object-cover"
                />

                {/* Status Dot */}
                <div className="absolute top-2.5 right-2.5">
                  {game.status === 'ported' ? (
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 block shadow-sm ring-1 ring-black/40" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-blue-400 block ring-1 ring-black/40" />
                  )}
                </div>

                {/* Subtle gradient on tile */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 text-left">
                  <p className="text-[11px] font-semibold text-white truncate leading-tight">
                    {game.title}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center-Lower Section: Selected Game Hero & Primary Actions (Elevated with generous bottom breathing room) */}
      {selectedGame && (
        <div className="relative z-10 px-8 md:px-12 pb-20 md:pb-24 lg:pb-28 max-w-3xl lg:max-w-4xl">
          {/* Metadata Row: Clean title ID, port-status, and binary size */}
          <div className="flex items-center space-x-3 mb-2 text-xs flex-wrap gap-y-1">
            <span className="text-neutral-400 font-mono text-xs tracking-wide">
              {selectedGame.titleId}
            </span>
            <span className="text-neutral-600">•</span>
            {selectedGame.isSample && (
              <>
                <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono text-[10px] font-semibold border border-amber-500/30">
                  Demo Preset · Files Not On Disk
                </span>
                <span className="text-neutral-600">•</span>
              </>
            )}
            {selectedGame.status === 'ported' ? (
              <span className="flex items-center space-x-1.5 text-emerald-400 text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {selectedGame.targetPlatform === 'linux' || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux'))
                    ? 'Ported · Linux Native ELF'
                    : 'Ported · Windows Native PE'}
                </span>
              </span>
            ) : (
              <span className="flex items-center space-x-1.5 text-blue-400 text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {(typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux'))
                    ? 'Ready to Relink (Linux)'
                    : 'Decrypted · Ready to Relink'}
                </span>
              </span>
            )}
            <span className="text-neutral-600">•</span>
            <span className="text-neutral-400 text-xs font-mono">
              {formatSize(selectedGame.sizeBytes)}
            </span>
          </div>

          {/* Large Game Title - Clickable for contextual details & specs */}
          <h1 
            onClick={() => {
              audioService.playNavTick();
              setShowTechnicalDrawer(true);
            }}
            className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3 drop-shadow-md cursor-pointer hover:text-white/90 group inline-flex items-center space-x-3"
            title="Click to view title details and technical specifications"
          >
            <span>{selectedGame.title}</span>
            <Info className="w-4 h-4 text-neutral-400 opacity-0 group-hover:opacity-80 transition-opacity" />
          </h1>

          {/* Concise Game Description (only displayed when a factual description is available) */}
          {selectedGame.description ? (
            <p className="text-sm text-neutral-300 max-w-xl leading-relaxed mb-6 drop-shadow">
              {selectedGame.description}
            </p>
          ) : (
            <div className="mb-5" />
          )}

          {/* Action Buttons Zone (Play Game dominant + Relinker Studio secondary + Understated NID Coverage) */}
          <div className="flex flex-wrap items-center gap-3">
            {selectedGame.status === 'ported' ? (
              <button
                onClick={() => handlePlayAction(selectedGame)}
                className="flex items-center space-x-2.5 px-8 py-3 rounded-full bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-all active:scale-95 shadow-lg"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
                <span>Play Game</span>
              </button>
            ) : (
              <button
                onClick={() => handleRelinkAction(selectedGame)}
                className="flex items-center space-x-2.5 px-8 py-3 rounded-full bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-all active:scale-95 shadow-lg"
              >
                <Sparkles className="w-4 h-4" />
                <span>Relink Game</span>
              </button>
            )}

            {/* Secondary Action: Relinker Studio */}
            <button
              onClick={() => {
                audioService.playConfirm();
                onStartRelinking(selectedGame);
              }}
              className="flex items-center space-x-2 px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs tracking-wide border border-white/10 transition-all"
            >
              <span>Relinker Studio</span>
            </button>

            {/* Understated Action: NID Coverage */}
            <button
              onClick={() => {
                audioService.playConfirm();
                onOpenNidAudit(selectedGame);
              }}
              className="flex items-center space-x-1.5 px-3 py-2 text-neutral-400 hover:text-white text-xs font-medium transition-colors rounded-full hover:bg-white/5"
              title="View NID import compatibility audit"
            >
              <Code2 className="w-3.5 h-3.5 text-neutral-400" />
              <span>NID Coverage: {selectedGame.compatibility.score}%</span>
            </button>
          </div>
        </div>
      )}

      {/* Contextual Technical Specs Drawer (Sliding Console Panel) */}
      {showTechnicalDrawer && selectedGame && typeof document !== 'undefined' && createPortal(
        <div data-nav-scope className="fixed inset-0 z-50 flex justify-end select-none animate-fade-in">
          {/* Dimmed backdrop for focus and easy outside click to close */}
          <div
            onClick={() => {
              audioService.playCancel();
              setShowTechnicalDrawer(false);
            }}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
          />

          {/* Drawer panel */}
          <div className="relative w-96 max-w-[90vw] h-full ps-panel p-6 flex flex-col justify-between border-l border-white/10 shadow-2xl z-10 bg-[#080b11]/95">
            <div className="space-y-6 overflow-y-auto pr-1">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center space-x-2 text-white font-semibold text-sm">
                  <Info className="w-4 h-4 text-neutral-400" />
                  <span>Technical Specifications</span>
                </div>
                <button
                  onClick={() => {
                    audioService.playCancel();
                    setShowTechnicalDrawer(false);
                  }}
                  className="p-1.5 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {selectedGame.isSample && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200/90 text-xs leading-relaxed">
                  <p className="font-semibold text-amber-300 mb-0.5">Demo Title Preset</p>
                  This entry is bundled for UI layout demonstration. No files exist on disk at <code className="text-white font-mono text-[11px] block mt-1">{selectedGame.path}</code>
                </div>
              )}

              {/* Spec items */}
              <div className="space-y-4 text-xs">
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Porting Architecture</span>
                  <p className="text-neutral-300 text-xs leading-relaxed">
                    Native 64-bit Windows PE port utilizing AnyPS5 clean-room PRX system libraries with Vulkan/SPIR-V graphics pipeline translation.
                  </p>
                </div>

                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Title & Path</span>
                  <p className="text-white font-medium">{selectedGame.title}</p>
                  <p className="text-neutral-400 font-mono text-[11px] truncate">{selectedGame.path}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Executable</span>
                    <p className="text-white font-mono">{selectedGame.executableName}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Binary Size</span>
                    <p className="text-white font-mono">{formatSize(selectedGame.sizeBytes)}</p>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">PS5 SDK Target</span>
                  <p className="text-white font-mono">{selectedGame.sdkVersion}</p>
                </div>

                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Host CPU Requirements</span>
                  <p className="text-white">{selectedGame.minHostCpu}</p>
                  <p className="text-[10px] text-neutral-400 mt-0.5">Requires Zen2 AVX2, FMA, F16C, BMI1, BMI2, LZCNT, MOVBE.</p>
                </div>

                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">NID Import Coverage</span>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-mono font-bold">{selectedGame.compatibility.score}%</span>
                    <span className="text-neutral-400 font-mono text-[11px]">
                      {selectedGame.compatibility.resolvedNids} / {selectedGame.compatibility.totalNids} functions
                    </span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-emerald-400 h-full rounded-full"
                      style={{ width: `${selectedGame.compatibility.score}%` }}
                    />
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">PRX System Dependencies</span>
                  {selectedGame.compatibility.unresolvedModules.length > 0 ? (
                    <p className="text-amber-300 font-mono text-[11px]">
                      Missing: {selectedGame.compatibility.unresolvedModules.join(', ')}
                    </p>
                  ) : (
                    <p className="text-emerald-400 text-[11px] flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
                      <span>All core runtime dependencies resolved</span>
                    </p>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
                  <span className="text-[10px] text-blue-400 uppercase tracking-wider font-semibold block">
                    Runtime Engine (Per-Game)
                  </span>
                  <select
                    value={selectedGameRuntimeId}
                    onChange={(e) => handleRuntimeChange(e.target.value)}
                    className="w-full px-2.5 py-2 bg-neutral-900 border border-white/15 rounded-lg text-xs text-white focus:outline-none focus:border-blue-400"
                  >
                    <option value="inherit" className="bg-[#080b11] text-white">
                      Inherit Global Default
                    </option>
                    {availableRuntimes.map((rt) => (
                      <option key={rt.id} value={rt.id} className="bg-[#080b11] text-white">
                        {rt.name} ({rt.type})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-neutral-400 leading-normal">
                    Direct Path Execution: Runs against this runtime's libs without admin prompts or symlinks.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-blue-400 uppercase tracking-wider font-semibold block">
                      PlayGo Unlisted Chunks (Per-Game)
                    </span>
                    {selectedGamePlaygoInfo?.preset && !selectedGamePlaygoInfo?.custom && (
                      <span className="text-[10px] text-neutral-400 font-mono">Preset: {selectedGamePlaygoInfo.preset}</span>
                    )}
                    {selectedGamePlaygoInfo?.custom && (
                      <span className="text-[10px] text-emerald-400 font-mono">Custom: {selectedGamePlaygoInfo.custom}</span>
                    )}
                  </div>
                  <select
                    value={selectedGamePlaygoInfo?.custom || 'default'}
                    onChange={(e) => handlePlaygoChange(e.target.value as PlaygoMode)}
                    className="w-full px-2.5 py-2 bg-neutral-900 border border-white/15 rounded-lg text-xs text-white focus:outline-none focus:border-blue-400"
                  >
                    <option value="default" className="bg-[#080b11] text-white">
                      Default {selectedGamePlaygoInfo?.preset ? `(${selectedGamePlaygoInfo.preset} preset)` : '(Throw if unmanifested)'}
                    </option>
                    <option value="installed" className="bg-[#080b11] text-white">
                      Report Installed (LOCAL_FAST)
                    </option>
                    <option value="absent" className="bg-[#080b11] text-white">
                      Report Absent (SCE_PLAYGO_ERROR_BAD_CHUNK_ID)
                    </option>
                  </select>
                  <p className="text-[10px] text-neutral-400 leading-normal">
                    Controls unmanifested chunk responses in libScePlayGo for stripped or partial package dumps.
                  </p>
                </div>

                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Play Statistics</span>
                  <p className="text-white">{formatPlaytime(selectedGame)} total playtime</p>
                  <p className="text-neutral-400 text-[11px]">
                    Last session: {selectedGame.lastPlayedAt
                      ? new Date(selectedGame.lastPlayedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                      : selectedGame.lastPlayed || 'Never'}
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-2">
              <button
                onClick={() => {
                  setShowTechnicalDrawer(false);
                  onOpenNidAudit(selectedGame);
                }}
                className="w-full py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white font-semibold text-xs tracking-wide transition-colors"
              >
                Open Full NID Audit
              </button>

              {!selectedGame.isSample && (
                <button
                  onClick={handleRestoreLayout}
                  className="w-full py-2 rounded-full bg-white/5 hover:bg-white/10 text-neutral-300 font-semibold text-xs tracking-wide border border-white/10 transition-colors flex items-center justify-center space-x-1.5"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Restore Original Folder Layout</span>
                </button>
              )}
              {layoutNotice && (
                <p className="text-[11px] text-neutral-400 text-center leading-relaxed">{layoutNotice}</p>
              )}

              {onDeleteGame && (
                <button
                  onClick={() => {
                    if (!confirmRemove) {
                      audioService.playNavTick();
                      setConfirmRemove(true);
                      return;
                    }
                    setShowTechnicalDrawer(false);
                    onDeleteGame(selectedGame.id);
                  }}
                  className={`w-full py-2 rounded-full font-semibold text-xs tracking-wide border transition-colors flex items-center justify-center space-x-1.5 ${
                    confirmRemove
                      ? 'bg-red-500 hover:bg-red-400 text-white border-red-400'
                      : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{confirmRemove ? 'Press again to remove' : 'Remove From Library'}</span>
                </button>
              )}
              {onDeleteGame && confirmRemove && (
                <p className="text-[11px] text-neutral-400 text-center leading-relaxed">
                  Only the library entry is removed; the game folder stays on disk.
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Demo / Sample Preset Notice Dialog */}
      {sampleNoticeGame && typeof document !== 'undefined' && createPortal(
        <div data-nav-scope className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-fade-in select-none">
          <div className="relative w-full max-w-md bg-[#0b0e14]/95 rounded-2xl border border-white/10 overflow-hidden shadow-2xl p-6">
            <div className="flex items-center space-x-2.5 text-amber-400 mb-3">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-semibold text-base text-white">Demo Preset Title</h3>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed mb-4">
              <strong className="text-white">{sampleNoticeGame.title}</strong> is a preloaded demonstration preset to showcase the PlayStation 5 UI and metadata.
            </p>

            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 font-mono text-[11px] text-neutral-400 mb-5 break-all">
              Path not found: {sampleNoticeGame.path}/{sampleNoticeGame.executableName}
            </div>

            <p className="text-xs text-neutral-400 mb-6 leading-relaxed">
              To port and run games natively on your PC, import your own decrypted PlayStation 5 <code className="text-white font-mono">eboot.bin</code>.
            </p>

            <div className="flex flex-col space-y-2">
              <button
                onClick={() => {
                  setSampleNoticeGame(null);
                  audioService.playConfirm();
                  onOpenAddGame();
                }}
                className="w-full py-2.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
              >
                Import Real PS5 Game
              </button>

              <button
                onClick={() => {
                  const game = sampleNoticeGame;
                  setSampleNoticeGame(null);
                  audioService.playLaunch();
                  onLaunchGame(game);
                }}
                className="w-full py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors"
              >
                Preview Simulated Runtime HUD
              </button>

              <button
                onClick={() => {
                  audioService.playCancel();
                  setSampleNoticeGame(null);
                }}
                className="w-full py-2 rounded-full text-xs text-neutral-400 hover:text-white transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
