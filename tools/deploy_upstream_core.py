import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

UPSTREAM_VERSION = "v0.1.4"

RELEASE_ASSETS = {
    "windows": {
        "relinker_url": f"https://github.com/boykopovar/AnyPS5/releases/download/{UPSTREAM_VERSION}/relinker-{UPSTREAM_VERSION}.exe",
        "relinker_bin": "relinker.exe",
        "relinker_sha256": "6f6d49e3613ea7fce859621265068bfd64161a729a8051c83150f2d45ec193e0",
        "prx_sha256": "cbd61c521d555614dbcddc62cdabf45acfe409c520307cdb58732c8486dd0d7a",
        "prx_url": f"https://github.com/boykopovar/AnyPS5/releases/download/{UPSTREAM_VERSION}/prx-windows-{UPSTREAM_VERSION}.zip",
        "archive_type": "zip",
    },
    "linux": {
        "relinker_url": f"https://github.com/boykopovar/AnyPS5/releases/download/{UPSTREAM_VERSION}/relinker-{UPSTREAM_VERSION}",
        "relinker_bin": "relinker",
        "relinker_sha256": "9e5afd1313520906a9af43c468d6e31a5d2237879a85c0984134d628348e92a8",
        "prx_sha256": "805ba3f455924a9fc2ca9dae7b398f9c9d4e4b88b6251d738d64afed98f8e6ef",
        "prx_url": f"https://github.com/boykopovar/AnyPS5/releases/download/{UPSTREAM_VERSION}/prx-linux-{UPSTREAM_VERSION}.tar.gz",
        "archive_type": "tar.gz",
    },
}

def download_file(url: str, dest_path: Path) -> bool:
    print(f"Downloading {url} -> {dest_path}...")
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    curl_cmd = f'curl -sSL -f --retry 3 --retry-delay 2 -o "{dest_path}" "{url}"'
    res = subprocess.run(curl_cmd, shell=True, capture_output=True, text=True)
    if res.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
        return True

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AnyPS5-Studio-Deploy/1.4.5"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(dest_path, "wb") as out:
            shutil.copyfileobj(resp, out)
        return dest_path.exists() and dest_path.stat().st_size > 0
    except Exception as e:
        print(f"Download failed for {url}: {e}")
        return False

# SHA-256 digests GitHub publishes for the pinned upstream release assets; a mismatch stops the build.
def verify_sha256(path: Path, expected: str) -> bool:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != expected:
        print(f"ERROR: {path.name} failed SHA-256 verification (expected {expected}, got {actual}).")
        return False
    print(f"Verified {path.name} (SHA-256 {actual}).")
    return True

