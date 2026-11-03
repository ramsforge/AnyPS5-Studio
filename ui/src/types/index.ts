export type PortingStatus = 'ported' | 'ready_to_relink' | 'converting' | 'missing_prx';

export interface GameItem {
  id: string;
  title: string;
  titleId: string;
  version: string;
  category: 'game' | 'app';
  status: PortingStatus;
  path: string;
  executableName: string;
  targetPlatform: 'windows' | 'linux';
  description?: string;
  isSample?: boolean;
  iconUrl: string;
  backdropUrl: string;
  lastPlayed?: string;
  // Recorded by the launcher when a session ends.
  playTimeSeconds?: number;
  lastPlayedAt?: string;
  playTime?: string;
  sizeBytes: number;
  sdkVersion: string;
  minHostCpu: string;
  runtimeId?: string;
  compatibility: {
    status: 'playable' | 'ingame' | 'intro' | 'untested';
    score: number; // percentage
    resolvedNids: number;
    totalNids: number;
    unresolvedModules: string[];
    missingNids: { nid: string; module: string; funcGuess?: string }[];
    amdInstructionsDetected: number;
  };
}

export interface DiscoveredGameCandidate {
  path: string;
  title: string;
  titleId: string;
  version: string;
  iconUrl: string;
  backdropUrl: string;
  sizeBytes: number;
  hasEboot: boolean;
}

export type NidImportStatus = 'implemented' | 'stub' | 'missing';

export interface NidImportItem {
  nid: string;
  symbol: string;
  module: string;
  status: NidImportStatus;
  implementationNotes?: string;
}

export interface NidAuditSummary {
  totalImports: number;
  resolvedCount: number;
  stubCount: number;
  missingCount: number;
  coveragePercentage: number;
}

export interface NidAuditResult {
  summary: NidAuditSummary;
  imports: NidImportItem[];
  error?: string;
}

export interface RelinkerOptions {
  target: 'windows' | 'linux' | 'macos';
  subsystem: 'gui' | 'console';
  cpuTranslation: 'none' | 'intel' | 'rosetta';
  unusedFilter: 0 | 1 | 2;
  rpath: string;
  traceImports: boolean;
  windowsDiagnostics: boolean;
  fixedBaseAddress: string;
  autorun: boolean;
  sceModulePath: string;
  runtimeId?: string;
}

export type RuntimeType = 'bundled' | 'ci-artifact' | 'custom' | 'local-build';

export interface RuntimeProfile {
  id: string;
  name: string;
  type: RuntimeType;
  commitHash?: string;
  commitMessage?: string;
  date?: string;
  path: string;
  isRemovable: boolean;
  relinkerPath?: string;
  libsPath?: string;
}

export interface RuntimesManifest {
  activeGlobalRuntimeId: string;
  runtimes: RuntimeProfile[];
}

export interface ResolvedRuntime {
  id: string;
  name: string;
  type: RuntimeType;
  commitHash?: string;
  commitMessage?: string;
  date?: string;
  relinkerPath: string;
  libsPath: string;
  isRemovable: boolean;
  isValid: boolean;
  // Set when the requested runtime is missing or broken and this one is used instead.
  fallbackFrom?: { id: string; name: string };
}

export interface ConversionStage {
  id: number;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  progress?: number;
}

export interface ConversionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface SystemTelemetry {
  hostCpu: string;
  hasZen2Extensions: boolean;
  missingExtensions: string[];
  gpuName: string;
  vulkanVersion: string;
  memoryUsageMb: number;
  totalMemoryMb: number;
  relinkerBinaryFound: boolean;
  relinkerPath: string;
  prxVersion: string;
  osName?: string;
  cpuArchitecture?: string;
  recommendedCpuTranslation?: 'none' | 'intel' | 'rosetta';
  recommendationReason?: string;
  // Real host checks: null/undefined means it could not be determined.
  avx2?: boolean | null;
  vulkanAvailable?: boolean;
  prxCount?: number;
}

export interface DetectedGpu {
  name: string;
  vendor?: 'nvidia' | 'amd' | 'intel' | 'apple' | 'virtual' | 'other';
  isDiscrete: boolean;
  isVirtual: boolean;
  adapterRamMb?: number;
  driverVersion?: string;
}

