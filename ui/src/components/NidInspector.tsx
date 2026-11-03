import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Code2, 
  Search, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldAlert, 
  ChevronDown, 
  Loader2, 
  RotateCcw, 
  AlertCircle, 
  Gamepad2,
  Filter
} from 'lucide-react';
import { GameItem, NidAuditResult, NidImportStatus, NidImportItem } from '../types';
import { apiBridge } from '../services/apiBridge';
import { audioService } from '../services/audioService';

interface NidInspectorProps {
  game: GameItem;
  games?: GameItem[];
  onSelectGame?: (game: GameItem) => void;
}

export const NidInspector: React.FC<NidInspectorProps> = ({ 
  game: initialGame, 
  games = [], 
  onSelectGame 
}) => {
  const [activeGame, setActiveGame] = useState<GameItem>(initialGame);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [auditResult, setAuditResult] = useState<NidAuditResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterModule, setFilterModule] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<NidImportStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync with prop changes
  useEffect(() => {
    setActiveGame(initialGame);
  }, [initialGame]);

  // Outside click detection for the title switcher popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch or re-audit NID symbols whenever the active game changes
  const runAudit = async (targetGame: GameItem, forceRefresh = false) => {
    setIsLoading(true);
    try {
      const result = await apiBridge.auditGameNids(targetGame, forceRefresh);
      setAuditResult(result);
    } catch {
      setAuditResult({
        error: 'Failed to inspect NID symbols. An internal error occurred while analyzing executable.',
        summary: {
          totalImports: 0,
          resolvedCount: 0,
          stubCount: 0,
          missingCount: 0,
          coveragePercentage: 0,
        },
        imports: [],
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeGame) {
      runAudit(activeGame);
    }
  }, [activeGame.id]);

  const handleSelectTitle = (selected: GameItem) => {
    audioService.playNavTick();
    setActiveGame(selected);
    setIsDropdownOpen(false);
    if (onSelectGame) {
      onSelectGame(selected);
    }
  };

  const handleRefresh = () => {
    audioService.playNavTick();
    if (activeGame) {
      runAudit(activeGame, true);
    }
  };

  // Dynamically discovered PRX modules from the audit results
  const modules = useMemo(() => {
    if (!auditResult || !auditResult.imports.length) return ['all'];
    const set = new Set<string>();
    for (const item of auditResult.imports) {
      if (item.module) {
        set.add(item.module);
      }
    }
    return ['all', ...Array.from(set).sort()];
  }, [auditResult]);

  // Filtered imports based on module, status, and search query
  const filteredImports = useMemo(() => {
    if (!auditResult || !auditResult.imports) return [];
    return auditResult.imports.filter((item) => {
      const matchesModule = filterModule === 'all' || item.module === filterModule;
      const matchesStatus = filterStatus === 'all' || item.status === filterStatus;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || 
        item.symbol.toLowerCase().includes(q) || 
        item.nid.toLowerCase().includes(q) || 
        item.module.toLowerCase().includes(q) ||
        (item.implementationNotes && item.implementationNotes.toLowerCase().includes(q));

      return matchesModule && matchesStatus && matchesSearch;
    });
  }, [auditResult, filterModule, filterStatus, searchQuery]);

  const summary = auditResult?.summary || {
    totalImports: 0,
    resolvedCount: 0,
    stubCount: 0,
    missingCount: 0,
    coveragePercentage: 0,
  };

  const coverageColor = summary.coveragePercentage >= 90
    ? 'text-emerald-400'
    : summary.coveragePercentage >= 70
    ? 'text-amber-400'
    : 'text-rose-400';

  const gamesList = games.length > 0 ? games : [activeGame];

  return (
    <div className="relative w-full h-full flex flex-col pt-20 px-8 pb-8 overflow-y-auto select-none">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-white/5">
        <div>
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block mb-1">
            Sony Symbol Diagnostics
          </span>
          <div className="flex items-center space-x-2">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              NID Inspector ·
            </h2>

            {/* Interactive Game Switcher Popover */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-white transition-all cursor-pointer group active:scale-98"
              >
                {activeGame.iconUrl ? (
                  <img
                    src={activeGame.iconUrl}
                    alt={activeGame.title}
                    className="w-5 h-5 rounded object-cover border border-white/10 flex-shrink-0"
                  />
                ) : (
                  <Gamepad2 className="w-4 h-4 text-white/50" />
                )}
                <span className="text-sm font-semibold truncate max-w-[200px]">{activeGame.title}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-white/50 group-hover:text-white transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Popover Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute left-0 mt-2 w-80 max-h-80 bg-[#0c111c]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl p-2 z-50 overflow-y-auto custom-scrollbar animate-scale-up space-y-1">
                  <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-white/40">
                    Switch Inspection Target
                  </div>
                  {gamesList.map((g) => {
                    const isCurrent = g.id === activeGame.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleSelectTitle(g)}
                        className={`w-full flex items-center space-x-3 p-2 rounded-xl text-left transition-colors ${
                          isCurrent
                            ? 'bg-white/15 text-white'
                            : 'hover:bg-white/5 text-white/70 hover:text-white'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {g.iconUrl ? (
                            <img src={g.iconUrl} alt={g.title} className="w-full h-full object-cover" />
                          ) : (
                            <Gamepad2 className="w-4 h-4 text-white/30" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{g.title}</div>
                          <div className="text-[10px] font-mono text-white/40">{g.titleId}</div>
                        </div>
                        {isCurrent && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Metrics */}
        <div className="flex items-center space-x-6 text-xs bg-white/[0.02] border border-white/5 px-4 py-2.5 rounded-2xl">
          <div>
            <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Total Imports</span>
            <span className="text-white font-mono font-bold text-base">{summary.totalImports}</span>
          </div>
          <div>
            <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Implemented</span>
            <span className="text-emerald-400 font-mono font-bold text-base">{summary.resolvedCount}</span>
          </div>
          <div>
            <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Stubs</span>
            <span className="text-amber-400 font-mono font-bold text-base">{summary.stubCount}</span>
          </div>
          <div>
            <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Missing</span>
            <span className="text-rose-400 font-mono font-bold text-base">{summary.missingCount}</span>
          </div>
          <div>
            <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Coverage</span>
            <span className={`font-mono font-bold text-base ${coverageColor}`}>
              {summary.coveragePercentage}%
            </span>
          </div>
        </div>
      </div>

      {/* Filter Row: Modules, Status, Search */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
        {/* Module Filter Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 max-w-2xl custom-scrollbar">
          {modules.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                audioService.playNavTick();
                setFilterModule(m);
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                filterModule === m
                  ? 'bg-white text-black font-semibold'
                  : 'bg-white/5 text-neutral-400 hover:text-white'
              }`}
            >
              {m === 'all' ? 'All Modules' : m}
            </button>
          ))}
        </div>

        {/* Right side controls: Status Filter, Search, Refresh */}
        <div className="flex items-center space-x-2">
          {/* Status Dropdown / Pills */}
          <div className="flex items-center space-x-1 bg-white/[0.03] p-1 rounded-full border border-white/5">
            <button
              type="button"
              onClick={() => {
                audioService.playNavTick();
                setFilterStatus('all');
              }}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                filterStatus === 'all' ? 'bg-white/15 text-white' : 'text-neutral-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                audioService.playNavTick();
                setFilterStatus('implemented');
              }}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                filterStatus === 'implemented' ? 'bg-emerald-500/20 text-emerald-300' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Implemented
            </button>
            <button
              type="button"
              onClick={() => {
                audioService.playNavTick();
                setFilterStatus('stub');
              }}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                filterStatus === 'stub' ? 'bg-amber-500/20 text-amber-300' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Stubs
            </button>
            <button
              type="button"
              onClick={() => {
                audioService.playNavTick();
                setFilterStatus('missing');
              }}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                filterStatus === 'missing' ? 'bg-rose-500/20 text-rose-300' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Missing
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-500" />
            <input
              type="text"
              placeholder="Search symbol, NID, module..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white text-xs placeholder-neutral-500 focus:outline-none focus:border-white/30"
            />
          </div>

          {/* Refresh Audit Button */}
          <button
            type="button"
            onClick={handleRefresh}
            title="Re-audit symbols (bypass cache)"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-colors"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#0070d1]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="bg-black/40 rounded-2xl border border-white/10 flex-1 flex flex-col items-center justify-center p-12 space-y-3">
          <Loader2 className="w-8 h-8 text-[#0070d1] animate-spin" />
          <p className="text-sm font-medium text-white">Auditing PlayStation 5 Imported Symbols...</p>
          <p className="text-xs font-mono text-white/40">{activeGame.title} ({activeGame.titleId})</p>
        </div>
      ) : auditResult?.error ? (
        <div className="bg-black/40 rounded-2xl border border-amber-500/20 p-8 flex flex-col items-center justify-center text-center max-w-xl mx-auto my-auto space-y-3">
          <AlertCircle className="w-10 h-10 text-amber-400 flex-shrink-0" />
          <h3 className="text-base font-semibold text-white">NID Audit Unavailable</h3>
          <p className="text-xs text-white/60 leading-relaxed">
            {auditResult.error}
          </p>
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[11px] font-mono text-white/50 text-left w-full mt-2">
            Target Directory: {activeGame.path}
          </div>
        </div>
      ) : (
        /* Clean Symbols Table */
        <div className="bg-black/40 rounded-2xl border border-white/10 overflow-hidden flex-1 flex flex-col">
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-neutral-400 uppercase tracking-wider font-semibold border-b border-white/10 sticky top-0 backdrop-blur-md z-10">
                <tr>
                  <th className="py-3 px-4 font-mono text-[11px]">NID Hash</th>
                  <th className="py-3 px-4">Resolved Sony Symbol</th>
                  <th className="py-3 px-4">PRX Module</th>
                  <th className="py-3 px-4">Audit Status</th>
                  <th className="py-3 px-4">Implementation Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {filteredImports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-white/40 text-xs">
                      No imported symbols match the current search and filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredImports.map((item, idx) => (
                    <tr key={`${item.nid}-${idx}`} className="hover:bg-white/5 transition-colors">
                      <td className="py-2.5 px-4 text-neutral-400 text-[11px]">{item.nid}</td>
                      <td className="py-2.5 px-4 font-semibold text-white font-sans text-xs">
                        {item.symbol}
                      </td>
                      <td className="py-2.5 px-4 text-neutral-300 font-mono text-[11px]">
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5">
                          {item.module}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-sans">
                        {item.status === 'implemented' ? (
                          <span className="inline-flex items-center space-x-1 text-emerald-400 text-[11px] font-medium bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Implemented</span>
                          </span>
                        ) : item.status === 'stub' ? (
                          <span className="inline-flex items-center space-x-1 text-amber-400 text-[11px] font-medium bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Stub</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 text-rose-400 text-[11px] font-medium bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
                            <ShieldAlert className="w-3 h-3" />
                            <span>Missing</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-neutral-400 font-sans text-[11px]">
                        {item.implementationNotes || 'Standard PlayStation 5 system import'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="py-2 px-4 bg-white/[0.02] border-t border-white/5 flex items-center justify-between text-[11px] text-white/40">
            <span>Showing {filteredImports.length} of {summary.totalImports} imported symbols</span>
            <span>Target: {activeGame.title} ({activeGame.titleId})</span>
          </div>
        </div>
      )}
    </div>
  );
};
