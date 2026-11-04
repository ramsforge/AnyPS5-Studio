import React, { useState, useEffect, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { HomeScreen } from './components/HomeScreen';
import { RelinkerStudio } from './components/RelinkerStudio';
import { NidInspector } from './components/NidInspector';
import { TelemetryPanel } from './components/TelemetryPanel';
import { GameLauncherModal } from './components/GameLauncherModal';
import { AddGameModal } from './components/AddGameModal';
import { SettingsPage } from './components/SettingsPage';
import { CommunityPRBuilds } from './components/CommunityPRBuilds';
import { RuntimeManager } from './components/RuntimeManager';
import { OnboardingWizard } from './components/OnboardingWizard';
import { SystemUpdatedModal } from './components/SystemUpdatedModal';

import { GameItem } from './types';
import { apiBridge } from './services/apiBridge';
import { audioService } from './services/audioService';
import { CheckCircle2, X } from 'lucide-react';
import { NavDirection, activateFocused, currentScope, goBack, markGamepadInput, moveFocus, stepSelect } from './services/focusNav';

import { INITIAL_GAMES } from './services/sampleData';

export type ActiveTab = 'games' | 'relinker' | 'runtimes' | 'community' | 'nid' | 'telemetry' | 'settings';

export const App: React.FC = () => {
  const [games, setGames] = useState<GameItem[]>([]);
  const [selectedGameIndex, setSelectedGameIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>('games');
  const [activeRunningGame, setActiveRunningGame] = useState<GameItem | null>(null);
  const [isAddGameOpen, setIsAddGameOpen] = useState<boolean>(false);
  const [gamepadConnected, setGamepadConnected] = useState<boolean>(false);
  const [downloadedUpdateVersion, setDownloadedUpdateVersion] = useState<string | null>(null);
  const [showUpdateToast, setShowUpdateToast] = useState<boolean>(false);
  const [communitySearchKeyword, setCommunitySearchKeyword] = useState<string>('');
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState<boolean>(false);
  const [isSystemUpdatedOpen, setIsSystemUpdatedOpen] = useState<boolean>(false);
  const [currentAppVersion, setCurrentAppVersion] = useState<string>('1.5.1');


  // Advanced navbar items setting (persisted in localStorage, default OFF)
  const [showAdvancedNav, setShowAdvancedNav] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('anyps5_show_advanced_nav');
      return stored === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleAdvancedNav = (enabled: boolean) => {
    setShowAdvancedNav(enabled);
    try {
      localStorage.setItem('anyps5_show_advanced_nav', enabled ? 'true' : 'false');
    } catch (err) {
      console.error('Failed to save advanced nav preference:', err);
    }
    apiBridge.saveSettings({ advanced: enabled }).catch(() => {});
    // If user is currently viewing an advanced section and disables Advanced, navigate safely to Games
    if (!enabled && ['nid', 'telemetry', 'community', 'runtimes'].includes(activeTab)) {
      setActiveTab('games');
    }
  };

  // Load games & initial settings from apiBridge with onboarding check
  useEffect(() => {
    async function initApp() {
      try {
        const [loadedGames, settings, appVer] = await Promise.all([
          apiBridge.getGames(),
          apiBridge.getSettings(),
          apiBridge.getAppVersion().catch(() => '1.5.1'),
        ]);
        setGames(loadedGames);
        setCurrentAppVersion(appVer);

        if (settings && settings.advanced !== undefined) {
          setShowAdvancedNav(settings.advanced);
        }

        if (!settings.hasCompletedSetup) {
          setIsSetupWizardOpen(true);
        } else if (settings.lastSeenVersion !== appVer) {
          setIsSystemUpdatedOpen(true);
        }
      } catch (err) {
        console.error('Failed to initialize app state:', err);
      }
    }
    initApp();
  }, []);

  // Playtime is recorded by the main process when a game exits; reload the library so it shows up.
  useEffect(() => {
    const reload = () => apiBridge.getGames().then(setGames).catch(() => {});
    const unsub = apiBridge.onGameExit(() => reload());
    if (!activeRunningGame) {
      const timer = setTimeout(reload, 400);
      return () => {
        clearTimeout(timer);
        unsub();
      };
    }
    return unsub;
  }, [activeRunningGame]);

  // Listen for background auto-updates
  useEffect(() => {
    const unsub = apiBridge.onUpdateStatus((status) => {
      if (status.status === 'downloaded' && status.version) {
        setDownloadedUpdateVersion(status.version);
        setShowUpdateToast(true);
        audioService.playConfirm();
      }
    });
    return () => unsub();
  }, []);

  const availableTabs: ('games' | 'relinker' | 'runtimes' | 'community' | 'nid' | 'telemetry')[] = showAdvancedNav
    ? ['games', 'relinker', 'runtimes', 'community', 'nid', 'telemetry']
    : ['games', 'relinker'];

  // Keyboard navigation for authentic console feel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Arrow keys move focus like the D-pad inside dialogs, on non-game tabs, and once focus has left the game row.
      const arrows: Record<string, NavDirection> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = Boolean(target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const scope = currentScope();
      const onRow = !target || target === document.body || target.hasAttribute('data-game-tile');
      if (e.key === 'Escape' && scope) {
        goBack();
        return;
      }
      if (arrows[e.key] && !typing && (scope || activeTab !== 'games' || !onRow || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (moveFocus(arrows[e.key], scope || document)) {
          e.preventDefault();
          markGamepadInput(true);
        }
        return;
      }
      if (isAddGameOpen || activeRunningGame || isSetupWizardOpen || isSystemUpdatedOpen) return;

      // Tab switching via Q/E or [ / ]
      if ((e.key === 'q' || e.key === 'Q' || e.key === '[') && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        setActiveTab((prev) => {
          const idx = availableTabs.indexOf(prev as any);
          const currentIdx = idx === -1 ? 0 : idx;
          const next = availableTabs[(currentIdx - 1 + availableTabs.length) % availableTabs.length];
          audioService.playNavTick();
          return next;
        });
        return;
      }

      if ((e.key === 'e' || e.key === 'E' || e.key === ']') && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        setActiveTab((prev) => {
          const idx = availableTabs.indexOf(prev as any);
          const currentIdx = idx === -1 ? 0 : idx;
          const next = availableTabs[(currentIdx + 1) % availableTabs.length];
          audioService.playNavTick();
          return next;
        });
        return;
      }

      if (games.length === 0) return;

      if (e.key === 'ArrowRight' && activeTab === 'games') {
        setSelectedGameIndex((prev) => {
          const next = (prev + 1) % games.length;
          audioService.playNavTick();
          return next;
        });
      } else if (e.key === 'ArrowLeft' && activeTab === 'games') {
        setSelectedGameIndex((prev) => {
          const next = (prev - 1 + games.length) % games.length;
          audioService.playNavTick();
          return next;
        });
      } else if (e.key === 'Enter' && activeTab === 'games') {
        const game = games[selectedGameIndex];
        if (game) {
          if (game.status === 'ported') {
            audioService.playLaunch();
            setActiveRunningGame(game);
          } else {
            audioService.playConfirm();
            setActiveTab('relinker');
          }
        }
      } else if (e.key === 'Escape') {
        if (activeTab !== 'games') {
          audioService.playCancel();
          setActiveTab('games');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [games, selectedGameIndex, activeTab, isAddGameOpen, activeRunningGame, availableTabs, isSetupWizardOpen, isSystemUpdatedOpen]);

  // Latest values for the controller loop, which runs once for the app's lifetime.
  const navRef = useRef({ games, selectedGameIndex, activeTab, availableTabs });
  navRef.current = { games, selectedGameIndex, activeTab, availableTabs };

  // Controller input (standard mapping): D-pad / left stick move focus, Cross presses, Circle goes back,
  // L1 / R1 switch tabs. On the Games tab with a game tile focused, Left/Right pick a game and Cross plays it.
  useEffect(() => {
    let frame = 0;
    const nextFire: Record<string, number> = {};
    // Fires on press, then repeats while held (console-style auto-repeat for D-pad and stick).
    const fired = (key: string, down: boolean, now: number, repeat: boolean) => {
      if (!down) {
        delete nextFire[key];
        return false;
      }
      if (nextFire[key] === undefined) {
        nextFire[key] = now + 380;
        return true;
      }
      if (repeat && now >= nextFire[key]) {
        nextFire[key] = now + 110;
        return true;
      }
      return false;
    };
    const onTileOrNothing = () => {
      const el = document.activeElement as HTMLElement | null;
      return !el || el === document.body || el.hasAttribute('data-game-tile');
    };
    const focusSelectedTile = () => {
      const tiles = document.querySelectorAll<HTMLElement>('[data-game-tile]');
      tiles[navRef.current.selectedGameIndex]?.focus({ preventScroll: true });
    };

    const poll = (now: number) => {
      const pad = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find((p) => p && p.connected) || null;
      setGamepadConnected(Boolean(pad));

      // Ignore the controller while Studio is in the background (e.g. a game is being played).
      if (pad && document.hasFocus()) {
        const btn = (i: number) => Boolean(pad.buttons[i]?.pressed);
        const ax = (i: number) => pad.axes[i] || 0;
        const dirs = {
          up: btn(12) || ax(1) < -0.6,
          down: btn(13) || ax(1) > 0.6,
          left: btn(14) || ax(0) < -0.6,
          right: btn(15) || ax(0) > 0.6,
        };
        const { games: list, activeTab: tab, availableTabs: tabs } = navRef.current;
        const scope = currentScope();
        const onHome = tab === 'games' && !scope;
        let used = false;

        for (const dir of ['up', 'down', 'left', 'right'] as NavDirection[]) {
          if (!fired(dir, dirs[dir], now, true)) continue;
          used = true;
          if (onHome && onTileOrNothing() && (dir === 'left' || dir === 'right') && list.length > 0) {
            setSelectedGameIndex((prev) => {
              const next = (prev + (dir === 'right' ? 1 : -1) + list.length) % list.length;
              requestAnimationFrame(() => document.querySelectorAll<HTMLElement>('[data-game-tile]')[next]?.focus({ preventScroll: true }));
              return next;
            });
            audioService.playNavTick();
          } else {
            if (onHome && document.activeElement === document.body) focusSelectedTile();
            if (stepSelect(dir) || moveFocus(dir, scope || document)) audioService.playNavTick();
          }
        }

        if (fired('cross', btn(0), now, false)) {
          used = true;
          if (onHome && onTileOrNothing()) {
            const game = list[navRef.current.selectedGameIndex];
            if (game) {
              if (game.status === 'ported') {
                audioService.playLaunch();
                setActiveRunningGame(game);
              } else {
                audioService.playConfirm();
                setActiveTab('relinker');
              }
            }
          } else if (activateFocused()) {
            audioService.playConfirm();
          }
        }

        if (fired('circle', btn(1), now, false)) {
          used = true;
          audioService.playCancel();
          if (onHome) focusSelectedTile();
          else goBack();
        }

        for (const [key, step] of [['l1', -1], ['r1', 1]] as const) {
          if (fired(key, btn(key === 'l1' ? 4 : 5), now, false) && !scope) {
            used = true;
            setActiveTab((prev) => {
              const idx = Math.max(0, tabs.indexOf(prev as (typeof tabs)[number]));
              return tabs[(idx + step + tabs.length) % tabs.length];
            });
            audioService.playNavTick();
          }
        }

        if (used) markGamepadInput(true);
      } else {
        for (const key of Object.keys(nextFire)) delete nextFire[key];
      }
      frame = requestAnimationFrame(poll);
    };

    // The focus outline is for controller and arrow-key users; hide it again as soon as the mouse is used.
    const onMouse = () => markGamepadInput(false);
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('mousemove', onMouse);
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('mousemove', onMouse);
    };
  }, []);

  const handleUpdateGameStatus = (gameId: string, status: 'ported', updatedGame?: GameItem) => {
    setGames((prev) => {
      const updated = prev.map((g) => {
        if (g.id === gameId) {
          return updatedGame ? { ...g, ...updatedGame, status } : { ...g, status };
        }
        return g;
      });
      apiBridge.saveGames(updated);
      return updated;
    });
  };

  const handleAddGame = (newGame: GameItem) => {
    setGames((prev) => {
      const updated = [newGame, ...prev];
      apiBridge.saveGames(updated);
      return updated;
    });
    setSelectedGameIndex(0);
  };

  const handleAddGamesBulk = (newGames: GameItem[]) => {
    if (!newGames || newGames.length === 0) return;
    setGames((prev) => {
      const updated = [...newGames, ...prev];
      apiBridge.saveGames(updated);
      return updated;
    });
    setSelectedGameIndex(0);
  };

  const handleDeleteGame = (gameId: string) => {
    audioService.playCancel();
    setGames((prev) => {
      const updated = prev.filter((g) => g.id !== gameId);
      apiBridge.saveGames(updated);
      return updated;
    });
    setSelectedGameIndex(0);
  };

  const handleClearDemoGames = () => {
    audioService.playCancel();
    setGames((prev) => {
      const updated = prev.filter((g) => !g.isSample);
      apiBridge.saveGames(updated);
      return updated;
    });
    setSelectedGameIndex(0);
  };

  const handleResetDemoGames = () => {
    audioService.playConfirm();
    setGames(INITIAL_GAMES);
    apiBridge.saveGames(INITIAL_GAMES);
    setSelectedGameIndex(0);
  };

  const handleOnboardingComplete = (config: { gamesDirectory?: string; useSampleGames?: boolean }) => {
    setIsSetupWizardOpen(false);
    if (config.useSampleGames && games.length === 0) {
      setGames(INITIAL_GAMES);
      apiBridge.saveGames(INITIAL_GAMES);
    }
  };

  const handleSystemUpdatedContinue = async () => {
    setIsSystemUpdatedOpen(false);
    await apiBridge.saveSettings({ lastSeenVersion: currentAppVersion });
  };

  const selectedGame = games[selectedGameIndex] || games[0];

  return (
    <div className="relative w-screen h-screen bg-[#04060a] text-slate-100 overflow-hidden select-none">
      {/* Top PlayStation Header - Floats transparently over the artwork */}
      <div className="absolute top-0 left-0 right-0 z-50 pointer-events-auto bg-transparent">
        <TopBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenAddGame={() => setIsAddGameOpen(true)}
          onOpenSettings={() => setActiveTab((prev) => (prev === 'settings' ? 'games' : 'settings'))}
          gamepadConnected={gamepadConnected}
          showAdvancedNav={showAdvancedNav}
        />
      </div>

      {/* Main Tab Screen - Extends full viewport from y = 0 */}

      <main className="w-full h-full min-h-0 overflow-hidden">

        {/* Tab Views - Kept alive in memory, visibility toggled via CSS */}

        <div className={`w-full h-full ${activeTab === 'games' ? 'block' : 'hidden'}`}>
          <HomeScreen
            games={games}
            selectedGameIndex={selectedGameIndex}
            onSelectGame={setSelectedGameIndex}
            onLaunchGame={(game) => setActiveRunningGame(game)}
            onStartRelinking={() => setActiveTab('relinker')}
            onOpenNidAudit={() => setActiveTab('nid')}
            onOpenAddGame={() => setIsAddGameOpen(true)}
            onDeleteGame={handleDeleteGame}
            onClearDemoGames={handleClearDemoGames}
            onResetDemoGames={handleResetDemoGames}
          />
        </div>

        <div className={`w-full h-full ${activeTab === 'relinker' ? 'block' : 'hidden'}`}>
          {selectedGame ? (
            <RelinkerStudio
              games={games}
              selectedGame={selectedGame}
              onUpdateGameStatus={handleUpdateGameStatus}
              onLaunchGame={(game) => setActiveRunningGame(game)}
              onNavigateToGames={() => setActiveTab('games')}
            />
          ) : (
            <div className="flex-1 h-full flex flex-col items-center justify-center p-8 pt-20 text-center animate-fade-in">
              <p className="text-neutral-400 text-sm mb-4">No title selected for relinking.</p>
              <button
                onClick={() => setIsAddGameOpen(true)}
                className="px-6 py-2.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-all"
              >
                Import PS5 Title
              </button>
            </div>
          )}
        </div>

        <div className={`w-full h-full ${activeTab === 'runtimes' ? 'block' : 'hidden'}`}>
          <RuntimeManager
            onNavigateToGames={() => setActiveTab('games')}
            onNavigateToRelinker={() => setActiveTab('relinker')}
          />
        </div>

        <div className={`w-full h-full ${activeTab === 'community' ? 'block' : 'hidden'}`}>
          <CommunityPRBuilds
            initialSearch={communitySearchKeyword}
            onClearInitialSearch={() => setCommunitySearchKeyword('')}
            onNavigateToGames={() => setActiveTab('games')}
            onNavigateToRelinker={() => setActiveTab('relinker')}
          />
        </div>

        <div className={`w-full h-full ${activeTab === 'nid' ? 'block' : 'hidden'}`}>
          {selectedGame ? (
            <NidInspector
              game={selectedGame}
              games={games}
              onSelectGame={(g) => {
                const idx = games.findIndex((x) => x.id === g.id);
                if (idx !== -1) setSelectedGameIndex(idx);
              }}
            />
          ) : (
            <div className="flex-1 h-full flex flex-col items-center justify-center p-8 pt-20 text-center animate-fade-in">
              <p className="text-neutral-400 text-sm mb-4">No title selected for NID audit.</p>
              <button
                onClick={() => setIsAddGameOpen(true)}
                className="px-6 py-2.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-all"
              >
                Import PS5 Title
              </button>
            </div>
          )}
        </div>

        <div className={`w-full h-full ${activeTab === 'telemetry' ? 'block' : 'hidden'}`}>
          <TelemetryPanel />
        </div>

        <div className={`w-full h-full ${activeTab === 'settings' ? 'block' : 'hidden'}`}>
          <SettingsPage
            onNavigateBack={() => setActiveTab('games')}
            showAdvancedNav={showAdvancedNav}
            onToggleAdvancedNav={handleToggleAdvancedNav}
            onNavigateToRuntimes={() => {
              if (!showAdvancedNav) {
                handleToggleAdvancedNav(true);
              }
              setActiveTab('runtimes');
            }}
          />
        </div>
      </main>

      {/* Game Running Modal */}
      {activeRunningGame && (
        <GameLauncherModal
          game={activeRunningGame}
          onClose={() => setActiveRunningGame(null)}
          onNavigateToRelinker={(g) => {
            setActiveRunningGame(null);
            const idx = games.findIndex((item) => item.id === g.id);
            if (idx !== -1) setSelectedGameIndex(idx);
            setActiveTab('relinker');
          }}
          onNavigateToCommunityPRs={(keyword) => {
            setActiveRunningGame(null);
            handleToggleAdvancedNav(true);
            if (keyword) setCommunitySearchKeyword(keyword);
            setActiveTab('community');
          }}
        />
      )}

      {/* Import Game Modal */}
      <AddGameModal
        isOpen={isAddGameOpen}
        onClose={() => setIsAddGameOpen(false)}
        onAddGame={handleAddGame}
        onAddGamesBulk={handleAddGamesBulk}
        existingGames={games}
      />

      {/* PS5 Notification Toast: Update Ready */}
      {showUpdateToast && downloadedUpdateVersion && (
        <div className="fixed top-14 right-6 z-50 animate-fade-in max-w-sm w-full bg-[#141923]/95 border border-white/20 rounded-2xl shadow-2xl backdrop-blur-xl p-4 flex flex-col space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-xl bg-[#0070d1]/20 border border-[#0070d1]/40 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-[#0070d1]" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white tracking-wide">Update Ready to Install</h4>
                <p className="text-[11px] text-white/60 mt-0.5">AnyPS5 Studio v{downloadedUpdateVersion} has been downloaded.</p>
              </div>
            </div>
            <button
              onClick={() => setShowUpdateToast(false)}
              className="text-white/40 hover:text-white/80 transition-colors p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center justify-end space-x-2 pt-1 border-t border-white/10">
            <button
              onClick={() => setShowUpdateToast(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white transition-colors"
            >
              Later
            </button>
            <button
              onClick={() => {
                audioService.playConfirm();
                apiBridge.quitAndInstallUpdate();
              }}
              className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold transition-colors shadow-lg shadow-emerald-500/20"
            >
              Restart & Install
            </button>
          </div>
        </div>
      )}
      {/* PlayStation 5 Out-of-Box Experience (OOBE) First-Run Setup Wizard */}
      {isSetupWizardOpen && (
        <OnboardingWizard
          currentVersion={currentAppVersion}
          onComplete={handleOnboardingComplete}
        />
      )}

      {/* System Software Updated Dialog */}
      <SystemUpdatedModal
        isOpen={isSystemUpdatedOpen}
        currentVersion={currentAppVersion}
        onContinue={handleSystemUpdatedContinue}
      />
    </div>
  );
};
