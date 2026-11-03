import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  ArrowLeft,
  Cpu, 
  Gamepad2, 
  Volume2, 
  Check, 
  RefreshCw,
  DownloadCloud,
  CheckCircle2,
  Sliders,
  Monitor,
  Shield,
  Layers,
  ArrowRight,
  Radio
} from 'lucide-react';
import { audioService } from '../services/audioService';
import { apiBridge } from '../services/apiBridge';
import { UpdateStatus, DetectedGpu, ResolvedRuntime } from '../types';

interface SettingsPageProps {
  onNavigateBack: () => void;
  showAdvancedNav: boolean;
  onToggleAdvancedNav: (enabled: boolean) => void;
  onNavigateToRuntimes?: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ 
  onNavigateBack,
  showAdvancedNav,
  onToggleAdvancedNav,
  onNavigateToRuntimes
}) => {
  const [activeRuntime, setActiveRuntime] = useState<ResolvedRuntime | null>(null);
  const [defaultTarget, setDefaultTarget] = useState<string>('windows');
  const [cpuFix, setCpuFix] = useState<string>('auto');
  const [preferredGpu, setPreferredGpu] = useState<string>('auto');
  const [availableGpus, setAvailableGpus] = useState<DetectedGpu[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(audioService.enabled);
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(true);
  const [advanced, setAdvanced] = useState<boolean>(showAdvancedNav);
  const [appVersion, setAppVersion] = useState<string>('1.1.2-preview.2');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' });
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState<boolean>(true);
  const [discordConnected, setDiscordConnected] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  useEffect(() => {
    apiBridge.getAppVersion().then(setAppVersion).catch(() => {});
    const unsub = apiBridge.onUpdateStatus((status) => {
      setUpdateStatus(status);
    });
    const checkDiscord = () => {
      apiBridge.getDiscordStatus().then((st) => {
        setDiscordConnected(st.connected);
      }).catch(() => {});
    };
    checkDiscord();
    const discordInterval = setInterval(checkDiscord, 3000);
    return () => {
      unsub();
      clearInterval(discordInterval);
    };
  }, []);

  useEffect(() => {
    apiBridge.getAvailableGpus().then((gpus) => {
      if (Array.isArray(gpus)) {
        setAvailableGpus(gpus);
      }
    }).catch(() => {});

    apiBridge.resolveRuntime().then(setActiveRuntime).catch(() => {});

    apiBridge.getSettings().then((settings) => {
      if (settings) {
        if (settings.defaultTarget) setDefaultTarget(settings.defaultTarget);
        if (settings.cpuFix) setCpuFix(settings.cpuFix);
        if (settings.preferredGpu) setPreferredGpu(settings.preferredGpu);
        if (settings.soundEnabled !== undefined) {
          setSoundEnabled(settings.soundEnabled);
          audioService.enabled = settings.soundEnabled;
        }
        if (settings.hapticsEnabled !== undefined) {
          setHapticsEnabled(settings.hapticsEnabled);
          audioService.hapticsEnabled = settings.hapticsEnabled;
        }
        if (settings.advanced !== undefined) {
          setAdvanced(settings.advanced);
        } else {
          setAdvanced(showAdvancedNav);
        }
        if (settings.discordRpcEnabled !== undefined) {
          setDiscordRpcEnabled(settings.discordRpcEnabled);
        }
      }
    });
  }, [showAdvancedNav]);

  const primaryDiscreteGpu = availableGpus.find((g) => g.isDiscrete && !g.isVirtual) ||
    availableGpus.find((g) => !g.isVirtual) ||
    availableGpus[0];

  const handleAdvancedChange = (checked: boolean) => {
    audioService.playNavTick();
    setAdvanced(checked);
    onToggleAdvancedNav(checked);
    setIsSaved(false);
  };

  const handleResetDefaults = () => {
    audioService.playNavTick();
    setPreferredGpu('auto');
    setDefaultTarget('windows');
    setCpuFix('intel');
    setAdvanced(false);
    onToggleAdvancedNav(false);
    setDiscordRpcEnabled(true);
    setIsSaved(false);
  };

  const handleCheckForUpdates = async () => {
    audioService.playNavTick();
    setUpdateStatus({ status: 'checking' });
    try {
      const res = await apiBridge.checkForUpdates();
      if (res.status === 'not-available' || res.status === 'dev-mode') {
        setUpdateStatus({ status: 'not-available', version: res.currentVersion });
      } else if (res.status === 'error') {
        setUpdateStatus({ status: 'error', error: res.error || 'Update check failed.' });
      } else if (res.status === 'checked' && !res.updateInfo) {
        setUpdateStatus({ status: 'not-available', version: res.currentVersion });
      }
    } catch (err: any) {
      setUpdateStatus({ status: 'error', error: err?.message || 'Update check failed.' });
    }
  };

  const handleSave = async () => {
    audioService.playConfirm();
    await apiBridge.saveSettings({
      defaultTarget,
      cpuFix,
      soundEnabled,
      hapticsEnabled,
      advanced,
      preferredGpu,
      discordRpcEnabled,
    });
    onToggleAdvancedNav(advanced);
    window.dispatchEvent(new Event('anyps5:settings-saved'));
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
    }, 2500);
  };

  const handleDiscordRpcToggle = async (checked: boolean) => {
    audioService.playNavTick();
    setDiscordRpcEnabled(checked);
    setIsSaved(false);
    await apiBridge.saveSettings({ discordRpcEnabled: checked });
  };

  return (
    <div className="relative w-full h-full flex flex-col pt-20 px-6 sm:px-8 md:px-12 lg:px-16 pb-16 overflow-y-auto select-none custom-scrollbar animate-fade-in">
      {/* Top Breadcrumb & Return Action */}
      <div className="mb-4">
        <button
          onClick={() => {
            audioService.playCancel();
            onNavigateBack();
          }}
          className="inline-flex items-center space-x-2 text-xs font-medium text-white/60 hover:text-white transition-colors group py-1 px-2.5 rounded-lg hover:bg-white/5"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Games</span>
        </button>
      </div>

      {/* Main Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-white/10 mb-8 gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-2xl bg-[#0070d1]/15 border border-[#0070d1]/30 flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#0070d1]/10">
            <Settings className="w-5 h-5 text-[#0070d1]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">System Settings</h1>
            <p className="text-xs text-white/50 mt-0.5">
              Configure hardware graphics binding, architecture lowering, and audio feedback.
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center space-x-3 self-end sm:self-auto">
          <button
            onClick={handleResetDefaults}
            className="px-4 py-2 rounded-full text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            className={`px-6 py-2 rounded-full font-semibold text-xs transition-all flex items-center space-x-2 shadow-lg ${
              isSaved 
                ? 'bg-emerald-500 text-black shadow-emerald-500/20' 
                : 'bg-white text-black hover:bg-white/90 shadow-white/10'
            }`}
          >
            {isSaved ? (
              <>
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>Preferences Saved</span>
              </>
            ) : (
              <span>Save Preferences</span>
            )}
          </button>
        </div>
      </div>

      {/* Categorized Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl">
        {/* Left Column: Hardware & Engine Paths */}
        <div className="space-y-6">
          {/* Section 1: Graphics & Vulkan Acceleration */}
          <div className="p-6 rounded-2xl bg-[#0b0e14]/90 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="flex items-center space-x-2.5 pb-4 border-b border-white/10 mb-5">
              <Monitor className="w-4 h-4 text-[#0070d1]" />
              <h2 className="text-sm font-semibold text-white tracking-wide">Graphics & Compute Acceleration</h2>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-white/80">Preferred Graphics Device (Vulkan GPU)</label>
                  {preferredGpu !== 'auto' && (
                    <span className="text-[10px] text-[#0070d1] font-semibold bg-[#0070d1]/15 px-2.5 py-0.5 rounded-full border border-[#0070d1]/30">
                      Custom GPU Bound
                    </span>
                  )}
                </div>
                <select
                  value={preferredGpu}
                  onChange={(e) => {
                    setPreferredGpu(e.target.value);
                    setIsSaved(false);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#141923] border border-white/10 text-white text-xs focus:outline-none focus:border-white/30 transition-all cursor-pointer font-sans"
                >
                  <option value="auto">
                    Auto ({primaryDiscreteGpu ? `Discrete: ${primaryDiscreteGpu.name}` : 'High Performance Discrete'})
                  </option>
                  {availableGpus.map((gpu) => (
                    <option key={gpu.name} value={gpu.name}>
                      {gpu.name} {gpu.isVirtual ? '(Virtual Adapter)' : gpu.isDiscrete ? '(Dedicated GPU)' : '(Integrated)'}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-white/40 mt-1.5 leading-relaxed">
                  Directs the Vulkan presentation queue to initialize on your selected physical graphics card and prevents selection of virtual display adapters (e.g. Meta Quest Virtual Monitor, Virtual Desktop).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-medium text-white/80 mb-1.5">Target Platform</label>
                  <select
                    value={defaultTarget}
                    onChange={(e) => {
                      setDefaultTarget(e.target.value);
                      setIsSaved(false);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#141923] border border-white/10 text-white text-xs focus:outline-none focus:border-white/30 transition-all font-sans cursor-pointer"
                  >
                    <option value="windows">Windows (.exe)</option>
                    <option value="linux">Linux (.elf)</option>
                    <option value="macos">macOS (Mach-O)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/80 mb-1.5">Host CPU Instruction Set</label>
                  <select
                    value={cpuFix}
                    onChange={(e) => {
                      setCpuFix(e.target.value);
                      setIsSaved(false);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#141923] border border-white/10 text-white text-xs focus:outline-none focus:border-white/30 transition-all font-sans cursor-pointer"
                  >
                    <option value="auto">Auto (match this PC)</option>
                    <option value="intel">Intel x86-64 (AVX2 Lowering)</option>
                    <option value="amd">AMD Zen 2 / Zen 3 / Zen 4 Native</option>
                    <option value="rosetta">Apple Silicon (Rosetta JIT)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Runtime Engine & Libraries */}
          <div className="p-6 rounded-2xl bg-[#0b0e14]/90 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
              <div className="flex items-center space-x-2.5">
                <Layers className="w-4 h-4 text-[#0070d1]" />
                <h2 className="text-sm font-semibold text-white tracking-wide">Runtime Engine & Libraries</h2>
              </div>
              {activeRuntime && (
                <span
                  className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${
                    activeRuntime.isValid
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {activeRuntime.isValid ? 'Engine Active' : 'Incomplete'}
                </span>
              )}
            </div>

            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/60">Active Profile</span>
                  <span className="font-semibold text-white">
                    {activeRuntime?.name || 'Bundled Stable (v0.1.2)'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/60">Profile Type</span>
                  <span className="font-mono text-neutral-300 capitalize">
                    {activeRuntime?.type || 'bundled'}
                  </span>
                </div>
                {activeRuntime?.commitHash && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">Commit Reference</span>
                    <span className="font-mono text-[#0070d1] bg-[#0070d1]/10 px-2 py-0.5 rounded border border-[#0070d1]/30">
                      {activeRuntime.commitHash}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/60">Status</span>
                  <span className="text-white/80 font-mono text-[11px]">
                    {activeRuntime?.isValid ? 'Relinker & PRX Libraries Verified' : 'Missing binaries or libraries'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <p className="text-[11px] text-white/40 leading-relaxed">
                  Relinker binaries and system PRX libraries are exclusively located and managed by the Runtime Manager.
                </p>
                {onNavigateToRuntimes && (
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playNavTick();
                      onNavigateToRuntimes();
                    }}
                    className="flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium border border-white/10 transition-colors flex-shrink-0"
                  >
                    <span>Open Runtime Manager</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Audio, Developer, Software Updates */}
        <div className="space-y-6">
          {/* Section 3: Console Audio & DualSense Controller */}
          <div className="p-6 rounded-2xl bg-[#0b0e14]/90 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="flex items-center space-x-2.5 pb-4 border-b border-white/10 mb-5">
              <Volume2 className="w-4 h-4 text-[#0070d1]" />
              <h2 className="text-sm font-semibold text-white tracking-wide">Audio & Controller Emulation</h2>
            </div>

            <div className="space-y-4">
              <label className="flex items-start space-x-3.5 text-xs text-white/80 cursor-pointer p-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => {
                    setSoundEnabled(e.target.checked);
                    audioService.enabled = e.target.checked;
                    setIsSaved(false);
                  }}
                  className="rounded bg-white/10 border-white/20 text-[#0070d1] focus:ring-0 mt-0.5"
                />
                <div className="flex flex-col">
                  <span className="font-medium text-white">Synthesized PlayStation 5 Acoustic Audio</span>
                  <span className="text-[11px] text-white/50 mt-0.5 leading-normal">
                    Plays authentic WebAudio synthesized navigation ticks, selection confirmations, and launch fanfares.
                  </span>
                </div>
              </label>

              <label className="flex items-start space-x-3.5 text-xs text-white/80 cursor-pointer p-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5">
                <input
                  type="checkbox"
                  checked={hapticsEnabled}
                  onChange={(e) => {
                    setHapticsEnabled(e.target.checked);
                    audioService.hapticsEnabled = e.target.checked;
                    setIsSaved(false);
                  }}
                  className="rounded bg-white/10 border-white/20 text-[#0070d1] focus:ring-0 mt-0.5"
                />
                <div className="flex flex-col">
                  <span className="font-medium text-white">DualSense Adaptive Triggers & Haptics</span>
                  <span className="text-[11px] text-white/50 mt-0.5 leading-normal">
                    Emulates PlayStation 5 DualSense force-feedback resistive triggers and high-definition haptic vibration.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Section: General & Integrations */}
          <div className="p-6 rounded-2xl bg-[#0b0e14]/90 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="flex items-center space-x-2.5 pb-4 border-b border-white/10 mb-5">
              <Radio className="w-4 h-4 text-[#0070d1]" />
              <h2 className="text-sm font-semibold text-white tracking-wide">General & Integrations</h2>
            </div>

            <div className="space-y-4">
              <label className="flex items-start space-x-3.5 text-xs text-white/80 cursor-pointer p-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5">
                <input
                  type="checkbox"
                  checked={discordRpcEnabled}
                  onChange={(e) => handleDiscordRpcToggle(e.target.checked)}
                  className="rounded bg-white/10 border-white/20 text-[#0070d1] focus:ring-0 mt-0.5"
                />
                <div className="flex flex-col flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">Discord Rich Presence</span>
                    {discordRpcEnabled && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border flex items-center space-x-1.5 ${
                        discordConnected
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${discordConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                        <span>{discordConnected ? 'Broadcasting Live' : 'Discord Not Detected'}</span>
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-white/50 mt-1 leading-normal">
                    Broadcasts active PlayStation 5 title, live elapsed playtime, and title cover art directly to your Discord profile via local named pipe.
                  </span>

                  <div className="mt-2.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] text-white/50 space-y-1">
                    <p className="text-white/70 font-medium">Discord Profile Setup:</p>
                    <p>
                      Ensure &ldquo;Activity Privacy &gt; Display current activity as a status message&rdquo; is toggled ON in your Discord client, and your status is not set to Invisible.
                    </p>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Section 4: Developer Options */}
          <div className="p-6 rounded-2xl bg-[#0b0e14]/90 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="flex items-center space-x-2.5 pb-4 border-b border-white/10 mb-5">
              <Sliders className="w-4 h-4 text-[#0070d1]" />
              <h2 className="text-sm font-semibold text-white tracking-wide">Developer & Advanced Tools</h2>
            </div>

            <div>
              <label className="flex items-start space-x-3.5 text-xs text-white/90 cursor-pointer group p-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5">
                <input
                  type="checkbox"
                  checked={advanced}
                  onChange={(e) => {
                    handleAdvancedChange(e.target.checked);
                    setIsSaved(false);
                  }}
                  className="rounded bg-white/10 border-white/20 text-[#0070d1] focus:ring-0 mt-0.5"
                />
                <div className="flex flex-col">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-white group-hover:text-white transition-colors">Advanced Developer Navigation</span>
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] text-white/70 font-mono">Experimental</span>
                  </div>
                  <span className="text-[11px] text-white/50 leading-relaxed mt-1">
                    Reveals Runtime Manager, Community PR Builds, NID Inspector, PRX Libraries, and System Status in the top navigation bar.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Section 5: Software Updates & System Version */}
          <div className="p-6 rounded-2xl bg-[#0b0e14]/90 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
              <div className="flex items-center space-x-2.5">
                <RefreshCw className="w-4 h-4 text-[#0070d1]" />
                <h2 className="text-sm font-semibold text-white tracking-wide">Software Updates & Channel</h2>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-[11px] font-mono text-white/80 border border-white/10">
                v{appVersion}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2.5">
                  {updateStatus.status === 'checking' && (
                    <>
                      <RefreshCw className="w-4 h-4 text-white/70 animate-spin" />
                      <span className="text-white/70">Checking for updates...</span>
                    </>
                  )}
                  {updateStatus.status === 'downloading' && (
                    <>
                      <DownloadCloud className="w-4 h-4 text-[#0070d1] animate-bounce" />
                      <span className="text-white/90">
                        Downloading update v{updateStatus.version || ''}... {updateStatus.progress ? `(${updateStatus.progress}%)` : ''}
                      </span>
                    </>
                  )}
                  {updateStatus.status === 'downloaded' && (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">
                        Update v{updateStatus.version} ready to install.
                      </span>
                    </>
                  )}
                  {updateStatus.status === 'not-available' && (
                    <>
                      <Check className="w-4 h-4 text-white/60" />
                      <span className="text-white/60">AnyPS5 Studio is up to date.</span>
                    </>
                  )}
                  {updateStatus.status === 'error' && (
                    <span className="text-rose-400 text-xs max-w-lg break-words">
                      {updateStatus.error || 'Update check failed.'}
                    </span>
                  )}
                  {updateStatus.status === 'idle' && (
                    <span className="text-white/60">Check for the latest release updates.</span>
                  )}
                  {updateStatus.status === 'available' && (
                    <span className="text-white/80">Found update v{updateStatus.version}. Starting download...</span>
                  )}
                </div>

                {updateStatus.status === 'downloaded' ? (
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playConfirm();
                      apiBridge.quitAndInstallUpdate();
                    }}
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold transition-colors flex-shrink-0 shadow-lg shadow-emerald-500/20"
                  >
                    Restart & Install
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={updateStatus.status === 'checking' || updateStatus.status === 'downloading'}
                    onClick={handleCheckForUpdates}
                    className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white/90 hover:text-white text-xs font-medium border border-white/10 transition-colors flex-shrink-0"
                  >
                    {updateStatus.status === 'checking' ? 'Checking...' : 'Check for Updates'}
                  </button>
                )}
              </div>

              {updateStatus.status === 'downloading' && (
                <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[#0070d1] h-full transition-all duration-300 rounded-full"
                    style={{ width: `${updateStatus.progress || 0}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
