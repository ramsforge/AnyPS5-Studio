import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play,
  Square,
  RefreshCw,
  X,
  Terminal,
  ChevronDown,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Wrench,
  Gamepad2,
  Cpu,
  Layers,
  Activity,
  GitPullRequest
} from 'lucide-react';
import { GameItem, SystemTelemetry, PlaygoOverrideInfo, PlaygoMode } from '../types';
import { audioService } from '../services/audioService';
import { apiBridge } from '../services/apiBridge';

interface GameLauncherModalProps {
  game: GameItem;
  onClose: () => void;
  onNavigateToRelinker?: (game: GameItem) => void;
  onNavigateToCommunityPRs?: (keyword?: string) => void;
}

type LaunchState = 'launching' | 'running' | 'closed' | 'crashed' | 'failed';

interface ErrorDetails {
  summary: string;
  remedy?: string;
  isRelinkHint?: boolean;
}

export const GameLauncherModal: React.FC<GameLauncherModalProps> = ({ 
  game, 
  onClose,
  onNavigateToRelinker,
  onNavigateToCommunityPRs
}) => {
  const [launchState, setLaunchState] = useState<LaunchState>('launching');
  const [statusMessage, setStatusMessage] = useState<string>('Initializing runtime environment...');
  const [errorMessage, setErrorMessage] = useState<ErrorDetails | null>(null);
  const [detectedAbortReason, setDetectedAbortReason] = useState<string | null>(null);

  const [pid, setPid] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [exitCodeHex, setExitCodeHex] = useState<string | null>(null);

  const [logs, setLogs] = useState<string[]>([]);
  const [pipelinesCount, setPipelinesCount] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [gamepadConnected, setGamepadConnected] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [playgoInfo, setPlaygoInfo] = useState<PlaygoOverrideInfo | null>(null);
  const [isUpdatingPlaygo, setIsUpdatingPlaygo] = useState<boolean>(false);
  const [playgoNotice, setPlaygoNotice] = useState<string | null>(null);

  useEffect(() => {
    if (game.titleId) {
      apiBridge.getPlaygoOverride(game.titleId).then((info) => {
        setPlaygoInfo(info);
      }).catch(() => {});
    }
  }, [game.titleId]);

  const handleSetPlaygoMode = async (mode: PlaygoMode) => {
    if (!game.titleId || isUpdatingPlaygo) return;
    setIsUpdatingPlaygo(true);
    audioService.playNavTick();
    try {
      await apiBridge.setPlaygoOverride(game.titleId, mode);
      const updated = await apiBridge.getPlaygoOverride(game.titleId);
      if (updated) {
        setPlaygoInfo(updated);
      }
      setPlaygoNotice(`PlayGo unlisted chunks set to ${mode === 'default' ? 'Default' : `"${mode}"`}. Click "Play Again" to restart.`);
    } catch (err: any) {
      setPlaygoNotice(`Failed to update PlayGo setting: ${err?.message || err}`);
    } finally {
      setIsUpdatingPlaygo(false);
    }
  };

  const userRequestedStopRef = useRef<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef<boolean>(true);

  // Auto-scroll logs when expanded
  useEffect(() => {
    if (showTechnicalDetails && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, showTechnicalDetails]);

  // Load telemetry for technical details drawer
  useEffect(() => {
    apiBridge.getTelemetry().then((tel) => {
      if (isMountedRef.current) setTelemetry(tel);
    }).catch(() => {});
  }, []);

  // Poll controller connection unobtrusively
  useEffect(() => {
    const checkGamepad = () => {
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      setGamepadConnected(Boolean(gps && gps[0]));
    };
    checkGamepad();
    const interval = setInterval(checkGamepad, 2000);
    return () => clearInterval(interval);
  }, []);

  // Track session duration while game is actively running
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (launchState === 'running') {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [launchState]);

  // Handle process termination (clean vs crash)
  const handleProcessExit = useCallback((code: number | null, hex: string | null, signal?: string | null) => {
    if (!isMountedRef.current) return;

    setPid(null);
    setExitCode(code);
    const resolvedHex = hex || (code !== null ? '0x' + (code >>> 0).toString(16).toUpperCase() : (signal || 'null'));
    setExitCodeHex(resolvedHex);

    if (userRequestedStopRef.current) {
      setLaunchState('closed');
      setStatusMessage('Game session was stopped');
      setErrorMessage(null);
      return;
    }

    if (code === 0 && !signal) {
      setLaunchState('closed');
      setStatusMessage('Game session ended normally');
      setErrorMessage(null);
    } else {
      setLaunchState('crashed');
      if (code === 3221225477 || code === -1073741819 || signal === 'SIGSEGV' || code === 11 || code === 139) {
        setDetectedAbortReason((prev) => prev || 'Access Violation / SIGSEGV');
        setErrorMessage({
          summary: 'The game closed unexpectedly',
          remedy: 'A memory access violation (SIGSEGV / 0xC0000005) occurred. In Relinker Studio, verify that "Unused Import Optimization" is set to Level 0 (Safe / Full Compatibility) so virtual tables and C++ error categories are not stripped.',
          isRelinkHint: true,
        });
      } else if (code === 3221225781 || code === -1073741515) {
        setDetectedAbortReason((prev) => prev || 'Missing PRX Dependency (0xC0000135)');
        setErrorMessage((prev) => {
          if (prev && prev.remedy && (prev.remedy.includes('fakelib') || prev.remedy.includes('module'))) return prev;
          return {
            summary: 'The game closed unexpectedly',
            remedy: 'A required guest PRX or runtime dependency (0xC0000135) could not be loaded. Ensure the game folder was relinked with all middleware modules.',
            isRelinkHint: true,
          };
        });
      } else if (code === 3221225785 || code === -1073741511) {
        setDetectedAbortReason((prev) => (prev && prev !== 'unresolved' ? prev : 'Unresolved Import (0xC0000139)'));
        setErrorMessage((prev) => {
          if (prev && prev.remedy && prev.remedy.includes('symbol')) return prev;
          return {
            summary: 'Unresolved Function / Symbol Import (0xC0000139)',
            remedy: 'A required native function or symbol was not exported by the loaded PRX modules. In Relinker Studio, verify system libraries and middleware stubs.',
            isRelinkHint: true,
          };
        });
      } else if (code === 3221226505 || code === -1073740791 || signal === 'SIGABRT' || code === 6 || code === 134) {
        setDetectedAbortReason((prev) => (prev && prev !== 'unresolved' ? prev : 'Process Abort / Exception (SIGABRT)'));
        setErrorMessage((prev) => {
          if (prev && prev.remedy && prev.remedy.length > 0) return prev;
          return {
            summary: 'Process Terminated via Abort (SIGABRT / 0xC0000409)',
            remedy: 'The application encountered an unhandled C++ exception or abort() call during execution. Check Execution Logs below for the runtime error trace.',
            isRelinkHint: false,
          };
        });
      } else if (signal === 'SIGILL' || code === 4 || code === 132) {
        setDetectedAbortReason((prev) => prev || 'Illegal Instruction (SIGILL)');
        setErrorMessage({
          summary: 'Illegal Instruction (SIGILL / 4)',
          remedy: 'Host CPU or VM lacks required CPU extensions (AVX2, F16C, BMI2) or executed an unhandled instruction. Verify CPU virtualization flags in VMware.',
          isRelinkHint: false,
        });
      } else if (signal === 'SIGBUS' || code === 7 || code === 135) {
        setDetectedAbortReason((prev) => prev || 'Bus Error (SIGBUS)');
        setErrorMessage({
          summary: 'Bus Error (SIGBUS / 7)',
          remedy: 'A memory alignment fault or invalid host page access occurred.',
          isRelinkHint: false,
        });
      } else if (code === 127 || resolvedHex === '0x7F') {
        setDetectedAbortReason((prev) => prev || 'Dynamic Linker Error (0x7F / 127)');
        setErrorMessage((prev) => {
          if (prev && prev.remedy && prev.remedy.length > 0) return prev;
          return {
            summary: 'Dynamic Linker Error (0x7F / 127)',
            remedy: 'A required shared library or symbol could not be loaded by Linux ld.so. Check the Technical Details log for the missing library or click Relink to rebuild app.elf against the active PRX runtime.',
            isRelinkHint: true,
          };
        });
      } else {
        setDetectedAbortReason((prev) => prev || `Process Exit (${resolvedHex})`);
        setErrorMessage({
          summary: 'The game closed unexpectedly',
          remedy: `Process exited with error code ${resolvedHex}${signal ? ` (signal ${signal})` : ''}. Inspect Technical Details below for complete crash diagnostics.`,
          isRelinkHint: false,
        });
      }
      setShowTechnicalDetails(true);
      audioService.playCancel();
    }
  }, []);

  const isLaunchingRef = useRef<boolean>(false);

  // Launch the actual game process
  const launchGameProcess = useCallback(async (targetGame: GameItem) => {
    if (isLaunchingRef.current) return;
    isLaunchingRef.current = true;

    setLaunchState('launching');
    setStatusMessage('Starting native 64-bit executable...');
    setErrorMessage(null);
    setDetectedAbortReason(null);
    setExitCode(null);
    setExitCodeHex(null);
    setElapsedSeconds(0);
    setPlaygoNotice(null);
    userRequestedStopRef.current = false;

    setLogs([
      `[AnyPS5] Launching native ported executable: ${targetGame.path}/${targetGame.executableName || 'app.exe'}`,
      `[AnyPS5] Checking runtime layout: libs/ system PRX and app0/ guest filesystem...`,
    ]);

    audioService.playLaunch();

    try {
      const res = await apiBridge.launchGame(targetGame);
      if (!isMountedRef.current) return;

      if (res.error) {
        setLaunchState('failed');
        const isMissingExe = res.error.toLowerCase().includes('not found') || res.error.toLowerCase().includes('relink');
        setErrorMessage({
          summary: "The game couldn't start",
          remedy: res.error,
          isRelinkHint: isMissingExe,
        });
        audioService.playCancel();
        setLogs((prev) => [...prev, `[AnyPS5 Error] ${res.error}`]);
      } else if (res.pid) {
        setPid(res.pid);
        setLaunchState('running');
        setStatusMessage('Game running');
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setLaunchState('failed');
      setErrorMessage({
        summary: "The game couldn't start",
        remedy: err?.message || 'An unexpected error occurred while launching the executable.',
        isRelinkHint: false,
      });
      audioService.playCancel();
    } finally {
      isLaunchingRef.current = false;
    }
  }, []);

  // Initial launch and event subscriptions
  useEffect(() => {
    isMountedRef.current = true;

    // Direct IPC exit event listener
    const unsubscribeExit = apiBridge.onGameExit?.((data) => {
      handleProcessExit(data.code, data.exitCodeHex, data.signal);
    }) || (() => {});

    // Live log stream listener
    const unsubscribeLog = apiBridge.onGameLog((log) => {
      if (!isMountedRef.current) return;
      setLogs((prev) => [...prev.slice(-400), log.message]);

      const msg = log.message;

      // Extract real startup progression
      if (msg.includes('Checking runtime layout')) {
        setStatusMessage('Verifying runtime layout and libraries...');
      } else if (msg.includes('Launching native ported executable')) {
        setStatusMessage('Starting 64-bit native executable...');
      } else if (msg.includes('Initialized child process PID')) {
        setLaunchState('running');
        setStatusMessage('Game running');
      }

      // Parse unresolved ELF import explicitly (e.g. "FAIL: unresolved ELF import <name> from <lib>")
      if (msg.includes('unresolved ELF import')) {
        const match = msg.match(/FAIL:\s*unresolved\s+ELF\s+import\s+([^\r\n]+)/i);
        if (match && match[1]) {
          const rawSymbol = match[1].trim();
          setDetectedAbortReason(rawSymbol);
          setErrorMessage({
            summary: 'Unresolved Function Import (0xC0000139)',
            remedy: `The ported binary requires symbol "${rawSymbol}", which was not exported by the loaded PRX.`,
            isRelinkHint: true,
          });
        }
      } else {
        // Parse abort reason, C++ exception what(), or missing symbols
        const failMatch = msg.match(/(?:Exception|what\(\)|Abort|Unimplemented|Missing):\s*([^\r\n]+)/i);
        if (failMatch && failMatch[1]) {
          const reason = failMatch[1].trim();
          if (reason) {
            setDetectedAbortReason(reason);
            if (reason.toLowerCase().includes('not implemented')) {
              setErrorMessage({
                summary: 'Unimplemented PlayStation 5 API',
                remedy: `The title attempted to call "${reason}", which has not yet been implemented in AnyPS5 system libraries. Check Community PRs below for potential fixes.`,
                isRelinkHint: false,
              });
            }
          }
        }
      }

      // Parse Vulkan initialization failure
      if (msg.includes('No compatible Vulkan') || msg.includes('no Vulkan 1.1') || msg.includes('Vulkan: no usable device')) {
        setDetectedAbortReason('Vulkan Initialization Failed');
        setErrorMessage({
          summary: 'Vulkan Initialization Failed',
          remedy: 'No compatible Vulkan 1.1 physical device detected. In VMware, verify "Accelerate 3D graphics" is enabled in Virtual Machine Settings -> Display. On Linux/CachyOS, ensure Vulkan ICD drivers (vulkan-radeon, vulkan-intel, or vulkan-swrast) are installed.',
          isRelinkHint: false,
        });
      }

      // Parse module load failure from PE loader stub
      if (msg.includes('Failed to load module:')) {
        const match = msg.match(/Failed to load module:\s*([^\r\n]+)/i);
        const modPath = match ? match[1].trim() : '';
        const modName = modPath.split(/[\\/]/).pop() || 'Unknown Module';
        if (modPath.toLowerCase().includes('fakelib')) {
          setDetectedAbortReason('Legacy fakelib stub');
          setErrorMessage({
            summary: 'Legacy dump stubs detected (fakelib)',
            remedy: 'This game was previously linked with legacy dump stubs (fakelib). Click "Relinker Studio" below to rebuild with AnyPS5 native system libraries.',
            isRelinkHint: true,
          });
        } else {
          setDetectedAbortReason(`Missing: ${modName}`);
          setErrorMessage({
            summary: 'Missing required module',
            remedy: `Could not load module "${modName}". In Relinker Studio, verify all required guest modules and system PRXs are deployed.`,
            isRelinkHint: true,
          });
        }
      }

      // Detect Linux ld.so missing library errors
      const linuxMissingLibMatch = msg.match(/error while loading shared libraries:\s*([^:]+):\s*cannot open shared object file/i);
      if (linuxMissingLibMatch && linuxMissingLibMatch[1]) {
        const missingLib = linuxMissingLibMatch[1].trim();
        setDetectedAbortReason(`Missing Host Library: ${missingLib}`);
        setErrorMessage({
          summary: `Missing Host Library: ${missingLib}`,
          remedy: `Linux dynamic linker could not locate "${missingLib}". Install the missing host package via your system package manager (e.g., pacman on Arch/CachyOS or apt on Ubuntu/Debian).`,
          isRelinkHint: false,
        });
      }

      // Detect Linux ld.so undefined symbol errors
      const linuxUndefSymbolMatch = msg.match(/symbol lookup error:\s*([^:]+):\s*undefined symbol:\s*([^\r\n]+)/i);
      if (linuxUndefSymbolMatch && linuxUndefSymbolMatch[2]) {
        const symbol = linuxUndefSymbolMatch[2].trim();
        setDetectedAbortReason(`Undefined Symbol: ${symbol}`);
        setErrorMessage({
          summary: `Undefined Symbol: ${symbol}`,
          remedy: `Linux dynamic linker encountered an undefined symbol "${symbol}". Re-compile the game in Relinker Studio to align with the active PRX runtime.`,
          isRelinkHint: true,
        });
      }

      if (msg.includes('sce_sys/playgo-chunk.dat and sce_sys/playgo-scenario.json are missing') || msg.includes('APS5_PLAYGO_UNLISTED_CHUNKS=installed or =absent')) {
        setDetectedAbortReason('Missing PlayGo Metadata');
        setErrorMessage({
          summary: 'PlayGo Metadata Missing',
          remedy: 'The game dump lacks PlayGo chunk manifests (playgo-chunk.dat / playgo-scenario.json). Configure PlayGo Unlisted Chunks below: select "installed" for titles requiring full chunks, or "absent" for titles searching chunk bounds.',
          isRelinkHint: false,
        });
      }

      if (msg.includes('Ran out of memory allocating') && (game.titleId === 'PPSA03490' || playgoInfo?.effective === 'installed')) {
        setDetectedAbortReason('PlayGo Allocation Overflow');
        setErrorMessage({
          summary: 'PlayGo Allocation Overflow',
          remedy: 'The title searched for chunk boundaries indefinitely and exhausted memory because unlisted chunks was set to "installed". Change PlayGo mode to "absent" below to terminate the search walk.',
          isRelinkHint: false,
        });
      }

      // Vulkan pipeline counter
      if (msg.includes('cached SPIR-V pipeline')) {
        const match = msg.match(/(\d+)\s+cached SPIR-V pipeline/);
        if (match) setPipelinesCount(parseInt(match[1]));
      }
    });

    launchGameProcess(game);

    return () => {
      isMountedRef.current = false;
      unsubscribeExit();
      unsubscribeLog();
    };
  }, [game.id, handleProcessExit, launchGameProcess]);

  // Closing the launcher while the game runs stops it: once the launcher is gone nothing tracks the process,
  // and the next launch would end it without warning anyway.
  const handleClose = async () => {
    if (launchState === 'running' || launchState === 'launching') {
      userRequestedStopRef.current = true;
      await apiBridge.stopGame(pid || undefined);
    }
    onClose();
  };

  // Handle Stop button click
  const handleStop = async () => {
    audioService.playCancel();
    userRequestedStopRef.current = true;
    await apiBridge.stopGame(pid || undefined);
    setLaunchState('closed');
    setStatusMessage('Game session was stopped');
  };

  // Format active playtime
  const formatPlaytime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins.toString().padStart(2, '0')}m`;
  };

  // Copy full diagnostics report to clipboard
  const handleCopyDiagnostics = () => {
    audioService.playConfirm();
    const report = [
      `======================================================`,
      `AnyPS5 Studio - Game Launch Diagnostics Report`,
      `Generated: ${new Date().toLocaleString()}`,
      `======================================================`,
      `Game Title:       ${game.title}`,
      `Title ID:         ${game.titleId}`,
      `SDK Version:      ${game.sdkVersion || 'Prospero'}`,
      `Executable:       ${game.path}/${game.executableName || 'app.exe'}`,
      `Status:           ${launchState.toUpperCase()}`,
      `Process ID (PID): ${pid ?? 'Not running'}`,
      `Exit Code:        ${exitCode !== null ? `${exitCode} (${exitCodeHex})` : 'N/A'}`,
      `Active Playtime:  ${formatPlaytime(elapsedSeconds)}`,
      `Vulkan Pipelines: ${pipelinesCount !== null ? pipelinesCount : 'Standard / Uncached'}`,
      `Controller:       ${gamepadConnected ? 'DualSense / Gamepad Active' : 'Keyboard / Mouse'}`,
      `Host CPU:         ${telemetry?.hostCpu || 'Verified'}`,
      `Host Graphics:    ${telemetry?.gpuName || 'DirectX 12 / Vulkan'}`,
      `Operating System: ${telemetry?.osName || 'Windows x64'}`,
      ``,
      `------------------------------------------------------`,
      `Execution Logs (${logs.length} entries):`,
      `------------------------------------------------------`,
      ...logs,
      `======================================================`,
    ].join('\n');

    navigator.clipboard.writeText(report).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-md animate-fade-in select-none">
      <div className="relative w-full max-w-2xl bg-[#0b0e14]/95 rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] bg-white/[0.02]">
          <div className="flex items-center space-x-2.5">
            <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
            <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              AnyPS5 Launcher
            </span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            title={launchState === 'running' ? 'Stop game and close' : 'Close Launcher'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Primary User-Friendly Content View */}
        <div className="p-6 md:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6 md:gap-7">
          
          {/* Cover Artwork */}
          <div className="shrink-0 relative group">
            <img
              src={game.iconUrl}
              alt={game.title}
              className="w-36 h-48 md:w-44 md:h-56 rounded-2xl object-cover shadow-2xl border border-white/10 bg-neutral-900"
              onError={(e) => {
                // Subtle fallback if image fails
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>

          {/* Details & Actions */}
          <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch text-center sm:text-left space-y-4">
            
            {/* Title & Metadata */}
            <div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-snug line-clamp-2">
                {game.title}
              </h2>
              <div className="flex items-center justify-center sm:justify-start space-x-2.5 mt-1 text-xs text-neutral-400 font-mono">
                <span>{game.titleId}</span>
                <span>•</span>
                <span>
                  {game.targetPlatform === 'linux' || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux'))
                    ? 'Native 64-bit Linux (ELF)'
                    : 'Native 64-bit Windows'}
                </span>
              </div>
            </div>

            {/* Status Section */}
            <div className="space-y-1.5 py-1">
              
              {/* STATE: LAUNCHING */}
              {launchState === 'launching' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-center sm:justify-start space-x-2">
                    <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                    <span className="text-base font-semibold text-white">Launching game...</span>
                  </div>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    {statusMessage}
                  </p>
                </div>
              )}

              {/* STATE: RUNNING */}
              {launchState === 'running' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-center sm:justify-start space-x-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)] shrink-0" />
                    <span className="text-base font-semibold text-white">Game running</span>
                  </div>
                  <p className="text-xs text-neutral-400 leading-relaxed font-mono">
                    Active session · Elapsed: {formatPlaytime(elapsedSeconds)}
                  </p>
                </div>
              )}

              {/* STATE: EXITED NORMALLY */}
              {launchState === 'closed' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-center sm:justify-start space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-neutral-400 shrink-0" />
                    <span className="text-base font-semibold text-white">Game closed</span>
                  </div>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    The game session has ended normally.
                  </p>
                </div>
              )}

              {/* STATE: CRASHED */}
              {launchState === 'crashed' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-center sm:justify-start space-x-2 text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="text-base font-semibold text-white">The game closed unexpectedly</span>
                  </div>
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    {errorMessage?.remedy || 'The game process exited abnormally. Check technical details below for more information.'}
                  </p>
                </div>
              )}

              {/* STATE: FAILED TO START */}
              {launchState === 'failed' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-center sm:justify-start space-x-2 text-rose-400">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="text-base font-semibold text-white">The game couldn't start</span>
                  </div>
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    {errorMessage?.remedy || 'Could not initialize the executable. Check technical details below.'}
                  </p>
                </div>
              )}

              {/* Abort Reason Diagnostics Card */}
              {detectedAbortReason && (launchState === 'crashed' || launchState === 'failed') && (
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-between text-xs animate-fade-in">
                  <div className="flex items-center space-x-2">
                    <GitPullRequest className="w-3.5 h-3.5 text-[#00a2ff] shrink-0" />
                    <span className="text-white/60">
                      {detectedAbortReason.toLowerCase().includes('not implemented') ? 'Unimplemented PS5 API:' : 'Abort Exception:'}
                    </span>
                    <span className="font-mono text-blue-300 font-semibold">{detectedAbortReason}</span>
                  </div>
                  {errorMessage?.isRelinkHint && onNavigateToRelinker ? (
                    <button
                      type="button"
                      onClick={() => onNavigateToRelinker(game)}
                      className="text-amber-400 hover:text-amber-300 underline font-semibold text-[11px] ml-2 shrink-0"
                    >
                      Relink in Studio &rarr;
                    </button>
                  ) : onNavigateToCommunityPRs ? (
                    <button
                      type="button"
                      onClick={() => onNavigateToCommunityPRs(detectedAbortReason)}
                      className="text-blue-400 hover:text-blue-300 underline font-medium text-[11px] ml-2 shrink-0"
                    >
                      Find PR Fixes &rarr;
                    </button>
                  ) : null}
                </div>
              )}

              {(detectedAbortReason?.includes('PlayGo') || errorMessage?.summary?.includes('PlayGo') || Boolean(playgoInfo?.custom)) && (launchState === 'crashed' || launchState === 'failed') && (
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-2 animate-fade-in text-left">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="text-xs font-semibold text-white">
                        PlayGo Unlisted Chunks Configuration
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-neutral-400">
                      Active: <span className="text-sky-300 font-semibold">{playgoInfo?.effective || 'Unset (Error)'}</span>
                      {playgoInfo?.preset && !playgoInfo?.custom && (
                        <span className="text-neutral-500 ml-1">(Preset)</span>
                      )}
                      {playgoInfo?.custom && (
                        <span className="text-emerald-400 ml-1">(Custom)</span>
                      )}
                    </span>
                  </div>

                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    Select how unlisted chunk IDs are handled when chunk manifests are missing:
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={isUpdatingPlaygo}
                      onClick={() => handleSetPlaygoMode('installed')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        playgoInfo?.effective === 'installed'
                          ? 'bg-blue-600 text-white font-semibold shadow-sm'
                          : 'bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10'
                      }`}
                    >
                      Report Installed
                    </button>

                    <button
                      type="button"
                      disabled={isUpdatingPlaygo}
                      onClick={() => handleSetPlaygoMode('absent')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        playgoInfo?.effective === 'absent'
                          ? 'bg-blue-600 text-white font-semibold shadow-sm'
                          : 'bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10'
                      }`}
                    >
                      Report Absent
                    </button>

                    <button
                      type="button"
                      disabled={isUpdatingPlaygo}
                      onClick={() => handleSetPlaygoMode('default')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        !playgoInfo?.custom
                          ? 'bg-white/15 text-white'
                          : 'bg-white/5 hover:bg-white/10 text-neutral-400 border border-white/10'
                      }`}
                    >
                      Reset to Default
                    </button>
                  </div>

                  {playgoNotice && (
                    <p className="text-[11px] text-emerald-400 leading-normal animate-fade-in font-medium">
                      {playgoNotice}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-3">
              
              {/* While Launching */}
              {launchState === 'launching' && (
                <>
                  <button
                    disabled
                    type="button"
                    className="px-6 py-2.5 rounded-full bg-white/20 text-neutral-400 font-semibold text-xs flex items-center space-x-2 cursor-not-allowed shadow-none"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Launching...</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors"
                  >
                    Back to Library
                  </button>
                </>
              )}

              {/* While Running */}
              {launchState === 'running' && (
                <>
                  <button
                    type="button"
                    onClick={handleStop}
                    className="px-6 py-2.5 rounded-full bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 font-semibold text-xs transition-all active:scale-[0.98] flex items-center space-x-2"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop Game</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors"
                  >
                    Back to Library
                  </button>
                </>
              )}

              {/* When Closed Normally */}
              {launchState === 'closed' && (
                <>
                  <button
                    type="button"
                    onClick={() => launchGameProcess(game)}
                    className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-all active:scale-[0.98] shadow-lg flex items-center space-x-2"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play Again</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors"
                  >
                    Back to Library
                  </button>
                </>
              )}

              {/* When Crashed or Failed */}
              {(launchState === 'crashed' || launchState === 'failed') && (
                <>
                  <button
                    type="button"
                    onClick={() => launchGameProcess(game)}
                    className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-all active:scale-[0.98] shadow-lg flex items-center space-x-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Try Again</span>
                  </button>

                  {errorMessage?.isRelinkHint && onNavigateToRelinker && (
                    <button
                      type="button"
                      onClick={() => onNavigateToRelinker(game)}
                      className="px-5 py-2.5 rounded-full bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 font-medium text-xs transition-colors flex items-center space-x-2"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Relinker Studio</span>
                    </button>
                  )}

                  {onNavigateToCommunityPRs && (
                    <button
                      type="button"
                      onClick={() => onNavigateToCommunityPRs(detectedAbortReason || undefined)}
                      className="px-5 py-2.5 rounded-full bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 font-medium text-xs transition-colors flex items-center space-x-2"
                      title="Find community PR patches and experimental builds"
                    >
                      <GitPullRequest className="w-3.5 h-3.5" />
                      <span>Community Fixes</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors"
                  >
                    Back to Library
                  </button>
                </>
              )}
            </div>

          </div>
        </div>

        {/* Collapsible Technical Details Section */}
        <div className="border-t border-white/[0.07] bg-black/40">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="flex items-center justify-between w-full px-6 py-3.5 text-xs text-neutral-400 hover:text-white transition-colors"
          >
            <span className="font-medium flex items-center space-x-2">
              <Terminal className="w-3.5 h-3.5 text-neutral-500" />
              <span>Technical Details</span>
            </span>
            <ChevronDown 
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showTechnicalDetails ? 'rotate-180 text-white' : 'text-neutral-500'
              }`} 
            />
          </button>

          {showTechnicalDetails && (
            <div className="px-6 pb-6 pt-1 space-y-4 animate-fade-in">
              
              {/* Telemetry & Process Summary Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-[11px]">
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5">
                  <span className="text-neutral-500 block text-[10px] uppercase">Process ID</span>
                  <span className="text-neutral-200 font-semibold">{pid ?? 'Inactive'}</span>
                </div>

                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5">
                  <span className="text-neutral-500 block text-[10px] uppercase">Exit Code</span>
                  <span className={`font-semibold ${
                    exitCode === 0 ? 'text-emerald-400' : exitCode !== null ? 'text-rose-400' : 'text-neutral-400'
                  }`}>
                    {exitCode !== null ? `${exitCode} (${exitCodeHex})` : launchState === 'running' ? 'Active' : 'N/A'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5">
                  <span className="text-neutral-500 block text-[10px] uppercase">Vulkan Cache</span>
                  <span className="text-neutral-200 font-semibold">
                    {pipelinesCount !== null ? `${pipelinesCount} pipelines` : 'DirectX 12 / Vulkan'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5">
                  <span className="text-neutral-500 block text-[10px] uppercase">Controller</span>
                  <span className={`font-semibold ${gamepadConnected ? 'text-emerald-400' : 'text-neutral-400'}`}>
                    {gamepadConnected ? 'DualSense Active' : 'Keyboard / Mouse'}
                  </span>
                </div>
              </div>

              {/* Console Logs Header with Copy Diagnostics */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-mono text-neutral-400">
                  Process Standard Output & PRX Diagnostics
                </span>

                <button
                  type="button"
                  onClick={handleCopyDiagnostics}
                  className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white border border-white/10 text-xs font-mono transition-all"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-semibold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Copy Diagnostics</span>
                    </>
                  )}
                </button>
              </div>

              {/* Console Logs Output */}
              <div
                ref={logContainerRef}
                className="max-h-52 bg-black/80 rounded-xl p-3.5 font-mono text-[11px] leading-relaxed overflow-y-auto space-y-1 border border-white/5 select-text"
              >
                {logs.length === 0 ? (
                  <div className="text-neutral-600 italic">No output logged yet.</div>
                ) : (
                  logs.map((line, idx) => {
                    const lower = line.toLowerCase();
                    const isError = lower.includes('error') || lower.includes('fatal') || lower.includes('crash') || lower.includes('exception');
                    const isWarn = lower.includes('warn') || lower.includes('exited with code');
                    const isPrx = line.startsWith('Loading PRX') || line.startsWith('[PRX');
                    const isSys = line.startsWith('[libkernel]') || line.startsWith('[SAVEDATA');
                    const isGpu = line.startsWith('[libSceAgc') || line.startsWith('[src/Texture');
                    const isPad = line.startsWith('[libScePad]');

                    return (
                      <div 
                        key={idx} 
                        className={
                          isError 
                            ? 'text-red-400 font-semibold' 
                            : isWarn 
                            ? 'text-amber-300' 
                            : isPrx 
                            ? 'text-sky-300' 
                            : isSys 
                            ? 'text-blue-400' 
                            : isGpu 
                            ? 'text-indigo-300' 
                            : isPad 
                            ? 'text-emerald-400' 
                            : 'text-neutral-300'
                        }
                      >
                        {line}
                      </div>
                    );
                  })
                )}
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
};
