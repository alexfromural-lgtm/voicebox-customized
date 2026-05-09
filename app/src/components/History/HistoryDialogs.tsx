import { FolderDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EffectsChainEditor } from '@/components/Effects/EffectsChainEditor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EffectConfig, GenerationVersionResponse } from '@/lib/api/types';
import type { ExportFormat } from '@/lib/utils/audioExport';

// ─── Delete single generation ─────────────────────────────────────────────────

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationName: string | undefined;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteDialog({
  open,
  onOpenChange,
  generationName,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('history.deleteDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('history.deleteDialog.body', { name: generationName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? t('history.deleteDialog.deleting') : t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete all ───────────────────────────────────────────────────────────────

interface DeleteAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  isDeleting: boolean;
  onConfirm: () => void;
}

export function DeleteAllDialog({
  open,
  onOpenChange,
  count,
  isDeleting,
  onConfirm,
}: DeleteAllDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('history.deleteAllDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('history.deleteAllDialog.body', { count })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting
              ? t('history.deleteAllDialog.deleting')
              : t('history.deleteAllDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Clear failed ─────────────────────────────────────────────────────────────

interface ClearFailedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  failedCount: number;
  isClearing: boolean;
  onConfirm: () => void;
}

export function ClearFailedDialog({
  open,
  onOpenChange,
  failedCount,
  isClearing,
  onConfirm,
}: ClearFailedDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('history.clearFailedDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('history.clearFailedDialog.body', { count: failedCount })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isClearing}>
            {isClearing
              ? t('history.clearFailedDialog.clearing')
              : t('history.clearFailedDialog.clearAll')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Import ───────────────────────────────────────────────────────────────────

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedFileName: string | undefined;
  isImporting: boolean;
  hasFile: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportDialog({
  open,
  onOpenChange,
  selectedFileName,
  isImporting,
  hasFile,
  onConfirm,
  onCancel,
}: ImportDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('history.importDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('history.importDialog.body', { name: selectedFileName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={isImporting || !hasFile}>
            {isImporting ? t('history.importDialog.importing') : t('history.importDialog.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Export All ───────────────────────────────────────────────────────────────

interface ExportAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exportableCount: number;
  exportFormat: ExportFormat;
  joinFiles: boolean;
  onFormatChange: (format: ExportFormat) => void;
  onJoinToggle: () => void;
  onConfirm: () => void;
}

export function ExportAllDialog({
  open,
  onOpenChange,
  exportableCount,
  exportFormat,
  joinFiles,
  onFormatChange,
  onJoinToggle,
  onConfirm,
}: ExportAllDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export All Audio</DialogTitle>
          <DialogDescription>
            {joinFiles
              ? `${exportableCount} file${exportableCount === 1 ? '' : 's'} will be merged into a single .${exportFormat} file you save to disk.`
              : `${exportableCount} audio file${exportableCount === 1 ? '' : 's'} will be exported as numbered files (01, 02, …) to a folder you choose.`}{' '}
            In-progress and failed items are skipped.
          </DialogDescription>
        </DialogHeader>

        {/* Format selector */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Output format</span>
          <div className="flex gap-2">
            {(['wav', 'mp3'] as ExportFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => onFormatChange(fmt)}
                className={[
                  'flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors',
                  exportFormat === fmt
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-muted-foreground hover:border-accent/50 hover:text-foreground',
                ].join(' ')}
              >
                .{fmt.toUpperCase()}
              </button>
            ))}
          </div>
          {exportFormat === 'mp3' && (
            <p className="text-[11px] text-muted-foreground">
              Files will be encoded at 128 kbps. Encoding happens locally — no data leaves your
              device.
            </p>
          )}
        </div>

        {/* Join toggle */}
        <button
          type="button"
          onClick={onJoinToggle}
          className="flex items-center gap-2.5 w-full rounded-md border px-3 py-2.5 text-left transition-colors hover:border-accent/50"
        >
          <span
            className={[
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
              joinFiles ? 'border-accent bg-accent' : 'border-muted-foreground/40',
            ].join(' ')}
          >
            {joinFiles && (
              <svg viewBox="0 0 10 8" fill="none" className="h-2.5 w-2.5">
                <path
                  d="M1 4l2.5 2.5L9 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent-foreground"
                />
              </svg>
            )}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-xs font-medium">Join into a single file</span>
            <span className="text-[11px] text-muted-foreground">
              Concatenates all clips in order into one {exportFormat.toUpperCase()}
            </span>
          </span>
        </button>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onConfirm}>
            <FolderDown className="mr-2 h-4 w-4" />
            {joinFiles ? 'Choose file & export' : 'Choose folder & export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Effects ──────────────────────────────────────────────────────────────────

interface EffectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: GenerationVersionResponse[];
  sourceVersionId: string | null;
  effectsChain: EffectConfig[];
  isApplying: boolean;
  onSourceVersionChange: (id: string | null) => void;
  onEffectsChainChange: (chain: EffectConfig[]) => void;
  onConfirm: () => void;
}

export function EffectsDialog({
  open,
  onOpenChange,
  versions,
  sourceVersionId,
  effectsChain,
  isApplying,
  onSourceVersionChange,
  onEffectsChainChange,
  onConfirm,
}: EffectsDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('history.effectsDialog.title')}</DialogTitle>
          <DialogDescription>{t('history.effectsDialog.body')}</DialogDescription>
        </DialogHeader>
        {versions.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('history.effectsDialog.sourceLabel')}
            </label>
            <Select
              value={sourceVersionId ?? ''}
              onValueChange={(val) => onSourceVersionChange(val || null)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={t('history.effectsDialog.sourcePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">
                    {v.label}
                    {v.effects_chain && v.effects_chain.length > 0 && (
                      <span className="text-muted-foreground ml-1.5">
                        ({v.effects_chain.map((e) => e.type).join(' + ')})
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="py-2 max-h-80 overflow-y-auto">
          <EffectsChainEditor value={effectsChain} onChange={onEffectsChainChange} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isApplying || effectsChain.length === 0}
          >
            {isApplying
              ? t('history.effectsDialog.applying')
              : t('history.effectsDialog.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
