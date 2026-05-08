import { useState } from 'react';
import { usePlatform } from '@/platform/PlatformContext';
import { joinExport, splitExport } from '@/lib/utils/audioExport';
import type { ExportFormat } from '@/lib/utils/audioExport';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExportAllProgress {
  current: number;
  total: number;
}

// ExportFormat is defined in audioExport.ts — re-export so hook consumers
// can import everything from this one module as before.
export type { ExportFormat } from '@/lib/utils/audioExport';

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useExportAllAudio() {
  const platform = usePlatform();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportAllProgress | null>(null);

  const exportAll = async (
    items: Array<{ id: string }>,
    format: ExportFormat,
    joinFiles: boolean,
    onComplete?: (count: number) => void,
    onError?: (err: Error, index: number) => void,
  ) => {
    if (items.length === 0) return;

    setIsExporting(true);
    setProgress({ current: 0, total: items.length });

    try {
      if (joinFiles) {
        await joinExport(
          items,
          format,
          platform.filesystem.saveFile,
          (current, total) => setProgress({ current, total }),
        );
      } else {
        const dir = await splitExport(
          items,
          format,
          platform.filesystem.pickDirectory,
          (current, total) => setProgress({ current, total }),
        );
        if (!dir) {
          // User cancelled the folder picker — bail silently
          setIsExporting(false);
          setProgress(null);
          return;
        }
      }

      onComplete?.(items.length);
    } catch (err) {
      const index = progress?.current ?? 0;
      onError?.(err instanceof Error ? err : new Error(String(err)), index);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  };

  return { exportAll, isExporting, progress };
}
