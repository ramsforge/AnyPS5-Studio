import { safeStorage, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { extractZip } from './archive';
import { GitHubAuthStatus, GitHubDeviceCodeResponse, UpstreamCommit, UpstreamComparison, CommitsPageResult } from '../src/types';
import { RuntimeManager } from './runtimeManager';

// AnyPS5 Studio Public GitHub OAuth App Client ID (read-only public data)
const DEFAULT_CLIENT_ID = 'Ov23libPwltvelBgylv6';

export class GitHubAuthService {
  private userDataDir: string;
  private authStorePath: string;
  private clientId: string;
  private sessionToken: string | null = null;

  constructor(userDataDir: string, clientId: string = DEFAULT_CLIENT_ID) {
    this.userDataDir = userDataDir;
    this.authStorePath = path.join(userDataDir, 'github_auth.dat');
    this.clientId = clientId;
  }

  /**
   * Securely store access token using Windows DPAPI (via Electron safeStorage)
   */
  public saveToken(token: string): void {
    this.sessionToken = token.trim();
    try {
      if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(this.authStorePath, safeStorage.encryptString(this.sessionToken));
      } else {
        // No OS keychain (common on Linux without a secret service): keep the token for this session only
        // instead of writing it to disk in readable form.
        if (fs.existsSync(this.authStorePath)) fs.unlinkSync(this.authStorePath);
        console.warn('OS secure storage unavailable; GitHub token kept in memory for this session only.');
      }
    } catch (err) {
      console.error('Failed to securely save GitHub token:', (err as Error)?.message || err);
      throw new Error('Failed to encrypt and store GitHub authorization token.');
    }
  }

  /**
   * Retrieve and decrypt access token
   */
  public getToken(): string | null {
    if (this.sessionToken) return this.sessionToken;
    try {
      if (!fs.existsSync(this.authStorePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.authStorePath);
      if (safeStorage.isEncryptionAvailable()) {
        try {
          this.sessionToken = safeStorage.decryptString(raw);
          return this.sessionToken;
        } catch {
          // Legacy builds wrote base64 plain text here when no keychain was available: re-save it encrypted.
          const legacy = Buffer.from(raw.toString('utf8'), 'base64').toString('utf8');
          if (!/^[\w-]+$/.test(legacy)) return null;
          this.saveToken(legacy);
          return legacy;
        }
      }
      // Legacy plain-text file and still no keychain: use it this session, but remove it from disk.
      const legacy = Buffer.from(raw.toString('utf8'), 'base64').toString('utf8');
      fs.unlinkSync(this.authStorePath);
      if (!/^[\w-]+$/.test(legacy)) return null;
      this.sessionToken = legacy;
      return legacy;
    } catch (err) {
      console.warn('Could not read or decrypt stored GitHub token:', (err as Error)?.message || err);
      return null;
    }
  }

  /**
   * Clear stored token (disconnect)
   */
  public disconnect(): boolean {
    this.sessionToken = null;
    try {
      if (fs.existsSync(this.authStorePath)) {
        fs.unlinkSync(this.authStorePath);
      }
      return true;
    } catch (err) {
      console.error('Failed to delete GitHub auth token:', err);
      return false;
    }
  }

  /**
   * RFC 8628: Request device and user verification codes
   */
  public async requestDeviceCode(): Promise<GitHubDeviceCodeResponse> {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'AnyPS5-Studio-Desktop',
      },
      // No scope: reading public repositories and downloading their Actions artifacts needs no write access.
      body: new URLSearchParams({
        client_id: this.clientId,
      }).toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('GitHub Device Code Request failed:', res.status, text);
      throw new Error(`GitHub Device Code Request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    console.log('GitHub Device Code response:', JSON.stringify({ user_code: data.user_code, device_code: data.device_code ? '[PRESENT]' : '[MISSING]', interval: data.interval, expires_in: data.expires_in }));

    if (!data.device_code || !data.user_code) {
      console.error('GitHub Device Code response missing required fields:', data.error || 'unknown');
      throw new Error(data.error_description || data.error || 'GitHub did not return a valid device code.');
    }

    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval || 5,
    };
  }

  /**
   * RFC 8628: Poll GitHub token endpoint once
   */
  public async checkDeviceCode(deviceCode: string): Promise<{
    status: 'pending' | 'slow_down' | 'approved' | 'expired' | 'error';
    accessToken?: string;
    interval?: number;
    error?: string;
  }> {
    let res: Response;
    try {
      res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AnyPS5-Studio-Desktop',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
      });
    } catch (fetchErr: any) {
      console.error('checkDeviceCode fetch error:', fetchErr?.message || fetchErr);
      return { status: 'error', error: `Network error: ${fetchErr?.message || String(fetchErr)}` };
    }

    const responseText = await res.text();

    if (!res.ok) {
      return { status: 'error', error: `HTTP ${res.status}` };
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('checkDeviceCode: failed to parse JSON response.');
      return { status: 'error', error: 'GitHub returned invalid JSON response.' };
    }

    if (data.access_token) {
      console.log('checkDeviceCode: access_token received, saving token.');
      this.saveToken(data.access_token);
      return { status: 'approved' };
    }

    if (data.error === 'authorization_pending') {
      return { status: 'pending' };
    }
    if (data.error === 'slow_down') {
      return { status: 'slow_down', interval: typeof data.interval === 'number' ? data.interval : undefined };
    }
    if (data.error === 'expired_token') {
      return { status: 'expired', error: 'Device code expired. Please request a new code.' };
    }

    console.error('checkDeviceCode unexpected response:', data.error || 'unknown');
    return { status: 'error', error: data.error_description || data.error || 'Authorization failed' };
  }

  /**
   * Set Personal Access Token manually
   */
  public async setPersonalAccessToken(token: string): Promise<{ success: boolean; username?: string; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      return { success: false, error: 'Token cannot be empty.' };
    }

    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'AnyPS5-Studio-Desktop',
        },
      });

      if (!res.ok) {
        return { success: false, error: `Invalid token or unauthorized (HTTP ${res.status})` };
      }

      const userData = await res.json();
      this.saveToken(cleanToken);
      return { success: true, username: userData.login };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Get current auth status and rate limits
   */
  public async getAuthStatus(): Promise<GitHubAuthStatus> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'AnyPS5-Studio-Desktop',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const rateRes = await fetch('https://api.github.com/rate_limit', { headers });
      let rateLimit = undefined;
      if (rateRes.ok) {
        const rateData = await rateRes.json();
        const core = rateData?.resources?.core;
        if (core) {
          rateLimit = {
            limit: core.limit,
            remaining: core.remaining,
            reset: core.reset,
          };
        }
      }

      if (token) {
        const userRes = await fetch('https://api.github.com/user', { headers });
        if (userRes.ok) {
          const user = await userRes.json();
          return {
            isConnected: true,
            username: user.login,
            avatarUrl: user.avatar_url,
            rateLimit,
          };
        }
      }

      return {
        isConnected: false,
        rateLimit,
      };
    } catch (err) {
      return {
        isConnected: Boolean(token),
        rateLimit: undefined,
      };
    }
  }

  /**
   * Fetch paginated upstream commits from AnyPS5 (default per_page=100)
   */
  public async fetchCommits(
    repo: string = 'boykopovar/AnyPS5',
    page: number = 1,
    perPage: number = 100,
    runtimeManager: RuntimeManager
  ): Promise<CommitsPageResult> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'AnyPS5-Studio-Desktop',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const cleanPerPage = Math.min(Math.max(perPage, 1), 100);
    const res = await fetch(`https://api.github.com/repos/${repo}/commits?page=${page}&per_page=${cleanPerPage}`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch commits from ${repo} (HTTP ${res.status})`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      return { commits: [], hasMore: false, page };
    }

    const manifest = runtimeManager.getManifest();
    const installedIds = new Set(manifest.runtimes.map(r => r.commitHash ? r.commitHash.substring(0, 7) : ''));
    const activeRuntime = manifest.runtimes.find(r => r.id === manifest.activeGlobalRuntimeId);
    const activeSha = activeRuntime?.commitHash ? activeRuntime.commitHash.substring(0, 7) : '';

    const commits: UpstreamCommit[] = data.map((item: any) => {
      const sha = item.sha;
      const shortSha = sha ? sha.substring(0, 7) : 'unknown';
      const isInstalled = installedIds.has(shortSha);
      const isActive = isInstalled && activeSha === shortSha;

      return {
        sha,
        shortSha,
        message: item.commit?.message?.split('\n')[0] || 'Commit ' + shortSha,
        author: item.commit?.author?.name || item.author?.login || 'contributor',
        authorAvatar: item.author?.avatar_url || '',
        date: item.commit?.author?.date || new Date().toISOString(),
        htmlUrl: item.html_url,
        isInstalled,
        isActive,
        artifactAvailable: true,
      };
    });

    return {
      commits,
      hasMore: data.length >= cleanPerPage,
      page,
    };
  }

  /**
   * Compare installed / stable baseline against upstream HEAD using GitHub compare API
   */
  public async compareWithHead(
    baseSha?: string,
    headRef: string = 'main',
    repo: string = 'boykopovar/AnyPS5',
    runtimeManager?: RuntimeManager
  ): Promise<UpstreamComparison> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'AnyPS5-Studio-Desktop',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Determine base SHA / identifier
    let cleanBase = (baseSha || '').trim();
    if (!cleanBase && runtimeManager) {
      const active = runtimeManager.resolveRuntime();
      if (active && active.commitHash && active.commitHash !== 'stable-baseline' && active.commitHash !== 'fallback') {
        cleanBase = active.commitHash;
      }
    }

    // 1. If base is missing, 'stable-baseline', or has no valid Git hex SHA or release tag:
    //    Query GitHub for the latest release: GET /repos/boykopovar/AnyPS5/releases/latest
    //    Use the release's tag_name as the base.
    const isTag = /^v[0-9.]+/i.test(cleanBase);
    const isSha = /^[0-9a-f]{7,40}$/i.test(cleanBase);
    let compareBase = cleanBase;

    if ((!isTag && !isSha) || cleanBase === 'stable-baseline' || !cleanBase) {
      try {
        const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
        if (releaseRes.ok) {
          const releaseData = await releaseRes.json();
          if (releaseData && releaseData.tag_name) {
            compareBase = releaseData.tag_name;
          }
        }
      } catch (err) {
        console.warn('Failed to query latest release for base comparison:', err);
      }
    }

    // 2. Call GitHub compare API: GET /repos/boykopovar/AnyPS5/compare/${compareBase}...${headRef}
    if (compareBase && compareBase !== 'stable-baseline' && compareBase !== 'fallback') {
      try {
        const compareRes = await fetch(`https://api.github.com/repos/${repo}/compare/${compareBase}...${headRef}`, { headers });
        if (compareRes.ok) {
          const data = await compareRes.json();
          const headCommit = (data.commits && data.commits.length > 0)
            ? data.commits[data.commits.length - 1]
            : data.base_commit;

          const aheadBy = typeof data.ahead_by === 'number' ? data.ahead_by : 0;
          const isUpToDate = data.status === 'identical' || aheadBy === 0;

          return {
            status: data.status || (isUpToDate ? 'identical' : 'ahead'),
            aheadBy,
            behindBy: typeof data.behind_by === 'number' ? data.behind_by : 0,
            headSha: headCommit?.sha || '',
            headShortSha: headCommit?.sha ? headCommit.sha.substring(0, 7) : '',
            headCommitMessage: headCommit?.commit?.message?.split('\n')[0] || 'Latest upstream commit',
            headCommitDate: headCommit?.commit?.author?.date || new Date().toISOString(),
            headCommitAuthor: headCommit?.commit?.author?.name || headCommit?.author?.login || 'contributor',
            isUpToDate,
          };
        }
      } catch (compareErr) {
        console.warn('GitHub compare error:', compareErr);
      }
    }

    // 3. Fallback: Fetch latest commit on headRef (without hardcoded aheadBy)
    try {
      const headRes = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`, { headers });
      if (headRes.ok) {
        const list = await headRes.json();
        const headCommit = Array.isArray(list) ? list[0] : null;
        if (headCommit) {
          const isUpToDate = Boolean(cleanBase && headCommit.sha && headCommit.sha.startsWith(cleanBase));
          return {
            status: isUpToDate ? 'identical' : 'ahead',
            aheadBy: 0,
            behindBy: 0,
            headSha: headCommit.sha || '',
            headShortSha: headCommit.sha ? headCommit.sha.substring(0, 7) : '',
            headCommitMessage: headCommit.commit?.message?.split('\n')[0] || 'Latest upstream commit',
            headCommitDate: headCommit.commit?.author?.date || new Date().toISOString(),
            headCommitAuthor: headCommit.commit?.author?.name || headCommit.author?.login || 'contributor',
            isUpToDate,
          };
        }
      }
    } catch {}

    // Offline / unavailable fallback
    return {
      status: 'unknown',
      aheadBy: 0,
      behindBy: 0,
      headSha: '',
      headShortSha: '',
      headCommitMessage: 'Unable to connect to GitHub upstream',
      headCommitDate: new Date().toISOString(),
      headCommitAuthor: 'system',
      isUpToDate: false,
    };
  }

  /**
   * Download and install a real pre-compiled commit artifact from GitHub Actions
   */
  public async downloadCommitArtifact(
    commit: { sha: string; shortSha: string; message: string; date?: string },
    runtimeManager: RuntimeManager,
    onProgress?: (status: 'downloading' | 'extracting' | 'ready' | 'error', progress: number, error?: string) => void
  ): Promise<{ success: boolean; runtimeId?: string; error?: string }> {
    if (typeof commit?.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(commit.sha)) {
      const err = 'Invalid commit SHA.';
      onProgress?.('error', 0, err);
      return { success: false, error: err };
    }
    commit = { ...commit, shortSha: commit.sha.slice(0, 7).toLowerCase(), message: String(commit.message ?? '') };

    const token = this.getToken();
    if (!token) {
      const err = 'GitHub authorization required. Please connect your GitHub account first.';
      onProgress?.('error', 0, err);
      return { success: false, error: err };
    }

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'AnyPS5-Studio-Desktop',
      'Authorization': `Bearer ${token}`,
    };

    const targetDir = path.join(this.userDataDir, 'runtimes', 'commits', `commit-${commit.shortSha}`);
    const binName = process.platform === 'win32' ? 'relinker.exe' : 'relinker';

    try {
      onProgress?.('downloading', 10);

      const candidateRepos = ['boykopovar/AnyPS5', 'ramsforge/AnyPS5-Studio'];
      let targetArtifact: { id: number; name: string; archive_download_url: string; repo: string } | null = null;

      for (const repo of candidateRepos) {
        try {
          const runsRes = await fetch(
            `https://api.github.com/repos/${repo}/actions/runs?head_sha=${commit.sha}&status=success`,
            { headers }
          );

          if (!runsRes.ok) continue;

          const runsData: any = await runsRes.json();
          const runs: any[] = runsData.workflow_runs || [];

          for (const run of runs) {
            const artifactsRes = await fetch(
              `https://api.github.com/repos/${repo}/actions/runs/${run.id}/artifacts`,
              { headers }
            );

            if (!artifactsRes.ok) continue;

            const artifactsData: any = await artifactsRes.json();
            const artifacts: any[] = artifactsData.artifacts || [];

            // Match Windows / Core / Relinker artifacts
            const isWindows = process.platform === 'win32';
            const matched = artifacts.find((a: any) => {
              const n = (a.name || '').toLowerCase();
              if (isWindows) {
                return (
                  n.includes('windows') ||
                  n.includes('win64') ||
                  n.includes('win-x64') ||
                  n.includes('relinker') ||
                  n.includes('anyps5') ||
                  n.includes('upstream-core')
                );
              } else {
                return (
                  n.includes('linux') ||
                  n.includes('linux-x64') ||
                  n.includes('relinker') ||
                  n.includes('anyps5') ||
                  n.includes('upstream-core')
                );
              }
            });

            if (matched) {
              targetArtifact = {
                id: matched.id,
                name: matched.name,
                archive_download_url: matched.archive_download_url,
                repo,
              };
              break;
            }
          }

          if (targetArtifact) break;
        } catch (searchErr) {
          console.warn(`Error querying workflow runs for ${repo}:`, searchErr);
        }
      }

      if (!targetArtifact) {
        const errorMsg = 'No compiled CI artifact available for this commit on GitHub Actions.';
        onProgress?.('error', 0, errorMsg);
        return { success: false, error: errorMsg };
      }

      onProgress?.('downloading', 30);

      // Download the artifact zip archive
      const downloadRes = await fetch(
        `https://api.github.com/repos/${targetArtifact.repo}/actions/artifacts/${targetArtifact.id}/zip`,
        { headers }
      );

      if (!downloadRes.ok) {
        const downloadErr = `Failed to download artifact (${downloadRes.status} ${downloadRes.statusText}).`;
        onProgress?.('error', 0, downloadErr);
        return { success: false, error: downloadErr };
      }

      onProgress?.('downloading', 60);

      const arrayBuffer = await downloadRes.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuffer);

      onProgress?.('downloading', 80);

      // Prepare temp extraction location
      const tempZipPath = path.join(this.userDataDir, 'runtimes', `temp_artifact_${commit.shortSha}.zip`);
      const tempExtractDir = path.join(this.userDataDir, 'runtimes', `temp_extracted_${commit.shortSha}`);

      fs.writeFileSync(tempZipPath, zipBuffer);

      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempExtractDir, { recursive: true });

      onProgress?.('extracting', 85);

      // Extract zip archive
      try {
        await extractZip(tempZipPath, tempExtractDir);
      } finally {
        if (fs.existsSync(tempZipPath)) {
          try { fs.unlinkSync(tempZipPath); } catch {}
        }
      }

      onProgress?.('extracting', 92);

      // Ensure destination directory is clean
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetDir, { recursive: true });

      // Locate relinker executable and libs directory within extracted tree
      let foundRelinker: string | null = null;
      let foundLibsDir: string | null = null;

      const scanDirectory = (current: string) => {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isFile()) {
            if (entry.name.toLowerCase() === binName.toLowerCase()) {
              foundRelinker = full;
            }
          } else if (entry.isDirectory()) {
            if (entry.name.toLowerCase() === 'libs') {
              foundLibsDir = full;
            }
            scanDirectory(full);
          }
        }
      };

      scanDirectory(tempExtractDir);

      const targetLibs = path.join(targetDir, 'libs');
      if (!fs.existsSync(targetLibs)) {
        fs.mkdirSync(targetLibs, { recursive: true });
      }

      // Copy relinker executable
      const finalRelinkerPath = path.join(targetDir, binName);
      if (foundRelinker && fs.existsSync(foundRelinker)) {
        fs.copyFileSync(foundRelinker, finalRelinkerPath);
      } else {
        // If relinker wasn't at a standard name, check root files of extracted artifact
        const rootFiles = fs.readdirSync(tempExtractDir);
        const candidate = rootFiles.find(f => f.toLowerCase().startsWith('relinker'));
        if (candidate) {
          fs.copyFileSync(path.join(tempExtractDir, candidate), finalRelinkerPath);
        } else {
          const failMsg = 'CI artifact archive did not contain relinker executable.';
          onProgress?.('error', 0, failMsg);
          return { success: false, error: failMsg };
        }
      }

      if (process.platform !== 'win32') {
        try { fs.chmodSync(finalRelinkerPath, 0o755); } catch {}
      }

      // Copy PRX / DLL libraries
      if (foundLibsDir && fs.existsSync(foundLibsDir)) {
        const files = fs.readdirSync(foundLibsDir);
        for (const f of files) {
          const src = path.join(foundLibsDir, f);
          const dst = path.join(targetLibs, f);
          if (fs.statSync(src).isFile()) {
            fs.copyFileSync(src, dst);
            if (process.platform !== 'win32') {
              try { fs.chmodSync(dst, 0o755); } catch {}
            }
          }
        }
      } else {
        // Collect all .prx and .dll files recursively from extracted output
        const collectLibs = (dir: string) => {
          const list = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of list) {
            const p = path.join(dir, item.name);
            if (item.isFile()) {
              const lower = item.name.toLowerCase();
              if (lower.endsWith('.prx') || lower.endsWith('.dll')) {
                fs.copyFileSync(p, path.join(targetLibs, item.name));
              }
            } else if (item.isDirectory()) {
              collectLibs(p);
            }
          }
        };
        collectLibs(tempExtractDir);
      }

      // Cleanup temp extraction directory
      try {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      } catch {}

      // Write commit metadata
      const metaPath = path.join(targetDir, 'commit-info.json');
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            sha: commit.sha,
            shortSha: commit.shortSha,
            message: commit.message,
            artifactId: targetArtifact.id,
            artifactName: targetArtifact.name,
            installedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );

      // Register profile in runtimes manifest
      const runtimeId = `commit-${commit.shortSha}`;
      const manifest = runtimeManager.getManifest();
      const existingIdx = manifest.runtimes.findIndex(r => r.id === runtimeId);
      const profile = {
        id: runtimeId,
        name: `Commit ${commit.shortSha} (${commit.message.substring(0, 32)}...)`,
        type: 'ci-artifact' as const,
        commitHash: commit.sha,
        commitMessage: commit.message,
        date: commit.date || new Date().toISOString(),
        path: path.relative(path.join(this.userDataDir, 'runtimes'), targetDir),
        relinkerPath: finalRelinkerPath,
        libsPath: targetLibs,
        isRemovable: true,
      };

      if (existingIdx >= 0) {
        manifest.runtimes[existingIdx] = profile;
      } else {
        manifest.runtimes.push(profile);
      }
      runtimeManager.saveManifest(manifest);

      onProgress?.('ready', 100);
      return { success: true, runtimeId };
    } catch (err: any) {
      console.error('downloadCommitArtifact error:', err);
      const errMsg = err?.message || String(err);
      onProgress?.('error', 0, errMsg);
      return { success: false, error: errMsg };
    }
  }
}
