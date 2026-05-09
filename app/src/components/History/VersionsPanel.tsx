import { AnimatePresence, motion } from 'framer-motion';
import { AudioLines } from 'lucide-react';

import type { GenerationVersionResponse } from '@/lib/api/types';

interface VersionsPanelProps {
  versions: GenerationVersionResponse[];
  isExpanded: boolean;
  onPlayVersion: (versionId: string) => void;
  onSwitchVersion: (versionId: string) => void;
}

export function VersionsPanel({
  versions,
  isExpanded,
  onPlayVersion,
  onSwitchVersion,
}: VersionsPanelProps) {
  return (
    <AnimatePresence>
      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div className="border-t border-border/50">
            <div className="divide-y divide-border/40">
              {versions.map((v) => {
                const sourceVersion = v.source_version_id
                  ? versions.find((sv) => sv.id === v.source_version_id)
                  : null;
                const showSource =
                  sourceVersion &&
                  sourceVersion.effects_chain &&
                  sourceVersion.effects_chain.length > 0;

                return (
                  <button
                    key={v.id}
                    type="button"
                    className="flex items-center gap-2 w-full h-9 px-3 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      onPlayVersion(v.id);
                      if (!v.is_default) {
                        onSwitchVersion(v.id);
                      }
                    }}
                  >
                    <AudioLines className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-medium">{v.label}</span>
                    {v.effects_chain && v.effects_chain.length > 0 && (
                      <span className="text-[10px] text-muted-foreground truncate">
                        {v.effects_chain.map((e) => e.type).join(' → ')}
                      </span>
                    )}
                    {showSource && (
                      <span className="text-[10px] text-muted-foreground/60 truncate">
                        from {sourceVersion.label}
                      </span>
                    )}
                    <span className="flex-1" />
                    {v.is_default && (
                      <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded-full">
                        active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