export type PlaygoMode = 'installed' | 'absent' | 'default';

export interface PlaygoOverrideInfo {
  effective: 'installed' | 'absent' | null;
  custom: 'installed' | 'absent' | null;
  preset: 'installed' | 'absent' | null;
}

export interface AppSettings {
  relinkerPath: string;
  prxPath: string;
  defaultTarget: string;
  cpuFix: string;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  advanced: boolean;
  preferredGpu?: string;
  defaultRelinkerPath?: string;
  defaultPrxPath?: string;
  gameRuntimes?: Record<string, string>;
  defaultRuntimeId?: string;
  hasCompletedSetup?: boolean;
  lastSeenVersion?: string;
  gamesDirectory?: string;
  discordRpcEnabled: boolean;
  discordClientId?: string;
  playgoOverrides?: Record<string, 'installed' | 'absent'>;
}

export interface GitHubAuthStatus {
  isConnected: boolean;
  username?: string;
  avatarUrl?: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: number;
  };
}

export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface UpstreamCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorAvatar?: string;
  date: string;
  htmlUrl: string;
  isInstalled: boolean;
  isActive: boolean;
  artifactAvailable?: boolean;
}

export interface UpstreamComparison {
  status: 'ahead' | 'identical' | 'behind' | 'diverged' | 'unknown';
  aheadBy: number;
  behindBy: number;
  headSha: string;
  headShortSha: string;
  headCommitMessage: string;
  headCommitDate: string;
  headCommitAuthor: string;
  isUpToDate: boolean;
}

export interface CommitsPageResult {
  commits: UpstreamCommit[];
  hasMore: boolean;
  page: number;
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  progress?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
}

export interface CommunityPR {
  id: number;
  number: number;
  title: string;
  author: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
  html_url: string;
  state: 'open' | 'closed' | 'merged';
  created_at: string;
  updated_at: string;
  body: string;
  headSha: string;
  headBranch: string;
  labels: { name: string; color: string }[];
  artifactAvailable: boolean;
  artifactSizeMb?: number;
  artifactUrl?: string;
  isInstalled?: boolean;
  isActive?: boolean;
}

export interface PRBuildDownloadProgress {
  prNumber: number;
  status: 'idle' | 'downloading' | 'extracting' | 'configuring' | 'building' | 'staging' | 'ready' | 'error';
  progress: number;
  message?: string;
  error?: string;
}

export interface MultiPRBuildResult {
  success: boolean;
  buildId?: string;
  relinkerPath?: string;
  mergedPRs?: number[];
  conflict?: string;
  error?: string;
  cancelled?: boolean;
}

export interface MergedBuildInfo {
  id: string;
  name: string;
  prNumbers: number[];
  installedAt: string;
  relinkerPath: string;
  isActive: boolean;
}

export interface ToolchainStatus {
  name: string;
  command: string;
  version?: string;
  path?: string;
  isManaged: boolean;
  isAvailable: boolean;
}

export interface ToolchainInspectionResult {
  tools: ToolchainStatus[];
  allRequiredAvailable: boolean;
}

export interface ToolchainInstallProgress {
  status: 'idle' | 'downloading' | 'extracting' | 'ready' | 'error';
  toolName?: string;
  progress: number;
  transferredBytes?: number;
  totalBytes?: number;
  message?: string;
  error?: string;
}

export interface SourceSyncStatus {
  exists: boolean;
  repoUrl: string;
  currentCommit?: string;
  shortCommit?: string;
  commitMessage?: string;
  branch?: string;
  isSyncing: boolean;
  submodulesReady?: boolean;
  lastSyncedAt?: string;
}

export interface BuilderLogMessage {
  text: string;
  type: 'stdout' | 'stderr' | 'info' | 'error';
  timestamp: string;
}

export interface BuildProgressStatus {
  status: 'idle' | 'configuring' | 'building' | 'staging' | 'completed' | 'error';
  progress: number;
  message?: string;
  error?: string;
}

export interface BuildResult {
  success: boolean;
  runtimeId?: string;
  relinkerPath?: string;
  libsPath?: string;
  error?: string;
  cancelled?: boolean;
}

