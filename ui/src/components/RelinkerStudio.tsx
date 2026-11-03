import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Sparkles, 
  Terminal, 
  CheckCircle2, 
  AlertTriangle,
  Loader2, 
  Sliders, 
  Play,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { GameItem, RelinkerOptions, ConversionStage, ConversionLog, SystemTelemetry, RuntimeProfile } from '../types';
import { apiBridge } from '../services/apiBridge';
import { audioService } from '../services/audioService';

interface RelinkerStudioProps {
  games: GameItem[];
  selectedGame: GameItem;
  onUpdateGameStatus: (gameId: string, status: 'ported', updatedGame?: GameItem) => void;
  onLaunchGame?: (game: GameItem) => void;
  onNavigateToGames?: () => void;
}

type ExecutionState = 'idle' | 'running' | 'success' | 'error';

interface HumanStep {
  stepNumber: number;
  title: string;
  description: string;
}

const getHumanSteps = (target: string): Record<number, HumanStep> => ({
  1: { stepNumber: 1, title: 'Checking game files', description: 'Verifying decrypted game files, folder layout, and eboot' },
  2: { stepNumber: 2, title: 'Checking compatibility', description: 'Matching PlayStation 5 system calls with PC runtime libraries' },
  3: { stepNumber: 3, title: 'Preparing runtime libraries', description: 'Configuring clean-room system libraries for graphics and input' },
  4: { stepNumber: 4, title: 'Translating CPU instructions', description: 'Adapting console CPU instructions for your processor' },
  5: { stepNumber: 5, title: target === 'linux' ? 'Building Linux executable' : 'Building Windows executable', description: target === 'linux' ? 'Generating native 64-bit Linux executable (app.elf)' : 'Generating native 64-bit Windows application (app.exe)' },
  6: { stepNumber: 6, title: 'Finalizing native package', description: 'Extracting artwork and preparing instant Plug & Play launcher' },
});

