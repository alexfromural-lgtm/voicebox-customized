import {
  AudioLines,
  Download,
  FileArchive,
  Loader2,
  MoreHorizontal,
  Play,
  RotateCcw,
  Square,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import type { HistoryResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatDuration, formatEngineName } from '@/lib/utils/format';

import { AudioBars } from './AudioBars';
import { VersionsPanel } from './VersionsPanel';

interface HistoryRowProps {
  gen: HistoryResponse;
  isCurrentlyPlaying: boolean;
  isCancelling: boolean;
  isVersionsExpanded: boolean;
  isDeletePending: boolean;
  isExportAudioPending: boolean;
  isExportPackagePending: boolean;
  isDeletingAll: boolean;
  onPlay: (id: string, text: string, profileId: string) => void;
  onDownloadAudio: (id: string, text: string) => void;
  onExportPackage: (id: string, text: string) => void;
  onDeleteClick: (id: string, profileName: string) => void;
  onDeleteAll: () => void;
  onRetry: (id: string) => void;
  onRegenerate: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onApplyEffects: (id: string) => void;
  onCancelGeneration: (id: string) => void;
  onToggleVersions: (id: string) => void;
  onPlayVersion: (generationId: string, versionId: string, text: string, profileId: string) => void;
  onSwitchVersion: (generationId: string, versionId: string) => void;
}

export function HistoryRow({
  gen,
  isCurrentlyPlaying,
  isCancelling,
  isVersionsExpanded,
  isDeletePending,
  isExportAudioPending,
  isExportPackagePending,
  isDeletingAll,
  onPlay,
  onDownloadAudio,
  onExportPackage,
  onDeleteClick,
  onDeleteAll,
  onRetry,
  onRegenerate,
  onToggleFavorite,
  onApplyEffects,
  onCancelGeneration,
  onToggleVersions,
  onPlayVersion,
  onSwitchVersion,
}: HistoryRowProps) {
  const { t } = useTranslation();

  const isInProgress = gen.status === 'loading_model' || gen.status === 'generating';
  const isGenerating = isInProgress;
  const isFailed = gen.status === 'failed';
  const isPlayable = !isGenerating && !isFailed;
  const hasVersions = gen.versions && gen.versions.length > 1;

  return (
    <div
      key={gen.id}
      className={cn(
        'border rounded-md bg-card transition-colors text-left w-full',
        isCurrentlyPlaying && 'bg-muted/70',
      )}
    >
      {/* Main row */}
      <div
        role={isPlayable ? 'button' : undefined}
        tabIndex={isPlayable ? 0 : undefined}
        className={cn(
          'flex items-stretch gap-4 h-26 p-3 outline-none',
          isPlayable && 'hover:bg-muted/70 cursor-pointer rounded-md',
          isVersionsExpanded && 'rounded-b-none',
        )}
        aria-label={
          isGenerating
            ? `Generating speech for ${gen.profile_name}...`
            : isFailed
              ? `Generation failed for ${gen.profile_name}`
              : isCurrentlyPlaying
                ? `Sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}, ${formatDate(gen.created_at)}. Playing. Press Enter to restart.`
                : `Sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}, ${formatDate(gen.created_at)}. Press Enter to play.`
        }
        onMouseDown={(e) => {
          if (!isPlayable) return;
          const target = e.target as HTMLElement;
          if (target.closest('textarea') || window.getSelection()?.toString()) {
            return;
          }
          onPlay(gen.id, gen.text, gen.profile_id);
        }}
        onKeyDown={(e) => {
          if (!isPlayable) return;
          const target = e.target as HTMLElement;
          if (target.closest('textarea') || target.closest('button')) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPlay(gen.id, gen.text, gen.profile_id);
          }
        }}
      >
        {/* Status icon */}
        <div className="flex items-center shrink-0 w-10 justify-center overflow-hidden">
          <AudioBars
            mode={isGenerating ? 'generating' : isCurrentlyPlaying ? 'playing' : 'idle'}
          />
        </div>

        {/* Left side - Meta information */}
        <div className="flex flex-col gap-1.5 w-48 shrink-0 justify-center">
          <div className="font-medium text-sm truncate" title={gen.profile_name}>
            {gen.profile_name}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{gen.language}</span>
            <span className="text-xs text-muted-foreground">
              {formatEngineName(gen.engine, gen.model_size)}
            </span>
            {isFailed ? (
              <span className="text-xs text-destructive">Failed</span>
            ) : !isGenerating ? (
              <span className="text-xs text-muted-foreground">
                {formatDuration(gen.duration ?? 0)}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {isInProgress ? (
              <span className="text-accent">
                {gen.status === 'loading_model' ? 'Loading model...' : 'Generating...'}
              </span>
            ) : (
              formatDate(gen.created_at)
            )}
          </div>
        </div>

        {/* Right side - Transcript textarea */}
        <div className="flex-1 min-w-0 flex">
          <Textarea
            value={gen.text}
            className="flex-1 resize-none text-sm text-muted-foreground select-text"
            readOnly
            aria-label={`Transcript for sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}`}
          />
        </div>

        {/* Far right - Actions */}
        <div
          className="shrink-0 flex flex-col justify-center items-center gap-0.5"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground',
              gen.is_favorited && 'text-accent hover:text-accent',
            )}
            aria-label={gen.is_favorited ? 'Unfavorite' : 'Favorite'}
            onClick={() => onToggleFavorite(gen.id)}
          >
            <Star className="h-2 w-2" fill={gen.is_favorited ? 'currentColor' : 'none'} />
          </Button>
          {hasVersions && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground',
                isVersionsExpanded && 'text-accent hover:text-accent',
              )}
              aria-label="Toggle versions"
              onClick={() => onToggleVersions(gen.id)}
            >
              <AudioLines className="h-2 w-2" />
            </Button>
          )}

          {isFailed ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                aria-label="Retry generation"
                onClick={() => onRetry(gen.id)}
              >
                <RotateCcw className="h-2 w-2" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                aria-label="Delete generation"
                disabled={isDeletePending}
                onClick={() => onDeleteClick(gen.id, gen.profile_name)}
              >
                <Trash2 className="h-2 w-2" />
              </Button>
            </>
          ) : isGenerating ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
              aria-label="Cancel generation"
              disabled={isCancelling}
              onClick={() => onCancelGeneration(gen.id)}
            >
              {isCancelling ? (
                <Loader2 className="h-2 w-2 animate-spin" />
              ) : (
                <Square className="h-2 w-2" />
              )}
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                  aria-label={t('history.actions.menu')}
                  disabled={isGenerating}
                >
                  <MoreHorizontal className="h-2 w-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onPlay(gen.id, gen.text, gen.profile_id)}>
                  <Play className="mr-2 h-4 w-4" />
                  {t('history.actions.play')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDownloadAudio(gen.id, gen.text)}
                  disabled={isExportAudioPending}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t('history.actions.exportAudio')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onExportPackage(gen.id, gen.text)}
                  disabled={isExportPackagePending}
                >
                  <FileArchive className="mr-2 h-4 w-4" />
                  {t('history.actions.exportPackage')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onApplyEffects(gen.id)}>
                  <Wand2 className="mr-2 h-4 w-4" />
                  {t('history.actions.applyEffects')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRegenerate(gen.id)}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('history.actions.regenerate')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDeleteClick(gen.id, gen.profile_name)}
                  disabled={isDeletePending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('common.delete')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDeleteAll}
                  disabled={isDeletePending || isDeletingAll}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('history.actions.deleteAll')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Expandable versions panel */}
      {gen.versions && gen.versions.length > 1 && (
        <VersionsPanel
          versions={gen.versions}
          isExpanded={isVersionsExpanded}
          onPlayVersion={(versionId) => onPlayVersion(gen.id, versionId, gen.text, gen.profile_id)}
          onSwitchVersion={(versionId) => onSwitchVersion(gen.id, versionId)}
        />
      )}
    </div>
  );
}