def deploy(target_platform: str) -> bool:
    is_linux = (target_platform == "linux")
    cfg = RELEASE_ASSETS.get(target_platform)
    if not cfg:
        print(f"Unsupported target platform: {target_platform}")
        return False

    relinker_bin_name = cfg["relinker_bin"]
    temp_dir = ROOT / f"dist-upstream-download-{target_platform}"
    if temp_dir.exists():
        shutil.rmtree(temp_dir, ignore_errors=True)
    temp_dir.mkdir(parents=True, exist_ok=True)

    print(f"Deploying official upstream core {UPSTREAM_VERSION} for {target_platform}...")

    # 1. Download official relinker binary
    temp_relinker = temp_dir / relinker_bin_name
    if not download_file(cfg["relinker_url"], temp_relinker):
        print(f"ERROR: Failed to download official relinker binary from {cfg['relinker_url']}")
        shutil.rmtree(temp_dir, ignore_errors=True)
        return False
    if not verify_sha256(temp_relinker, cfg["relinker_sha256"]):
        shutil.rmtree(temp_dir, ignore_errors=True)
        return False

    # 2. Download official PRX archive
    archive_ext = ".zip" if cfg["archive_type"] == "zip" else ".tar.gz"
    archive_path = temp_dir / f"prx-archive{archive_ext}"
    if not download_file(cfg["prx_url"], archive_path):
        print(f"ERROR: Failed to download official PRX archive from {cfg['prx_url']}")
        shutil.rmtree(temp_dir, ignore_errors=True)
        return False
    if not verify_sha256(archive_path, cfg["prx_sha256"]):
        shutil.rmtree(temp_dir, ignore_errors=True)
        return False

    # 3. Extract PRX archive
    extract_dir = temp_dir / "extracted"
    extract_dir.mkdir(parents=True, exist_ok=True)
    print(f"Extracting PRX archive ({archive_path.name})...")
    try:
        if cfg["archive_type"] == "zip":
            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(extract_dir)
        else:
            with tarfile.open(archive_path, "r:gz") as tf:
                tf.extractall(extract_dir)
    except Exception as extract_err:
        print(f"ERROR: Failed to extract PRX archive: {extract_err}")
        shutil.rmtree(temp_dir, ignore_errors=True)
        return False

    # 4. Discover all extracted PRX and runtime libraries
    extracted_prxs = []
    for root_path, _, files in os.walk(extract_dir):
        for f in files:
            p = Path(root_path) / f
            lower = f.lower()
            if lower.endswith(".prx") or lower.endswith(".dll") or lower.endswith(".so"):
                extracted_prxs.append(p)

    # 6. Deploy relinker binary
    target_build = ROOT / "build"
    target_build.mkdir(parents=True, exist_ok=True)
    dst_relinker = target_build / relinker_bin_name
    shutil.copy2(temp_relinker, dst_relinker)
    if is_linux:
        try:
            os.chmod(dst_relinker, 0o755)
        except OSError:
            pass
    print(f"Deployed {relinker_bin_name} to {dst_relinker}")

    unpacked_build = ROOT / "ui" / "dist-installer" / ("linux-unpacked" if is_linux else "win-unpacked") / "resources" / "build"
    if unpacked_build.exists():
        unpacked_dst = unpacked_build / relinker_bin_name
        shutil.copy2(temp_relinker, unpacked_dst)
        if is_linux:
            try:
                os.chmod(unpacked_dst, 0o755)
            except OSError:
                pass
        print(f"Deployed {relinker_bin_name} to {unpacked_dst}")

    # 7. Deploy PRX libraries
    target_libs = ROOT / "libs"
    target_libs.mkdir(parents=True, exist_ok=True)
    unpacked_libs = ROOT / "ui" / "dist-installer" / ("linux-unpacked" if is_linux else "win-unpacked") / "resources" / "libs"

    prx_count = 0
    lib_count = 0
    for item in extracted_prxs:
        dst = target_libs / item.name
        shutil.copy2(item, dst)
        if is_linux:
            try:
                os.chmod(dst, 0o755)
            except OSError:
                pass

        if unpacked_libs.exists():
            unpacked_dst_lib = unpacked_libs / item.name
            shutil.copy2(item, unpacked_dst_lib)
            if is_linux:
                try:
                    os.chmod(unpacked_dst_lib, 0o755)
                except OSError:
                    pass

        if item.suffix.lower() == ".prx":
            prx_count += 1
        else:
            lib_count += 1

    # Apply any local PRX/DLL overrides from core/libs/overrides
    override_candidates = [
        ROOT / "core" / "libs" / "overrides",
        ROOT / "ui" / "core" / "libs" / "overrides",
    ]
    for cand in override_candidates:
        if cand.exists() and cand.is_dir():
            for ov in cand.iterdir():
                if ov.is_file():
                    shutil.copy2(ov, target_libs / ov.name)
                    if is_linux:
                        try:
                            os.chmod(target_libs / ov.name, 0o755)
                        except OSError:
                            pass
                    print(f"Applied override: {ov.name}")
            break

    print(f"Successfully deployed {prx_count} PRX libraries and {lib_count} runtime libraries to libs/ and unpacked resources.")
    if prx_count < 50:
        print(f"ERROR: Expected at least 50 PRX libraries, but found only {prx_count}!")
        shutil.rmtree(temp_dir, ignore_errors=True)
        return False

    shutil.rmtree(temp_dir, ignore_errors=True)
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deploy AnyPS5 upstream core binaries")
    parser.add_argument("--platform", choices=["windows", "linux"], default="linux" if sys.platform.startswith("linux") else "windows")
    args = parser.parse_args()

    success = deploy(args.platform)
    sys.exit(0 if success else 1)