export const RelinkerStudio: React.FC<RelinkerStudioProps> = ({
  games,
  selectedGame: initialGame,
  onUpdateGameStatus,
  onLaunchGame,
  onNavigateToGames,
}) => {
  // Mode State: 'simple' (default) vs 'advanced'
  const [mode, setMode] = useState<'simple' | 'advanced'>(() => {
    return (localStorage.getItem('anyps5_relinker_mode') as 'simple' | 'advanced') || 'simple';
  });

  const [selectedGame, setSelectedGame] = useState<GameItem>(initialGame);
  const [executionState, setExecutionState] = useState<ExecutionState>('idle');
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [isGameSwitcherOpen, setIsGameSwitcherOpen] = useState<boolean>(false);

  // Simple Mode expandable sections
  const [showSettingsDetails, setShowSettingsDetails] = useState<boolean>(false);
  const [showLiveLogs, setShowLiveLogs] = useState<boolean>(false);
  const [showErrorLogs, setShowErrorLogs] = useState<boolean>(false);

  // System Telemetry State
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [availableRuntimes, setAvailableRuntimes] = useState<RuntimeProfile[]>([]);

  useEffect(() => {
    apiBridge.getRuntimesManifest().then((m) => {
      setAvailableRuntimes(m.runtimes);
    }).catch(() => {});
  }, []);

  const isLinuxHost = (typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux'));

  // Technical 8-Stage Pipeline (for backend and Advanced mode)
  const [technicalStages, setTechnicalStages] = useState<ConversionStage[]>([
    { id: 1, title: 'Validating Decrypted ELF', description: 'Inspecting ELF headers & PT_LOAD segments', status: 'pending' },
    { id: 2, title: 'Scanning System Imports (NIDs)', description: 'Resolving PS5 library imports against clean-room PRX exports', status: 'pending' },
    { id: 3, title: 'Scanning Bundled Modules', description: 'Parsing modules in sce_module/ for runtime dependencies', status: 'pending' },
    { id: 4, title: 'AMD to Intel Codegen Translation', description: 'Rewriting AMD-specific Zen2 instructions', status: 'pending' },
    { id: 5, title: 'Unused Import Filter & PLT', description: 'Analyzing control-flow and compacting PLT', status: 'pending' },
    { id: 6, title: isLinuxHost ? 'Relinking Native ELF Executable' : 'Relinking PE Executable', description: isLinuxHost ? 'Generating Linux ELF headers and dynamic segments' : 'Generating Windows PE headers and entry RVA', status: 'pending' },
    { id: 7, title: 'Copying Clean-room PRX Libraries', description: 'Deploying system libraries (libkernel, libSceAgcDriver)', status: 'pending' },
    { id: 8, title: 'Finalizing Native Package', description: isLinuxHost ? 'Writing app.elf and runtime configuration' : 'Writing app.exe and registry metadata', status: 'pending' },
  ]);

  // Terminal & Progress Logs
  const [logs, setLogs] = useState<ConversionLog[]>([
    { timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'Relinker Studio ready. System environment initialized.' }
  ]);

  // Error Diagnosis State
  const [errorMessage, setErrorMessage] = useState<{
    summary: string;
    remedy: string;
  } | null>(null);

  // Relinker Configuration Options
  const [options, setOptions] = useState<RelinkerOptions>({
    target: isLinuxHost ? 'linux' : 'windows',
    subsystem: 'gui',
    cpuTranslation: 'intel',
    unusedFilter: 0,
    rpath: '$ORIGIN/libs',
    traceImports: false,
    windowsDiagnostics: true,
    fixedBaseAddress: '',
    autorun: false,
    sceModulePath: '',
  });

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const gameSwitcherRef = useRef<HTMLDivElement>(null);

  // Persist mode toggle
  const handleSetMode = (newMode: 'simple' | 'advanced') => {
    audioService.playNavTick();
    setMode(newMode);
    localStorage.setItem('anyps5_relinker_mode', newMode);
  };

  // Perform Real System Detection
  const runSystemDetection = async () => {
    try {
      const [data, settings] = await Promise.all([apiBridge.getTelemetry(), apiBridge.getSettings()]);
      setTelemetry(data);

      const isLinux = data?.osName?.toLowerCase().includes('linux') || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux'));
      const target = (settings.defaultTarget as RelinkerOptions['target']) || (isLinux ? 'linux' : 'windows');
      // Settings > CPU: "auto" follows the detected host; "amd" means no Zen 2 lowering.
      const chosenCpu = settings.cpuFix && settings.cpuFix !== 'auto'
        ? (settings.cpuFix === 'amd' ? 'none' : settings.cpuFix)
        : data.recommendedCpuTranslation || 'intel';

      setOptions(prev => ({
        ...prev,
        cpuTranslation: chosenCpu as RelinkerOptions['cpuTranslation'],
        target,
        subsystem: 'gui',
        unusedFilter: 0,
      }));
    } catch (err: any) {
      console.warn('System telemetry check:', err);
    }
  };

  useEffect(() => {
    runSystemDetection();
    // Pick up Default Target / CPU changes saved in Settings without restarting.
    window.addEventListener('anyps5:settings-saved', runSystemDetection);
    return () => window.removeEventListener('anyps5:settings-saved', runSystemDetection);
  }, []);

  // Close game switcher when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (gameSwitcherRef.current && !gameSwitcherRef.current.contains(e.target as Node)) {
        setIsGameSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update game when prop changes
  const prevGameIdRef = useRef<string>(initialGame.id);
  useEffect(() => {
    if (initialGame.id !== prevGameIdRef.current) {
      prevGameIdRef.current = initialGame.id;
      setSelectedGame(initialGame);
      setExecutionState('idle');
      setErrorMessage(null);
    }
  }, [initialGame.id]);

  // Scroll logs when updated
  useEffect(() => {
    if (showLiveLogs || showErrorLogs || mode === 'advanced') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLiveLogs, showErrorLogs, mode]);

  const humanSteps = useMemo(() => getHumanSteps(options.target), [options.target]);

  // Active step mapping during execution
  const activeStepInfo: HumanStep = useMemo(() => {
    const s1 = technicalStages.find(s => s.id === 1);
    const s2 = technicalStages.find(s => s.id === 2);
    const s3 = technicalStages.find(s => s.id === 3);
    const s4 = technicalStages.find(s => s.id === 4);
    const s5 = technicalStages.find(s => s.id === 5);
    const s6 = technicalStages.find(s => s.id === 6);
    const s7 = technicalStages.find(s => s.id === 7);
    const s8 = technicalStages.find(s => s.id === 8);

    if (s8?.status === 'active' || s8?.status === 'completed') return humanSteps[6];
    if (s6?.status === 'active' || s5?.status === 'active') return humanSteps[5];
    if (s4?.status === 'active') return humanSteps[4];
    if (s7?.status === 'active' || s3?.status === 'active') return humanSteps[3];
    if (s2?.status === 'active') return humanSteps[2];
    if (s1?.status === 'active') return humanSteps[1];

    const completedCount = technicalStages.filter(s => s.status === 'completed').length;
    if (completedCount >= 7) return humanSteps[6];
    if (completedCount >= 5) return humanSteps[5];
    if (completedCount >= 4) return humanSteps[4];
    if (completedCount >= 2) return humanSteps[3];
    if (completedCount >= 1) return humanSteps[2];

    return humanSteps[1];
  }, [technicalStages, humanSteps]);

  // Overall Progress Percentage (0-100%)
  const overallProgress = useMemo(() => {
    if (executionState === 'success') return 100;
    if (executionState === 'idle') return 0;
    const completed = technicalStages.filter(s => s.status === 'completed').length;
    const active = technicalStages.find(s => s.status === 'active');
    const activeProgress = active ? 0.5 : 0;
    return Math.min(99, Math.round(((completed + activeProgress) / technicalStages.length) * 100));
  }, [technicalStages, executionState]);

  // System Readiness Check
  const readiness = useMemo(() => {
    if (!selectedGame || !selectedGame.path) {
      return { isReady: false, statusText: 'Game folder not found' };
    }
    if (telemetry && !telemetry.relinkerBinaryFound) {
      return { isReady: false, statusText: 'Relinker toolchain missing' };
    }
    return { isReady: true, statusText: 'Ready to Play' };
  }, [selectedGame, telemetry]);

  // Start Relinking Process
  const handleStartRelinking = async () => {
    if (executionState === 'running' || !readiness.isReady) return;
    
    audioService.playConfirm();
    setExecutionState('running');
    setIsCancelling(false);
    setErrorMessage(null);

    // Reset stages
    setTechnicalStages(prev => prev.map(s => ({ ...s, status: 'pending', progress: 0 })));

    let finalGame: GameItem | undefined;

    try {
      const success = await apiBridge.executeRelinker(
        selectedGame,
        options,
        (updatedStage) => {
          setTechnicalStages(prev => prev.map(s => s.id === updatedStage.id ? { ...s, ...updatedStage } : s));
        },
        (newLog) => {
          setLogs(prev => [...prev, newLog]);
        },
        (updatedGame) => {
          if (updatedGame) {
            finalGame = updatedGame;
            setSelectedGame(updatedGame);
          }
        }
      );

      setIsCancelling(false);

      if (success) {
        setExecutionState('success');
        audioService.playSuccess();
        onUpdateGameStatus(selectedGame.id, 'ported', finalGame);
      } else {
        setExecutionState('error');
        audioService.playCancel();
        setErrorMessage({
          summary: 'The conversion process was unable to complete.',
          remedy: '1. Verify the game is decrypted and contains eboot.bin.\n2. In Advanced mode, try setting CPU Translation to Intel AVX2 and Unused Import Optimization to Level 0.\n3. Make sure no other program is accessing the game folder.',
        });
      }
    } catch (err: any) {
      setIsCancelling(false);
      setExecutionState('error');
      audioService.playCancel();
      setErrorMessage({
        summary: 'Pipeline execution failed.',
        remedy: err.message || 'Ensure relinker.exe has execution permissions and game folder is accessible.',
      });
    }
  };

  // Cancel Relinking Process
  const handleCancelRelinking = async () => {
    if (executionState !== 'running' || isCancelling) return;
    audioService.playCancel();
    setIsCancelling(true);

    setLogs(prev => [
      ...prev,
      {
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: '[AnyPS5] User requested cancellation. Safely stopping compiler...',
      }
    ]);

    await apiBridge.cancelRelinker();

    setExecutionState('error');
    setIsCancelling(false);
    setErrorMessage({
      summary: 'Relinking was cancelled by the user.',
      remedy: 'Compilation stopped safely. No game files were damaged. You can start again whenever you are ready.',
    });
  };

  return (
    <div className="relative w-full h-full flex flex-col pt-24 px-8 md:px-12 lg:px-16 pb-12 overflow-y-auto select-none">
      
      {/* Console Header: Title & Clean Mode Toggle */}
      <div className="w-full max-w-[1280px] mx-auto flex items-center justify-between mb-8 pb-4 border-b border-white/5">
        <div>
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block mb-1">
            System Software / Relinker Studio
          </span>
          <h2 className="text-2xl font-bold text-white tracking-tight">Relinker Studio</h2>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center bg-black/60 p-1 rounded-xl border border-white/10 shadow-inner">
          <button
            type="button"
            onClick={() => handleSetMode('simple')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mode === 'simple'
                ? 'bg-white text-black font-semibold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Simple</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetMode('advanced')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mode === 'advanced'
                ? 'bg-white text-black font-semibold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Advanced</span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* SIMPLE MODE (Cohesive Desktop Workspace ~1280px)               */}
      {/* ============================================================== */}
      {mode === 'simple' && (
        <div className="max-w-[1280px] w-full mx-auto flex flex-col space-y-7 animate-fade-in">
          
          {/* STATE 1: IDLE (Before Execution - Structured 3-Tier Workflow) */}
          {executionState === 'idle' && (
            <div className="space-y-6">
              
              {/* 1. Selected Game Area */}
              <div className="flex items-start space-x-7">
                {/* Artwork Cover (200-220px tall, preserving aspect ratio) */}
                <div className="relative shrink-0">
                  <img
                    src={selectedGame.iconUrl}
                    alt={selectedGame.title}
                    className="w-[165px] h-[220px] rounded-2xl object-cover shadow-2xl border border-white/10"
                  />
                </div>

                {/* Game Title, Prominence & Breathing Room, Secondary Metadata */}
                <div className="flex-1 min-w-0 h-[220px] flex flex-col justify-center">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block mb-2">
                    Selected PlayStation 5 Game
                  </span>
                  <h1 className="text-3xl md:text-4xl lg:text-[42px] font-extrabold text-white tracking-tight leading-tight truncate mb-3">
                    {selectedGame.title}
                  </h1>

                  <div className="flex items-center space-x-3 text-xs text-neutral-400 font-mono">
                    <span className="text-neutral-300 font-semibold">{selectedGame.titleId}</span>
                    <span className="text-neutral-600">•</span>
                    <span>{(selectedGame.sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB</span>
                    <span className="text-neutral-600">•</span>
                    
                    {/* Change Game popover trigger */}
                    <div className="relative inline-block" ref={gameSwitcherRef}>
                      <button
                        type="button"
                        onClick={() => setIsGameSwitcherOpen(!isGameSwitcherOpen)}
                        className="text-neutral-300 hover:text-white font-sans text-xs underline underline-offset-4 decoration-white/20 hover:decoration-white transition-colors inline-flex items-center space-x-1"
                      >
                        <span>Change Game</span>
                        <ChevronDown className="w-3 h-3 text-neutral-400" />
                      </button>

                      {isGameSwitcherOpen && (
                        <div className="absolute left-0 mt-2 w-80 max-h-64 overflow-y-auto bg-[#0b0e14] border border-white/15 rounded-xl shadow-2xl z-50 py-1 divide-y divide-white/5">
                          {games.map(g => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => {
                                setSelectedGame(g);
                                setIsGameSwitcherOpen(false);
                                setErrorMessage(null);
                                audioService.playNavTick();
                              }}
                              className={`w-full flex items-center space-x-3 px-3 py-2 text-left text-xs transition-colors ${
                                g.id === selectedGame.id ? 'bg-white/10 text-white font-semibold' : 'text-neutral-300 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              <img src={g.iconUrl} alt={g.title} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                              <div className="truncate">
                                <div className="truncate font-medium">{g.title}</div>
                                <div className="text-[10px] text-neutral-400 font-mono">{g.titleId}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. System Readiness & Configuration Section (Directly beneath selected-game area) */}
              <div className="rounded-2xl bg-white/[0.025] border border-white/[0.07] p-5 md:p-6 transition-all">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center space-x-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        readiness.isReady ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]'
                      }`} />
                      <span className="text-base font-semibold text-white tracking-tight">
                        {readiness.isReady ? 'Ready to Play' : 'System check needed'}
                      </span>
                    </div>

                    <p className="text-xs md:text-sm text-neutral-400 leading-relaxed pl-5">
                      {readiness.isReady
                        ? (options.cpuTranslation === 'intel'
                            ? 'Configured automatically for your Intel processor with clean window mode.'
                            : options.cpuTranslation === 'none'
                            ? 'Configured automatically for your AMD Ryzen processor with clean window mode.'
                            : 'Configured automatically for your system environment.')
                        : readiness.statusText}
                    </p>
                  </div>

                  <div className="sm:self-center shrink-0 pl-5 sm:pl-0">
                    <button
                      type="button"
                      onClick={() => setShowSettingsDetails(!showSettingsDetails)}
                      className="text-xs font-medium text-neutral-400 hover:text-white transition-colors inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/10"
                    >
                      <span>{showSettingsDetails ? 'Hide settings' : 'Inspect settings'}</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showSettingsDetails ? 'rotate-180 text-white' : 'text-neutral-400'}`} />
                    </button>
                  </div>
                </div>

                {/* Expandable Inspect Settings Drawer */}
                {showSettingsDetails && (
                  <div className="mt-5 pt-4 border-t border-white/5 font-mono text-xs text-neutral-300 animate-fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-2.5">
                      <div className="space-y-2">
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-neutral-500">Output Format:</span>
                          <span className="text-neutral-200">
                            {options.target === 'linux' ? 'Linux Executable (.elf)' : options.target === 'macos' ? 'macOS Mach-O' : 'Windows Executable (.exe)'}
                          </span>
                        </div>
                        {options.target === 'windows' && (
                          <div className="flex justify-between border-b border-white/5 pb-1">
                            <span className="text-neutral-500">Window Subsystem:</span>
                            <span className="text-neutral-200">Clean Window (GUI)</span>
                          </div>
                        )}
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-neutral-500">Runtime Engine:</span>
                          <span className="text-neutral-200">
                            {options.runtimeId
                              ? (availableRuntimes.find(r => r.id === options.runtimeId)?.name || options.runtimeId)
                              : selectedGame.runtimeId
                              ? (availableRuntimes.find(r => r.id === selectedGame.runtimeId)?.name || selectedGame.runtimeId)
                              : 'Inherit Global Default'}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-neutral-500">CPU Translation:</span>
                          <span className="text-neutral-200">
                            {options.cpuTranslation === 'intel' ? 'Intel AVX2 Optimization' : options.cpuTranslation === 'rosetta' ? 'Rosetta 2 Translation' : 'AMD Zen2 Native'}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-neutral-500">Import Filter:</span>
                          <span className="text-neutral-200">
                            {options.unusedFilter === 0
                              ? 'Level 0 (Full Compatibility / Safe)'
                              : options.unusedFilter === 1
                              ? 'Level 1 (Standard Pruning)'
                              : 'Level 2 (Strict Pruning)'}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-neutral-500">Host Processor:</span>
                          <span className="text-neutral-200">{telemetry?.hostCpu || 'Verified'}</span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-neutral-500">Host Graphics:</span>
                          <span className="text-neutral-200">{telemetry?.gpuName || 'DirectX 12 / Vulkan'}</span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-neutral-500">Compiler Tool:</span>
                          <span className={telemetry?.relinkerBinaryFound ? 'text-emerald-400' : 'text-red-400'}>
                            {telemetry?.relinkerBinaryFound ? 'Ready (relinker.exe)' : 'Missing'}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-neutral-500">Game Directory:</span>
                          <span className="text-neutral-400 truncate max-w-[220px]" title={selectedGame.path}>
                            {selectedGame.path}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Primary Action Area (Directly below readiness/configuration section) */}
              <div className="flex flex-wrap items-center gap-5 pt-1">
                <button
                  type="button"
                  onClick={handleStartRelinking}
                  disabled={!readiness.isReady}
                  className={`w-[220px] h-12 rounded-full font-bold text-sm tracking-wide transition-all shadow-xl flex items-center justify-center space-x-2.5 ${
                    !readiness.isReady
                      ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-white/5'
                      : 'bg-white text-black hover:bg-neutral-200 active:scale-[0.98] shadow-white/10'
                  }`}
                >
                  <Sparkles className="w-4 h-4 fill-black" />
                  <span>Start Relinking</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSetMode('advanced')}
                  className="text-xs text-neutral-400 hover:text-white transition-colors"
                >
                  Customize settings in Advanced mode
                </button>
              </div>

            </div>
          )}

          {/* STATE 2: RUNNING (Unified Progress View) */}
          {executionState === 'running' && (
            <div className="flex items-start space-x-8 animate-fade-in py-2">
              <img
                src={selectedGame.iconUrl}
                alt={selectedGame.title}
                className="w-[165px] h-[220px] rounded-2xl object-cover shadow-2xl border border-white/10 shrink-0"
              />

              <div className="flex-1 min-w-0 pt-1 space-y-4 max-w-xl">
                <div>
                  <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider block mb-1">
                    Relinking in Progress
                  </span>
                  <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight truncate">
                    {selectedGame.title}
                  </h2>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-baseline text-xs">
                    <div>
                      <span className="text-sm font-bold text-white flex items-center space-x-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 inline" />
                        <span>{activeStepInfo.title}</span>
                      </span>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {activeStepInfo.description}
                      </p>
                    </div>
                    <span className="font-mono text-neutral-300 text-xs font-semibold">
                      Step {activeStepInfo.stepNumber} of 6 • {overallProgress}%
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-black/60 overflow-hidden border border-white/10">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 via-indigo-400 to-emerald-400 transition-all duration-300"
                      style={{ width: `${overallProgress}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-5 pt-1 text-xs">
                  <button
                    type="button"
                    onClick={handleCancelRelinking}
                    disabled={isCancelling}
                    className="text-neutral-400 hover:text-red-400 transition-colors font-medium"
                  >
                    {isCancelling ? 'Cancelling...' : 'Cancel process'}
                  </button>
                  <span className="text-neutral-700">•</span>
                  <button
                    type="button"
                    onClick={() => setShowLiveLogs(!showLiveLogs)}
                    className="text-neutral-400 hover:text-white transition-colors"
                  >
                    {showLiveLogs ? 'Hide technical logs' : 'View technical logs'}
                  </button>
                </div>

                {showLiveLogs && (
                  <div className="w-full text-left bg-black/80 rounded-xl p-4 border border-white/10 font-mono text-[11px] max-h-56 overflow-y-auto space-y-1 mt-2">
                    {logs.map((l, i) => (
                      <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : l.level === 'success' ? 'text-emerald-400' : 'text-neutral-400'}>
                        {l.message}
                      </div>
                    ))}
                    <div ref={terminalEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STATE 3: SUCCESS (Only after backend confirms completion) */}
          {executionState === 'success' && (
            <div className="flex items-start space-x-8 animate-fade-in py-2">
              <img
                src={selectedGame.iconUrl}
                alt={selectedGame.title}
                className="w-[165px] h-[220px] rounded-2xl object-cover shadow-2xl border border-white/10 shrink-0"
              />

              <div className="flex-1 min-w-0 pt-1 space-y-4 max-w-xl">
                <div>
                  <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider block mb-1 flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Relinking Complete</span>
                  </span>
                  <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight truncate">
                    {selectedGame.title} is Ready to Play
                  </h2>
                  <p className="text-xs text-neutral-300 mt-1">
                    {options.target === 'linux'
                      ? 'Converted to a native 64-bit Linux executable with Vulkan driver support.'
                      : 'Converted to a native 64-bit Windows executable with DirectX 12 & Vulkan driver support.'}
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block">
                    Native Output Location
                  </span>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 font-mono text-xs text-emerald-300 select-all break-all">
                    {selectedGame.path}{options.target === 'linux' ? '/app.elf' : '\\app.exe'}
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-4">
                  {onLaunchGame && (
                    <button
                      type="button"
                      onClick={() => {
                        audioService.playLaunch();
                        onLaunchGame(selectedGame);
                      }}
                      className="w-[200px] h-12 rounded-full bg-white text-black font-bold text-sm hover:bg-neutral-200 active:scale-[0.98] transition-all shadow-xl flex items-center justify-center space-x-2"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>Play Game Now</span>
                    </button>
                  )}

                  {onNavigateToGames && (
                    <button
                      type="button"
                      onClick={() => {
                        audioService.playNavTick();
                        onNavigateToGames();
                      }}
                      className="px-6 h-12 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors border border-white/10 flex items-center justify-center"
                    >
                      Back to Games Library
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      audioService.playNavTick();
                      setExecutionState('idle');
                    }}
                    className="text-xs text-neutral-400 hover:text-white transition-colors ml-2"
                  >
                    Relink again
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STATE 4: ERROR (On Failure) */}
          {executionState === 'error' && (
            <div className="flex items-start space-x-8 animate-fade-in py-2">
              <img
                src={selectedGame.iconUrl}
                alt={selectedGame.title}
                className="w-[165px] h-[220px] rounded-2xl object-cover shadow-2xl border border-red-500/30 shrink-0"
              />

              <div className="flex-1 min-w-0 pt-1 space-y-4 max-w-xl">
                <div>
                  <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider block mb-1 flex items-center space-x-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Relinking Halted</span>
                  </span>
                  <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight truncate">
                    Relinking Could Not Be Completed
                  </h2>
                  <p className="text-xs text-neutral-300 mt-1">
                    {errorMessage?.summary || 'The relinker pipeline encountered an issue.'}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/20 text-xs space-y-1.5">
                  <span className="font-semibold text-red-300 block">
                    Suggested Next Steps:
                  </span>
                  <p className="text-neutral-300 leading-relaxed whitespace-pre-line text-xs">
                    {errorMessage?.remedy || 'Check that game files are decrypted and not locked by another process.'}
                  </p>
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playNavTick();
                      setExecutionState('idle');
                      setErrorMessage(null);
                    }}
                    className="w-[180px] h-12 rounded-full bg-white text-black font-bold text-xs hover:bg-neutral-200 active:scale-[0.98] transition-all shadow-lg flex items-center justify-center"
                  >
                    Try Again
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      audioService.playNavTick();
                      handleSetMode('advanced');
                    }}
                    className="px-6 h-12 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors border border-white/10 flex items-center justify-center"
                  >
                    Open Advanced Mode
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowErrorLogs(!showErrorLogs)}
                    className="text-xs text-neutral-400 hover:text-white transition-colors ml-2"
                  >
                    {showErrorLogs ? 'Hide error logs' : 'View error logs'}
                  </button>
                </div>

                {showErrorLogs && (
                  <div className="w-full text-left bg-black/80 rounded-xl p-4 border border-red-500/20 font-mono text-[11px] max-h-56 overflow-y-auto space-y-1 mt-2">
                    {logs.map((l, i) => (
                      <div key={i} className={l.level === 'error' ? 'text-red-400 font-semibold' : 'text-neutral-400'}>
                        {l.message}
                      </div>
                    ))}
                    <div ref={terminalEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ============================================================== */}
      {/* ADVANCED MODE (Full Technical Controls for Developers)        */}
      {/* ============================================================== */}
      {mode === 'advanced' && (
        <div className="max-w-[1280px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0 animate-fade-in">
          
          {/* Left Column: Technical Controls */}
          <div className="lg:col-span-5 flex flex-col space-y-5">
            
            {/* Selected Game Picker */}
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3 min-w-0">
                <img
                  src={selectedGame.iconUrl}
                  alt={selectedGame.title}
                  className="w-8 h-8 rounded-lg object-cover"
                />
                <div className="truncate">
                  <span className="text-xs font-semibold text-white block truncate">{selectedGame.title}</span>
                  <span className="text-[10px] text-neutral-400 font-mono">{selectedGame.titleId}</span>
                </div>
              </div>
              <select
                value={selectedGame.id}
                onChange={(e) => {
                  const found = games.find(g => g.id === e.target.value);
                  if (found) {
                    audioService.playNavTick();
                    setSelectedGame(found);
                  }
                }}
                className="bg-black/60 text-white text-xs rounded-lg px-2 py-1 border border-white/10"
              >
                {games.map(g => (
                  <option key={g.id} value={g.id} className="bg-[#0b0e14] text-white">
                    {g.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Technical Options Box */}
            <div className="space-y-4 bg-white/[0.02] p-4 rounded-xl border border-white/10">
              
              {/* Target OS */}
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  Target Executable Format
                  <span className="text-[10px] text-neutral-500 font-mono ml-2">(--windows / --macos)</span>
                </label>
                <div className="grid grid-cols-3 gap-1.5 bg-black/40 p-1 rounded-xl border border-white/10">
                  {(['windows', 'linux', 'macos'] as const).map(target => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => {
                        audioService.playNavTick();
                        setOptions(o => ({ ...o, target }));
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${
                        options.target === target
                          ? 'bg-white text-black shadow font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {target === 'windows' ? 'Windows (.exe)' : target === 'linux' ? 'Linux (.elf)' : 'macOS'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subsystem (Windows only) */}
              {options.target === 'windows' && (
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">
                    Windows Subsystem
                    <span className="text-[10px] text-neutral-500 font-mono ml-2">(--windows-gui)</span>
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 bg-black/40 p-1 rounded-xl border border-white/10">
                    <button
                      type="button"
                      onClick={() => {
                        audioService.playNavTick();
                        setOptions(o => ({ ...o, subsystem: 'gui' }));
                      }}
                      className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-colors ${
                        options.subsystem === 'gui'
                          ? 'bg-white text-black shadow font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      Clean Window (GUI)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        audioService.playNavTick();
                        setOptions(o => ({ ...o, subsystem: 'console' }));
                      }}
                      className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-colors ${
                        options.subsystem === 'console'
                          ? 'bg-white text-black shadow font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      Console Subsystem
                    </button>
                  </div>
                </div>
              )}

              {/* CPU Codegen Translation */}
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  CPU Codegen Instruction Lowering
                  <span className="text-[10px] text-neutral-500 font-mono ml-2">(--to-intel / --to-rosetta)</span>
                </label>
                <div className="grid grid-cols-3 gap-1.5 bg-black/40 p-1 rounded-xl border border-white/10">
                  {(['none', 'intel', 'rosetta'] as const).map(cpu => (
                    <button
                      key={cpu}
                      type="button"
                      onClick={() => {
                        audioService.playNavTick();
                        setOptions(o => ({ ...o, cpuTranslation: cpu }));
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${
                        options.cpuTranslation === cpu
                          ? 'bg-white text-black shadow font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {cpu === 'none' ? 'AMD Zen2' : cpu === 'intel' ? 'Intel AVX2' : 'Rosetta 2'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Unused Import Optimization */}
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  Unused Import Optimization
                  <span className="text-[10px] text-neutral-500 font-mono ml-2">(unused-filter=0|1|2)</span>
                </label>
                <div className="grid grid-cols-3 gap-1.5 bg-black/40 p-1 rounded-xl border border-white/10">
                  {[0, 1, 2].map(level => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        audioService.playNavTick();
                        setOptions(o => ({ ...o, unusedFilter: level as 0 | 1 | 2 }));
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors ${
                        options.unusedFilter === level
                          ? 'bg-white text-black shadow font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      Level {level} {level === 0 ? '(Safe / Recommended)' : level === 1 ? '(Standard)' : '(Strict)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Runtime Engine Selection */}
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  Runtime Engine / Relinker Version
                  <span className="text-[10px] text-neutral-500 font-mono ml-2">(runtime-engine)</span>
                </label>
                <select
                  value={options.runtimeId || selectedGame.runtimeId || 'inherit'}
                  onChange={(e) => {
                    audioService.playNavTick();
                    const val = e.target.value;
                    setOptions(o => ({ ...o, runtimeId: val === 'inherit' ? undefined : val }));
                  }}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-white/30"
                >
                  <option value="inherit" className="bg-[#080b11] text-white">
                    Inherit Global Default
                  </option>
                  {availableRuntimes.map(rt => (
                    <option key={rt.id} value={rt.id} className="bg-[#080b11] text-white">
                      {rt.name} ({rt.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Diagnostics & Call Tracing */}
              <div className="pt-2 border-t border-white/5 space-y-2 text-xs text-neutral-300">
                {options.target === 'windows' ? (
                  <>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.windowsDiagnostics}
                        onChange={(e) => setOptions(o => ({ ...o, windowsDiagnostics: e.target.checked }))}
                        className="rounded bg-black border-white/20 text-white focus:ring-0"
                      />
                      <span>Startup diagnostics (--windows-diagnostics)</span>
                    </label>

                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.traceImports}
                        onChange={(e) => setOptions(o => ({ ...o, traceImports: e.target.checked }))}
                        className="rounded bg-black border-white/20 text-white focus:ring-0"
                      />
                      <span>Call tracing (--trace-imports)</span>
                    </label>
                  </>
                ) : (
                  <div className="text-[11px] text-neutral-500 font-mono italic">
                    Linux Target: Native ELF dynamic linking with $ORIGIN/libs RPATH
                  </div>
                )}
              </div>

            </div>

            {/* Run / Cancel Button in Advanced Mode */}
            <div className="pt-1">
              {executionState !== 'running' ? (
                <button
                  type="button"
                  onClick={handleStartRelinking}
                  className="w-full py-3.5 rounded-full font-bold text-xs bg-white text-black hover:bg-neutral-200 transition-all shadow-md flex items-center justify-center space-x-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Start Relinking Process</span>
                </button>
              ) : (
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled
                    className="flex-1 py-3.5 rounded-full bg-neutral-800 text-neutral-300 font-semibold text-xs flex items-center justify-center space-x-2"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                    <span>Executing Relinker...</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRelinking}
                    disabled={isCancelling}
                    className="px-4 py-3.5 rounded-full bg-red-500/20 text-red-300 hover:bg-red-500/30 text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: 8-Stage Pipeline & Live Terminal */}
          <div className="lg:col-span-7 flex flex-col space-y-5">
            
            {/* 8-Stage Grid */}
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
              <span className="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold block mb-2.5">
                Compiler Stages (8-Step Pipeline)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {technicalStages.map((st) => (
                  <div
                    key={st.id}
                    className={`p-2 rounded-xl text-left transition-colors border ${
                      st.status === 'completed'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : st.status === 'active'
                        ? 'bg-white/10 border-white text-white'
                        : 'bg-black/20 border-white/5 text-neutral-500'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] font-mono">0{st.id}</span>
                      {st.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      {st.status === 'active' && <Loader2 className="w-3 h-3 animate-spin text-white" />}
                    </div>
                    <p className="text-[11px] font-medium truncate">{st.title}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Terminal Stream */}
            <div className="flex-1 bg-black/80 rounded-2xl p-4 border border-white/10 flex flex-col min-h-[300px]">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 text-xs font-mono text-neutral-400">
                <div className="flex items-center space-x-2">
                  <Terminal className="w-3.5 h-3.5 text-neutral-300" />
                  <span>relinker stdout</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  className="hover:text-white transition-colors"
                >
                  Clear
                </button>
              </div>

              <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1.5 pr-2 max-h-[320px]">
                {logs.map((log, idx) => (
                  <div key={idx} className="flex items-start space-x-2">
                    <span className="text-neutral-600 text-[10px] select-none font-mono">[{log.timestamp}]</span>
                    <span
                      className={`${
                        log.level === 'error'
                          ? 'text-red-400'
                          : log.level === 'warn'
                          ? 'text-amber-400'
                          : log.level === 'success'
                          ? 'text-emerald-400 font-semibold'
                          : 'text-neutral-300'
                      }`}
                    >
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </div>
            </div>

          </div>

        </div>
      )}

    </div>
  );
};
