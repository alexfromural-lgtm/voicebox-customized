import { FolderDown, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import type { ExportAllProgress } from '@/lib/hooks/useExportAllAudio';

interface HistoryToolbarProps {
  exportableCount: number;
  failedCount: number;
  isExporting: boolean;
  exportProgress: ExportAllProgress | null;
  isClearFailedPending: boolean;
  onExportAll: () => void;
  onClearFailed: () => void;
}

export function HistoryToolbar({
  exportableCount,
  failedCount,
  isExporting,
  exportProgress,
  isClearFailedPending,
  onExportAll,
  onClearFailed,
}: HistoryToolbarProps) {
  const { t } = useTranslation();

  if (exportableCount === 0 && failedCount === 0) return null;

  return (
    <div className="flex items-center justify-between px-1 pb-2">
      <div className="flex items-center gap-1">
        {exportableCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={onExportAll}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                {exportProgress
                  ? `Exporting ${exportProgress.current}/${exportProgress.total}…`
                  : 'Exporting…'}
              </>
            ) : (
              <>
                <FolderDown className="h-3 w-3 mr-1.5" />
                Export All ({exportableCount})
              </>
            )}
          </Button>
        )}
      </div>
      {failedCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground hover:text-destructive"
          onClick={onClearFailed}
          disabled={isClearFailedPending}
        >
          <Trash2 className="h-3 w-3 mr-1.5" />
          {isClearFailedPending ? 'Clearing...' : t('history.clearFailedDialog.clearAll')}
        </Button>
      )}
    </div>
  );
}
