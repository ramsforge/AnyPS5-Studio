export interface ReleaseHighlight {
  title: string;
  description: string;
}

export interface ReleaseInfo {
  version: string;
  highlights: ReleaseHighlight[];
}

export const RELEASE_HIGHLIGHTS_MAP: Record<string, ReleaseHighlight[]> = {
  '1.2.0': [
    {
      title: 'Runtime Engine Manager',
      description: 'Switch execution cores between bundled, upstream commits, and local custom builds.'
    },
    {
      title: 'Local PR Builder',
      description: 'Native CMake & Ninja compilation of community pull requests and multi-PR hybrid merges.'
    },
    {
      title: 'Git Worktree Resilience',
      description: 'Automated self-healing, stale lock removal, and conflict recovery.'
    },
    {
      title: 'Keep-Alive Tab State',
      description: 'Compilation and relink operations persist continuously across tab switches.'
    },
    {
      title: 'Dual-Platform Parity',
      description: 'Full support for Windows (app.exe) and Linux (app.elf) runtime targets.'
    }
  ],
  '1.2.1': [
    {
      title: 'PS5 First-Run Setup (OOBE)',
      description: 'Authentic PlayStation 5 first-run onboarding wizard with hardware detection and setup guide.'
    },
    {
      title: '1-Click Silent Installer',
      description: 'Streamlined zero-friction Windows setup without legacy wizard dialogs.'
    },
    {
      title: 'Seamless Update Detection',
      description: 'Automatically preserves existing user libraries and configuration without repeating setup.'
    }
  ],
  '1.3.0': [
    {
      title: 'Bulk Import',
      description: 'Automatically discover and add multiple PlayStation 5 titles from any directory.'
    }
  ],
  '1.3.1': [
    {
      title: 'Real-Time NID Inspector',
      description: 'Live dynamic symbol extraction and coverage auditing directly from authentic PlayStation 5 binaries with an integrated title switcher.'
    },
    {
      title: 'Streamlined Diagnostics',
      description: 'Permanently retired the deprecated PRX mockup tab and optimized diagnostic navigation.'
    }
  ],
  '1.3.2': [
    {
      title: 'Installer Optimization',
      description: 'Reduced installer download size by over 60% through improved compression and cleaned runtime files.'
    }
  ],
  '1.4.0': [
    {
      title: 'Discord Rich Presence',
      description: 'Show your active game, official cover art, and live playtime directly on your Discord profile.'
    },
    {
      title: 'Privacy & Compliance',
      description: 'Added official Terms of Service and a Privacy Policy confirming zero tracking and that all data stays strictly on your computer.'
    }
  ],
  '1.4.1': [
    {
      title: 'New App Icon',
      description: 'Updated the launcher, taskbar, desktop shortcut, and installer to the new PlayStation badge logo.'
    }
  ],
  '1.4.2': [
    {
      title: 'Core Update',
      description: 'Upgraded the built-in relinker and system libraries to the latest stable release (v0.1.3).'
    }
  ],
  '1.4.3': [
    {
      title: 'Core Stability Rollback',
      description: 'Reverted the default bundled runtime to AnyPS5 v0.1.2 due to an upstream graphics driver issue in v0.1.3.'
    }
  ],
  '1.4.4': [
    {
      title: 'Runtime Cache Cleanup',
      description: 'Cleans stale driver files automatically on runtime changes.'
    },
    {
      title: 'Linux Compatibility',
      description: 'Corrected library load paths and executable permissions.'
    }
  ],
  '1.4.5': [
    {
      title: 'Core Runtime Stability',
      description: 'Pinned bundled execution engine and system PRXs to verified upstream v0.1.2 release.'
    },
    {
      title: 'Runtime Cache Purging',
      description: 'Automatically clears outdated driver files on runtime updates.'
    },
    {
      title: 'Linux Module Resolution',
      description: 'Fixed library load paths and executable permissions.'
    }
  ],
  '1.4.6': [
    {
      title: 'Dynamic Linker Diagnostics',
      description: 'Real-time detection and system package remedies for Linux dynamic linker errors, missing host libraries, and undefined symbols.'
    },
    {
      title: 'Linker Error Recovery',
      description: 'Added exit code 127 failure parsing with automated Relinker Studio rebuild hints.'
    }
  ],
  '1.4.7': [
    {
      title: 'Per-Title PlayGo Isolation',
      description: 'Added isolated PlayGo unlisted chunk handling with built-in profiles for stripped game dumps.'
    },
    {
      title: 'Chunk Loop Diagnostics',
      description: 'Added runtime detection and in-modal remedies for missing chunk manifests and out-of-memory allocation loops.'
    }
  ],
  '1.5.0': [
    {
      title: 'Full Controller Navigation',
      description: 'Use the D-pad and Cross / Circle everywhere: menus, Settings, dialogs and setup. Controller rumble follows Haptic Feedback.'
    },
    {
      title: 'Playtime Tracking',
      description: 'Total playtime and your last session are now recorded for every game.'
    },
    {
      title: 'Safer Game Folders',
      description: 'Studio only reorganizes real game dumps, never moves your game assets by mistake, and can restore the original folder layout.'
    },
    {
      title: 'Faster and Fully Offline',
      description: 'No more freezes while loading large libraries or launching games, and fonts and artwork no longer need an internet connection.'
    },
    {
      title: 'Security Hardening',
      description: 'Electron 44, a strict content security policy, verified toolchain downloads, a warning before building community code, and safer GitHub sign-in.'
    },
    {
      title: 'Honest Diagnostics and Fixes',
      description: 'Real hardware checks, a real NID audit (or a clear reason why not), working Merged Builds, Settings that take effect, and many launcher fixes.'
    }
  ],
  '1.5.1': [
    {
      title: 'AnyPS5 Core v0.1.4',
      description: 'The bundled relinker and system libraries are updated from AnyPS5 v0.1.2 to v0.1.4, bringing the latest upstream compatibility work.'
    },
    {
      title: 'Relink Your Games',
      description: 'Titles relinked with the previous core may need relinking: if a game fails to start, open Relinker Studio and relink it.'
    },
    {
      title: 'Verified Core Downloads',
      description: 'The bundled core is checked against the checksums AnyPS5 publishes for each release.'
    }
  ]
};

export const DEFAULT_FALLBACK_HIGHLIGHTS: ReleaseHighlight[] = [
  {
    title: 'System Stability & Performance',
    description: 'Internal performance optimizations, translation refinements, and security improvements.'
  },
  {
    title: 'Routine Maintenance',
    description: 'Upstream compatibility fixes and platform reliability enhancements.'
  }
];

export function getReleaseHighlights(version: string): ReleaseHighlight[] {
  if (!version) {
    return DEFAULT_FALLBACK_HIGHLIGHTS;
  }

  const cleanVersion = version.replace(/^v/, '').trim();
  if (RELEASE_HIGHLIGHTS_MAP[cleanVersion]) {
    return RELEASE_HIGHLIGHTS_MAP[cleanVersion];
  }

  const baseVersion = cleanVersion.split('-')[0];
  if (RELEASE_HIGHLIGHTS_MAP[baseVersion]) {
    return RELEASE_HIGHLIGHTS_MAP[baseVersion];
  }

  return DEFAULT_FALLBACK_HIGHLIGHTS;
}
