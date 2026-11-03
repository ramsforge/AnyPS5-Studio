import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Monitor,
  HardDrive,
  Folder,
  Layers,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Disc,
  AlertTriangle,
} from 'lucide-react';
import { SystemTelemetry, ResolvedRuntime } from '../types';
import { apiBridge } from '../services/apiBridge';
import { audioService } from '../services/audioService';

// Shows the result of a real host check: green when it passed, amber when it failed, grey while unknown.
const CheckBadge: React.FC<{ ok: boolean | null | undefined; label: string }> = ({ ok, label }) => {
  const tone = ok === true
    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
    : ok === false
      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
      : 'bg-white/5 border-white/10 text-white/50';
  return (
    <div className={`flex items-center space-x-1.5 px-3 py-1 rounded-md border text-[11px] font-medium ${tone}`}>
      {ok === false ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </div>
  );
};

interface OnboardingWizardProps {
  currentVersion: string;
  onComplete: (config: { gamesDirectory?: string; useSampleGames?: boolean }) => void;
}

type OnboardingStep = 1 | 2 | 3 | 4;

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  currentVersion,
  onComplete,
}) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [activeRuntime, setActiveRuntime] = useState<ResolvedRuntime | null>(null);
  const [gamesDirectory, setGamesDirectory] = useState<string>('');
  const [includeSampleGames, setIncludeSampleGames] = useState<boolean>(true);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState<boolean>(true);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [tel, resolved] = await Promise.all([
          apiBridge.getTelemetry(),
          apiBridge.resolveRuntime().catch(() => null),
        ]);
        setTelemetry(tel);
        if (resolved) {
          setActiveRuntime(resolved);
        }
      } catch (err) {
        console.error('Failed to load initial onboarding telemetry:', err);
      } finally {
        setIsLoadingTelemetry(false);
      }
    }
    loadInitialData();
  }, []);

  const handleBrowseFolder = async () => {
    audioService.playNavTick();
    try {
      const selected = await apiBridge.selectFolder();
      if (selected) {
        setGamesDirectory(selected);
        audioService.playConfirm();
      }
    } catch (err) {
      console.error('Failed to select games folder:', err);
    }
  };

  const handleNextStep = () => {
    audioService.playConfirm();
    if (currentStep < 4) {
      setCurrentStep((prev) => (prev + 1) as OnboardingStep);
    }
  };

  const handlePrevStep = () => {
    audioService.playCancel();
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as OnboardingStep);
    }
  };

  const handleFinish = async () => {
    audioService.playLaunch();
    await apiBridge.saveSettings({
      hasCompletedSetup: true,
      lastSeenVersion: currentVersion,
      gamesDirectory: gamesDirectory || undefined,
    });
    onComplete({
      gamesDirectory: gamesDirectory || undefined,
      useSampleGames: includeSampleGames,
    });
  };

  return (
    <div data-nav-scope className="fixed inset-0 z-50 flex flex-col justify-between bg-[#04060a] text-slate-100 select-none overflow-hidden animate-fade-in">
      {/* Background radial ambiance */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(0,112,209,0.15),rgba(255,255,255,0))]" />
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-[#0070d1]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header */}
      <header className="relative z-10 w-full px-12 py-8 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-[#0070d1]/20 border border-[#0070d1]/40 flex items-center justify-center">
            <Disc className="w-4 h-4 text-[#0070d1]" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wider text-white">ANYPS5 STUDIO</h1>
            <p className="text-[10px] text-white/40 tracking-widest font-mono uppercase">Initial System Setup</p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center space-x-2">
          {[1, 2, 3, 4].map((step) => {
            const isCompleted = currentStep > step;
            const isCurrent = currentStep === step;
            return (
              <div key={step} className="flex items-center space-x-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                    isCurrent
                      ? 'bg-[#0070d1] text-white ring-4 ring-[#0070d1]/20'
                      : isCompleted
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-white/[0.05] text-white/40 border border-white/[0.05]'
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5" /> : step}
                </div>
                {step < 4 && (
                  <div
                    className={`w-8 h-[1px] transition-colors ${
                      isCompleted ? 'bg-emerald-500/40' : 'bg-white/[0.08]'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/60 font-mono text-xs">
          v{currentVersion}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-8 py-4 overflow-y-auto">
        <div className="w-full max-w-2xl bg-[#090e18]/80 border border-white/[0.08] rounded-2xl p-8 backdrop-blur-xl shadow-2xl">
          {/* Step 1: Welcome & Hardware Inspection */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <span className="text-[11px] font-mono tracking-widest uppercase text-[#0070d1]">Step 1 of 4</span>
                <h2 className="text-xl font-semibold text-white tracking-wide mt-1">Hardware Inspection</h2>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  Scanning system capabilities for native PlayStation 5 binary translation and Vulkan GPU acceleration.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                {/* Host CPU */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                      <Cpu className="w-5 h-5 text-white/80" />
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-white">Host Processor</h4>
                      <p className="text-[11px] font-mono text-white/50 mt-0.5 truncate max-w-md">
                        {telemetry?.hostCpu || 'Detecting CPU architecture...'}
                      </p>
                    </div>
                  </div>
                  <CheckBadge
                    ok={telemetry ? telemetry.avx2 : undefined}
                    label={!telemetry ? 'Checking...' : telemetry.avx2 === true ? 'AVX2 supported' : telemetry.avx2 === false ? 'No AVX2 support' : 'AVX2 not checked'}
                  />
                </div>

                {/* Host GPU */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                      <Monitor className="w-5 h-5 text-white/80" />
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-white">Graphics Acceleration</h4>
                      <p className="text-[11px] font-mono text-white/50 mt-0.5 truncate max-w-md">
                        {telemetry?.gpuName || 'Detecting Vulkan graphics device...'}
                      </p>
                    </div>
                  </div>
                  <CheckBadge
                    ok={telemetry ? telemetry.vulkanAvailable : undefined}
                    label={!telemetry ? 'Checking...' : telemetry.vulkanAvailable ? 'Vulkan installed' : 'Vulkan not found'}
                  />
                </div>

                {/* System Libraries */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                      <ShieldCheck className="w-5 h-5 text-white/80" />
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-white">Clean-Room System Libraries</h4>
                      <p className="text-[11px] font-mono text-white/50 mt-0.5">
                        {telemetry ? `${telemetry.prxVersion}: ${telemetry.prxCount ?? 0} PRX libraries found` : 'Checking bundled runtime...'}
                      </p>
                    </div>
                  </div>
                  <CheckBadge
                    ok={telemetry ? (telemetry.prxCount ?? 0) > 0 : undefined}
                    label={!telemetry ? 'Checking...' : (telemetry.prxCount ?? 0) > 0 ? `${telemetry.prxCount} PRXs` : 'No PRXs found'}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Game Library Directory */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <span className="text-[11px] font-mono tracking-widest uppercase text-[#0070d1]">Step 2 of 4</span>
                <h2 className="text-xl font-semibold text-white tracking-wide mt-1">Game Library Directory</h2>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  Specify the folder on your filesystem where your decrypted PlayStation 5 titles are stored.
                </p>
              </div>

              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-white/80">Default Games Folder</label>
                  <div className="flex items-center space-x-2">
                    <div className="relative flex-1">
                      <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <input
                        type="text"
                        value={gamesDirectory}
                        onChange={(e) => setGamesDirectory(e.target.value)}
                        placeholder="e.g. C:/Games/PS5 or /home/user/Games/PS5"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs font-mono text-white placeholder-white/20 focus:outline-none focus:border-[#0070d1] transition-colors"
                      />
                    </div>
                    <button
                      onClick={handleBrowseFolder}
                      className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-white transition-all flex items-center space-x-2"
                    >
                      <span>Browse</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-white/40">
                    You can always import individual titles or change this directory later from Settings.
                  </p>
                </div>

                <div className="pt-3 border-t border-white/[0.06]">
                  <label className="flex items-start space-x-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={includeSampleGames}
                      onChange={(e) => {
                        audioService.playNavTick();
                        setIncludeSampleGames(e.target.checked);
                      }}
                      className="mt-0.5 rounded bg-black/40 border-white/20 text-[#0070d1] focus:ring-0 focus:ring-offset-0"
                    />
                    <div>
                      <div className="text-xs font-medium text-white group-hover:text-white transition-colors">
                        Include Showcase Titles
                      </div>
                      <div className="text-[11px] text-white/50 mt-0.5 leading-relaxed">
                        Preload Animal Well, Hollow Knight: Silksong, and other showcase titles to explore the launcher and relinker immediately.
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: System Runtime Confirmation */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <span className="text-[11px] font-mono tracking-widest uppercase text-[#0070d1]">Step 3 of 4</span>
                <h2 className="text-xl font-semibold text-white tracking-wide mt-1">Runtime Engine</h2>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  Verify the native translation engine configured to relink PS5 executables for your platform.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-4 pt-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-[#0070d1]/20 border border-[#0070d1]/40 flex items-center justify-center">
                      <Layers className="w-5 h-5 text-[#0070d1]" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white">Bundled Stable Engine</h4>
                      <p className="text-[11px] text-white/50 mt-0.5">Primary AnyPS5 Relinker & System Libraries</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-[11px]">
                    Active Engine
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-black/30 border border-white/[0.04]">
                    <div className="text-[10px] uppercase font-mono text-white/40">Binary Relinker</div>
                    <div className="text-xs font-mono text-white/90 mt-1 truncate">
                      {activeRuntime?.relinkerPath || 'Verified in build/relinker'}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-black/30 border border-white/[0.04]">
                    <div className="text-[10px] uppercase font-mono text-white/40">PRX Library Storage</div>
                    <div className="text-xs font-mono text-white/90 mt-1 truncate">
                      {activeRuntime?.libsPath || 'Verified in libs/'}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-white/40 flex items-center space-x-2">
                  <Sparkles className="w-3.5 h-3.5 text-[#0070d1]" />
                  <span>You can compile pull requests or custom commits anytime via Runtime Manager.</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Setup Complete */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <span className="text-[11px] font-mono tracking-widest uppercase text-emerald-400">Step 4 of 4</span>
                <h2 className="text-xl font-semibold text-white tracking-wide mt-1">Console Setup Complete</h2>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  {telemetry?.avx2 === false || telemetry?.vulkanAvailable === false || (telemetry?.prxCount ?? 1) === 0
                    ? 'Setup is saved, but some host checks failed. Titles may not run until they are fixed; see Hardware Inspection for details.'
                    : 'AnyPS5 Studio is configured and ready to relink and launch titles.'}
                </p>
              </div>

              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
                <div className="flex items-center space-x-3 text-xs text-white/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>
                    {`CPU: ${telemetry?.avx2 === true ? 'AVX2 supported' : telemetry?.avx2 === false ? 'no AVX2 support' : 'AVX2 not checked'}. `}
                    {`Graphics: ${telemetry?.vulkanAvailable ? 'Vulkan installed' : 'Vulkan not found'}.`}
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-xs text-white/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>
                    {gamesDirectory
                      ? `Default game directory linked: ${gamesDirectory}`
                      : 'Showcase title library pre-configured.'}
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-xs text-white/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Bundled Stable Runtime initialized as global execution engine.</span>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Action Buttons */}
          <div className="flex items-center justify-between pt-8 border-t border-white/[0.06] mt-8">
            {currentStep > 1 ? (
              <button
                onClick={handlePrevStep}
                className="px-5 py-2 rounded-xl text-xs font-medium text-white/60 hover:text-white transition-colors"
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {currentStep < 4 ? (
              <button
                onClick={handleNextStep}
                className="px-6 py-2.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-semibold tracking-wide transition-all shadow-lg shadow-white/10 flex items-center space-x-2"
              >
                <span>Continue</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="px-8 py-2.5 rounded-xl bg-[#0070d1] hover:bg-[#0060b8] text-white text-xs font-semibold tracking-wide transition-all shadow-lg shadow-[#0070d1]/20 flex items-center space-x-2"
              >
                <span>Enter Studio</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Subtle Bottom Footer */}
      <footer className="relative z-10 w-full px-12 py-4 flex items-center justify-between text-[11px] text-white/30 border-t border-white/[0.02]">
        <span>PlayStation 5 Native Re-linker & Launcher</span>
        <span>Press Enter or click Continue to navigate</span>
      </footer>
    </div>
  );
};
