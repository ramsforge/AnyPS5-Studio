<div align="center">

# AnyPS5 Studio

**A PlayStation 5–style desktop launcher for [AnyPS5](https://github.com/boykopovar/AnyPS5): import a decrypted PS5 game, relink it and play it on Windows or Linux, with no setup.**

[![Release](https://img.shields.io/github/v/release/ramsforge/AnyPS5-Studio?color=0070d1&label=release)](https://github.com/ramsforge/AnyPS5-Studio/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ramsforge/AnyPS5-Studio/total?color=34d399)](https://github.com/ramsforge/AnyPS5-Studio/releases)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20x64-555)
[![License](https://img.shields.io/badge/license-GPL--2.0-blue)](LICENSE)

[**Download**](https://github.com/ramsforge/AnyPS5-Studio/releases/latest) · [What's new](https://github.com/ramsforge/AnyPS5-Studio/releases) · [Quick start](#quick-start) · [Troubleshooting](#troubleshooting) · [Report an issue](https://github.com/ramsforge/AnyPS5-Studio/issues)

<img src="https://raw.githubusercontent.com/ramsforge/AnyPS5-Studio/assets/01_HomeScreen_DreamingSarah.png" alt="AnyPS5 Studio home screen" width="900" />

</div>

## What is this?

[AnyPS5](https://github.com/boykopovar/AnyPS5) is not an emulator. It **relinks** a decrypted PS5 executable into a native Windows (`app.exe`) or Linux (`app.elf`) program that runs directly on your CPU and GPU, against clean-room reimplementations of the PS5 system libraries and a Vulkan renderer.

AnyPS5 Studio is the app around it. It ships the relinker and libraries, prepares your game folders the way the relinker expects, and gives you a console-style library to launch games from, so you never have to touch a command line.

> [!NOTE]
> Studio is a launcher and UI only. Game compatibility depends on the AnyPS5 core: a game that does not run usually needs an upstream fix, not a Studio one. See [Where to report problems](#where-to-report-problems).

## Features

- **Console-style library**: cover art, hero backdrops, UI sounds, and playtime and last-played tracking for every game.
- **Full controller support**: navigate every screen with a DualSense or Xbox controller (see [Controls](#controls)), with optional rumble.
- **One-click relinking**: *Relinker Studio* picks the right settings for your PC in Simple mode; Advanced mode exposes target OS, CPU translation, subsystem and import filtering.
- **Hands-off folder preparation**: unpacks wrapper folders, sets up `app0/`, unwraps SELF modules, deploys the system libraries and isolates leftovers that break the relinker. Every change is recorded, and **Restore Original Folder Layout** puts the dump back.
- **Launcher with crash diagnostics**: live logs, and plain-language explanations for common failures (missing modules, unimplemented PS5 APIs, Vulkan or Linux library problems).
- **Bulk import**: scan a folder to add every PS5 title inside it.
- **NID inspector**: see which imported PS5 functions the libraries implement, stub or miss.
- **Runtime manager**: switch between the bundled core, CI builds of upstream commits, community pull requests built on your PC, or your own build, globally or per game.
- **Automatic updates** from GitHub Releases, with a "What's new" summary after each update.
- **Private by default**: no telemetry; everything stays on your PC ([Privacy Policy](PRIVACY.md)).

<details>
<summary><b>More screenshots</b></summary>

| Relinker Studio | Game launcher |
| :---: | :---: |
| <img src="https://raw.githubusercontent.com/ramsforge/AnyPS5-Studio/assets/04_RelinkerStudio_SimpleMode.png" alt="Relinker Studio" width="440" /> | <img src="https://raw.githubusercontent.com/ramsforge/AnyPS5-Studio/assets/10_GameLauncher_ActiveSession.png" alt="Game launcher" width="440" /> |
| **NID inspector** | **System telemetry** |
| <img src="https://raw.githubusercontent.com/ramsforge/AnyPS5-Studio/assets/06_NidInspector.png" alt="NID inspector" width="440" /> | <img src="https://raw.githubusercontent.com/ramsforge/AnyPS5-Studio/assets/08_SystemTelemetry.png" alt="System telemetry" width="440" /> |

</details>

## Requirements

| | Minimum |
| --- | --- |
| **OS** | Windows 10 / 11 (64-bit), or a 64-bit Linux distribution |
| **CPU** | x86-64 with AVX2 (Intel 4th-gen Core / AMD Ryzen or newer) |
| **GPU** | Vulkan 1.1 driver (NVIDIA, AMD or Intel) |
| **RAM** | 16 GB recommended |
| **Games** | Your own decrypted PS5 game dumps |
| **Optional** | [Python 3](https://www.python.org/downloads/) for the NID inspector |

## Installation

### Windows

1. Download **`AnyPS5-Studio-Setup-<version>.exe`** from the [latest release](https://github.com/ramsforge/AnyPS5-Studio/releases/latest).
2. Run it. It installs for your user only (no administrator prompt) and creates desktop and Start menu shortcuts.

### Linux

1. Download **`AnyPS5-Studio-<version>.AppImage`** from the [latest release](https://github.com/ramsforge/AnyPS5-Studio/releases/latest).
2. Make it executable and run it:

   ```bash
   chmod +x AnyPS5-Studio-*.AppImage
   ./AnyPS5-Studio-*.AppImage
   ```

AppImages need **FUSE 2**, which many current distributions no longer install by default. If launching fails with `libfuse.so.2: cannot open shared object file`, install it:

| Distribution | Command |
| --- | --- |
| Ubuntu, Debian, Mint, Pop!_OS | `sudo apt install libfuse2` (Ubuntu 24.04+: `libfuse2t64`) |
| Fedora, RHEL | `sudo dnf install fuse-libs` |
| Arch, Manjaro, EndeavourOS, CachyOS | `sudo pacman -S --needed fuse2` |
| openSUSE | `sudo zypper install libfuse2` |

<details>
<summary>No FUSE available (containers, WSL2, sandboxes)?</summary>

Extract the AppImage and run it directly:

```bash
./AnyPS5-Studio-*.AppImage --appimage-extract
./squashfs-root/anyps5-ui
```

</details>

To add Studio to your application menu, use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher), or move the file to `~/.local/bin/anyps5-studio`.

### Updating

Studio checks for updates in the background and downloads them automatically. You will be asked to restart when an update is ready, and a "What's new" screen lists the changes. Your library and settings are kept.

## Quick start

1. **Run the first-time setup.** It checks your CPU, GPU and the bundled libraries, and asks where your games are.
2. **Add a game.** Click **Import PS5 Title** and pick a decrypted game folder, or use **Scan Directory** to add every title in a folder.
3. **Relink it.** Select the game, open **Relinker Studio** and press **Start Relinking Process**. The recommended settings are chosen for you.
4. **Play.** Press **Play Game** (or Cross on your controller).

> [!TIP]
> Studio reorganizes a game folder the first time it relinks or launches it. To use the dump with another tool afterwards, open the game's details panel and choose **Restore Original Folder Layout**.

## Controls

| Action | Controller | Keyboard |
| --- | --- | --- |
| Move between items | D-pad / left stick | Arrow keys |
| Select | Cross (A) | Enter |
| Back / close | Circle (B) | Escape |
| Switch tabs | L1 / R1 | Q / E |
| Change a dropdown value | Left / Right on the dropdown | Arrow keys |

On the game row, Left / Right choose a game and Cross plays it; press Down to reach the game's buttons. Studio ignores your controller while a game window is focused, so playing never presses buttons in Studio behind it.

## Troubleshooting

<details>
<summary><b>The game closes with "Unimplemented PlayStation 5 API" or crashes inside a system library</b></summary>

The game needs something the AnyPS5 core does not implement yet. Check the [AnyPS5 issues and discussions](https://github.com/boykopovar/AnyPS5) or try a newer core from **Runtimes** (CI commit builds or community pull requests).

</details>

<details>
<summary><b>"Vulkan initialization failed" / no usable Vulkan device</b></summary>

Install or update your GPU driver. On Linux also install your distribution's Vulkan driver package (for example `vulkan-radeon`, `vulkan-intel` or `nvidia-utils`). In a virtual machine, enable 3D acceleration.

</details>

<details>
<summary><b>Missing PlayGo metadata / the game runs out of memory at start</b></summary>

Some dumps lack PlayGo chunk files. In the launcher, set **PlayGo unlisted chunks** to "installed" or "absent" for that game and press Play again.

</details>

<details>
<summary><b>The NID inspector says Python 3 was not found</b></summary>

Install [Python 3](https://www.python.org/downloads/) (on Windows tick "Add python.exe to PATH"), then press the re-audit button (circular arrow) in the NID inspector.

</details>

<details>
<summary><b>Where are my settings and logs?</b></summary>

Studio stores its library, settings and runtimes in `%APPDATA%\AnyPS5 Studio` on Windows and `~/.config/AnyPS5 Studio` on Linux. A game's runtime log is `anyps5.log` in its folder; the launcher's **Technical Details** panel can copy a full diagnostics report.

</details>

### Where to report problems

- **Studio problems** (the app, importing, folder preparation, launching, the UI): [open an issue here](https://github.com/ramsforge/AnyPS5-Studio/issues) and include the diagnostics report from the launcher.
- **Game compatibility** (missing APIs, crashes inside system libraries, graphics bugs): report to [AnyPS5](https://github.com/boykopovar/AnyPS5).

## Building from source

Studio lives in [`ui/`](ui) (Electron, React, Vite, Tailwind). You need Node.js 22 or newer.

```bash
cd ui
npm ci
npm run electron      # build and start the desktop app
```

`npm run dev` serves the interface in a browser with simulated data, and `npm run dist` builds the installer. The installer bundles a relinker and system libraries built from the core; see [BUILD.md](docs/dev/BUILD.md) to build those, and [ARCHITECTURE.md](docs/dev/ARCHITECTURE.md) for how the core works.

## Credits

- [**AnyPS5**](https://github.com/boykopovar/AnyPS5) by boykopovar and its contributors: the relinker, system libraries and renderer that do the actual work. This repository tracks it; Studio only adds the launcher in `ui/`.

## Legal

AnyPS5 Studio is for interoperability, research and preservation. It does not include or distribute games, firmware, keys or other copyrighted material. Only use game dumps you made from games you own, in line with the law where you live.

PlayStation and PS5 are trademarks of Sony Interactive Entertainment Inc. This project is not affiliated with or endorsed by Sony.

[Terms of Service](TERMS.md) · [Privacy Policy](PRIVACY.md) · Licensed under [GPL-2.0](LICENSE)
