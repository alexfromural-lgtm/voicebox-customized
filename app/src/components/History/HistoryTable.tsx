import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronsDown, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { EffectConfig, GenerationVersionResponse, HistoryResponse } from '@/lib/api/types';
import { BOTTOM_SAFE_AREA_PADDING } from '@/lib/constants/ui';
import type { ExportFormat } from '@/lib/hooks/useHistory';
import {
  useClearFailedGenerations,
  useDeleteGeneration,
  useExportAllAudio,
  useExportGeneration,
  useExportGenerationAudio,
  useHistory,
  useImportGeneration,
} from '@/lib/hooks/useHistory';
import { cn } from '@/lib/utils/cn';
import { useGenerationStore } from '@/stores/generationStore';
import { usePlayerStore } from '@/stores/playerStore';

import {
  ClearFailedDialog,
  DeleteAllDialog,
  DeleteDialog,
  EffectsDialog,
  ExportAllDialog,
  ImportDialog,
} from './HistoryDialogs';
import { HistoryRow } from './HistoryRow';
import { HistoryToolbar } from './HistoryToolbar';

// NEW ALTERNATE HISTORY VIEW - FIXED HEIGHT ROWS WITH INFINITE SCROLL
export function HistoryTable() {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [allHistory, setAllHistory] = useState<HistoryResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const loadAllRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Dialog state ────────────────────────────────────────────────────────────
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [generationToDelete, setGenerationToDelete] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [effectsDialogOpen, setEffectsDialogOpen] = useState(false);
  const [effectsTargetId, setEffectsTargetId] = useState<string | null>(null);
  const [effectsTargetVersions, setEffectsTargetVersions] = useState<GenerationVersionResponse[]>([]);
  const [effectsSourceVersionId, setEffectsSourceVersionId] = useState<string | null>(null);
  const [effectsChain, setEffectsChain] = useState<EffectConfig[]>([]);
  const [applyingEffects, setApplyingEffects] = useState(false);
  const [expandedVersionsId, setExpandedVersionsId] = useState<string | null>(null);
  const [clearFailedDialogOpen, setClearFailedDialogOpen] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [exportAllDialogOpen, setExportAllDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');
  const [joinFiles, setJoinFiles] = useState(false);

  // ── Data & mutations ────────────────────────────────────────────────────────
  const limit = 20;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: historyData,
    isLoading,
    isFetching,
  } = useHistory({ limit, offset: page * limit });

  const deleteGeneration = useDeleteGeneration();
  const clearFailed = useClearFailedGenerations();
  const exportGeneration = useExportGeneration();
  const exportGenerationAudio = useExportGenerationAudio();
  const importGeneration = useImportGeneration();
  const { exportAll, isExporting, progress: exportProgress } = useExportAllAudio();

  const cancelGeneration = useMutation({
    mutationFn: (generationId: string) => apiClient.cancelGeneration(generationId),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      toast({ title: 'Cancelling generation', description: data.message });
    },
    onError: (error) => {
      toast({
        title: 'Cancel failed',
        description: error instanceof Error ? error.message : 'Could not cancel generation',
        variant: 'destructive',
      });
    },
  });

  const addPendingGeneration = useGenerationStore((state) => state.addPendingGeneration);
  const setAudioWithAutoPlay = usePlayerStore((state) => state.setAudioWithAutoPlay);
  const restartCurrentAudio = usePlayerStore((state) => state.restartCurrentAudio);
  const currentAudioId = usePlayerStore((state) => state.audioId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const audioUrl = usePlayerStore((state) => state.audioUrl);
  const isPlayerVisible = !!audioUrl;

  // ── Pagination / data accumulation ─────────────────────────────────────────

  useEffect(() => {
    if (historyData?.items) {
      setTotal(historyData.total);
      if (page === 0) {
        setAllHistory(historyData.items);
      } else {
        setAllHistory((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const newItems = historyData.items.filter((item) => !existingIds.has(item.id));
          return [...prev, ...newItems];
        });
      }
    }
  }, [historyData, page]);

  // Drive load-all: keep advancing page until everything is fetched
  useEffect(() => {
    if (!loadAllRef.current) return;
    if (isFetching) return;
    if (historyData && allHistory.length < historyData.total) {
      setPage((prev) => prev + 1);
    } else {
      loadAllRef.current = false;
      setIsLoadingAll(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [isFetching, allHistory.length, historyData]);

  const handleLoadAll = useCallback(() => {
    if (isLoadingAll) return;
    loadAllRef.current = true;
    setIsLoadingAll(true);
    if (!isFetching && allHistory.length < total) {
      setPage((prev) => prev + 1);
    }
  }, [isLoadingAll, isFetching, allHistory.length, total]);

  // Reset to page 0 when deletions / imports / generation completions occur
  const pendingCount = useGenerationStore((state) => state.pendingGenerationIds.size);
  const prevPendingCountRef = useRef(pendingCount);

  useEffect(() => {
    if (deleteGeneration.isSuccess || importGeneration.isSuccess || clearFailed.isSuccess) {
      setPage(0);
      setAllHistory([]);
    }
  }, [deleteGeneration.isSuccess, importGeneration.isSuccess, clearFailed.isSuccess]);

  useEffect(() => {
    if (prevPendingCountRef.current > 0 && pendingCount < prevPendingCountRef.current && page !== 0) {
      setPage(0);
      setAllHistory([]);
    }
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, page]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const loadMoreEl = loadMoreRef.current;
    if (!loadMoreEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && !isFetching && allHistory.length < total) {
          setPage((prev) => prev + 1);
        }
      },
      { root: scrollRef.current, rootMargin: '100px', threshold: 0.1 },
    );
    observer.observe(loadMoreEl);
    return () => observer.disconnect();
  }, [isFetching, allHistory.length, total]);

  // Track scroll position for gradient effect
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const handleScroll = () => setIsScrolled(scrollEl.scrollTop > 0);
    scrollEl.addEventListener('scroll', handleScroll);
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, []);

  // ── Action handlers ─────────────────────────────────────────────────────────

  const handlePlay = (audioId: string, text: string, profileId: string) => {
    if (currentAudioId === audioId) {
      restartCurrentAudio();
    } else {
      const url = apiClient.getAudioUrl(audioId);
      setAudioWithAutoPlay(url, audioId, profileId, text.substring(0, 50));
    }
  };

  const handleDownloadAudio = (generationId: string, text: string) => {
    exportGenerationAudio.mutate(
      { generationId, text },
      {
        onError: (error) =>
          toast({ title: 'Failed to download audio', description: error.message, variant: 'destructive' }),
      },
    );
  };

  const handleExportPackage = (generationId: string, text: string) => {
    exportGeneration.mutate(
      { generationId, text },
      {
        onError: (error) =>
          toast({ title: 'Failed to export generation', description: error.message, variant: 'destructive' }),
      },
    );
  };

  const handleDeleteClick = (generationId: string, profileName: string) => {
    setGenerationToDelete({ id: generationId, name: profileName });
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (generationToDelete) {
      deleteGeneration.mutate(generationToDelete.id);
      setDeleteDialogOpen(false);
      setGenerationToDelete(null);
    }
  };

  const handleDeleteAll = async () => {
    setIsDeletingAll(true);
    try {
      for (const gen of allHistory) {
        await apiClient.deleteGeneration(gen.id);
      }
      queryClient.invalidateQueries({ queryKey: ['history'] });
      setPage(0);
      setAllHistory([]);
      toast({ title: t('history.deleteAllDialog.successTitle') });
    } catch (error) {
      toast({
        title: t('history.deleteAllDialog.errorTitle'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsDeletingAll(false);
      setDeleteAllDialogOpen(false);
    }
  };

  const handleRetry = async (generationId: string) => {
    try {
      const result = await apiClient.retryGeneration(generationId);
      addPendingGeneration(result.id);
      queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (error) {
      toast({
        title: 'Retry failed',
        description: error instanceof Error ? error.message : 'Could not retry generation',
        variant: 'destructive',
      });
    }
  };

  const handleRegenerate = async (generationId: string) => {
    try {
      await apiClient.regenerateGeneration(generationId);
      addPendingGeneration(generationId);
      queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (error) {
      toast({
        title: 'Regenerate failed',
        description: error instanceof Error ? error.message : 'Could not regenerate',
        variant: 'destructive',
      });
    }
  };

  const handleToggleFavorite = async (generationId: string) => {
    try {
      await apiClient.toggleFavorite(generationId);
      queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (error) {
      toast({
        title: 'Failed to update favorite',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleApplyEffects = (generationId: string) => {
    const gen = allHistory.find((g) => g.id === generationId);
    const versions = gen?.versions ?? [];
    setEffectsTargetId(generationId);
    setEffectsTargetVersions(versions);
    const cleanVersion = versions.find((v) => !v.effects_chain || v.effects_chain.length === 0);
    setEffectsSourceVersionId(cleanVersion?.id ?? null);
    setEffectsChain([]);
    setEffectsDialogOpen(true);
  };

  const handleApplyEffectsConfirm = async () => {
    if (!effectsTargetId || effectsChain.length === 0) return;
    setApplyingEffects(true);
    try {
      const newVersion = await apiClient.applyEffectsToGeneration(effectsTargetId, {
        effects_chain: effectsChain,
        source_version_id: effectsSourceVersionId ?? undefined,
        set_as_default: true,
      });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      if (currentAudioId === effectsTargetId) {
        const gen = allHistory.find((g) => g.id === effectsTargetId);
        if (gen) {
          const versionUrl = apiClient.getVersionAudioUrl(newVersion.id);
          setAudioWithAutoPlay(versionUrl, effectsTargetId, gen.profile_id, gen.text.substring(0, 50));
        }
      }
      setEffectsDialogOpen(false);
      toast({ title: 'Effects applied', description: 'A new version has been created.' });
    } catch (error) {
      toast({
        title: 'Failed to apply effects',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setApplyingEffects(false);
    }
  };

  const handleSwitchVersion = async (generationId: string, versionId: string) => {
    try {
      await apiClient.setDefaultVersion(generationId, versionId);
      queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (error) {
      toast({
        title: 'Failed to switch version',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handlePlayVersion = (generationId: string, versionId: string, text: string, profileId: string) => {
    const url = apiClient.getVersionAudioUrl(versionId);
    setAudioWithAutoPlay(url, generationId, profileId, text.substring(0, 50));
  };

  const handleImportConfirm = () => {
    if (selectedFile) {
      importGeneration.mutate(selectedFile, {
        onSuccess: (data) => {
          setImportDialogOpen(false);
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          toast({ title: 'Generation imported', description: data.message || 'Generation imported successfully' });
        },
        onError: (error) =>
          toast({ title: 'Failed to import generation', description: error.message, variant: 'destructive' }),
      });
    }
  };

  const handleExportAllConfirm = () => {
    setExportAllDialogOpen(false);
    exportAll(
      exportableItems.map((g) => ({ id: g.id })),
      exportFormat,
      joinFiles,
      (count) => {
        toast({
          title: 'Export complete',
          description: joinFiles
            ? `${count} files merged into a single .${exportFormat}.`
            : `${count} file${count === 1 ? '' : 's'} saved as .${exportFormat}.`,
        });
      },
      (err, index) =>
        toast({ title: `Export failed at file ${index + 1}`, description: err.message, variant: 'destructive' }),
    );
  };

  const handleClearFailedConfirm = () => {
    clearFailed.mutate(undefined, {
      onSuccess: (data) => {
        setClearFailedDialogOpen(false);
        toast({
          title: 'Cleared failed generations',
          description: `${data.deleted} failed ${data.deleted === 1 ? 'generation' : 'generations'} removed.`,
        });
      },
      onError: (error) => {
        setClearFailedDialogOpen(false);
        toast({
          title: 'Failed to clear',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      },
    });
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  if (isLoading && page === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const history = allHistory;
  const hasMore = allHistory.length < total;
  const failedCount = history.filter((g) => g.status === 'failed').length;
  const exportableItems = history.filter(
    (g) => g.status !== 'failed' && g.status !== 'loading_model' && g.status !== 'generating',
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {history.length === 0 ? (
        <div className="text-center py-12 px-5 border-2 border-dashed mb-5 border-muted rounded-md text-muted-foreground flex-1 flex items-center justify-center">
          No voice generations, yet...
        </div>
      ) : (
        <>
          <HistoryToolbar
            exportableCount={exportableItems.length}
            failedCount={failedCount}
            isExporting={isExporting}
            exportProgress={exportProgress}
            isClearFailedPending={clearFailed.isPending}
            onExportAll={() => setExportAllDialogOpen(true)}
            onClearFailed={() => setClearFailedDialogOpen(true)}
          />

          {isScrolled && (
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
          )}

          <div
            ref={scrollRef}
            className={cn(
              'flex-1 min-h-0 overflow-y-auto space-y-2 pb-4',
              isPlayerVisible && BOTTOM_SAFE_AREA_PADDING,
            )}
          >
            {history.map((gen) => (
              <HistoryRow
                key={gen.id}
                gen={gen}
                isCurrentlyPlaying={currentAudioId === gen.id && isPlaying}
                isCancelling={cancelGeneration.isPending && cancelGeneration.variables === gen.id}
                isVersionsExpanded={expandedVersionsId === gen.id}
                isDeletePending={deleteGeneration.isPending}
                isExportAudioPending={exportGenerationAudio.isPending}
                isExportPackagePending={exportGeneration.isPending}
                isDeletingAll={isDeletingAll}
                onPlay={handlePlay}
                onDownloadAudio={handleDownloadAudio}
                onExportPackage={handleExportPackage}
                onDeleteClick={handleDeleteClick}
                onDeleteAll={() => setDeleteAllDialogOpen(true)}
                onRetry={handleRetry}
                onRegenerate={handleRegenerate}
                onToggleFavorite={handleToggleFavorite}
                onApplyEffects={handleApplyEffects}
                onCancelGeneration={(id) => cancelGeneration.mutate(id)}
                onToggleVersions={(id) =>
                  setExpandedVersionsId(expandedVersionsId === id ? null : id)
                }
                onPlayVersion={handlePlayVersion}
                onSwitchVersion={handleSwitchVersion}
              />
            ))}

            {/* Load more trigger element */}
            {hasMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                {isFetching && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
              </div>
            )}

            {/* End of list indicator */}
            {!hasMore && history.length > 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground">
                You've reached the end
              </div>
            )}
          </div>

          {/* Load-all floating button */}
          {hasMore && (
            <button
              type="button"
              onClick={handleLoadAll}
              disabled={isLoadingAll}
              title={`Load all ${total} items`}
              aria-label={`Load all ${total} items`}
              className="absolute bottom-4 right-2 z-20 flex items-center gap-1 rounded-full border border-border/60 bg-background/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-md backdrop-blur-sm transition-all hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingAll ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronsDown className="h-3 w-3" />
              )}
              {isLoadingAll
                ? `${allHistory.length} / ${total}`
                : total - allHistory.length > 0
                  ? `+${total - allHistory.length}`
                  : ''}
            </button>
          )}
        </>
      )}

      {/* ── Dialogs ── */}
      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        generationName={generationToDelete?.name}
        isDeleting={deleteGeneration.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setGenerationToDelete(null);
        }}
      />

      <DeleteAllDialog
        open={deleteAllDialogOpen}
        onOpenChange={setDeleteAllDialogOpen}
        count={allHistory.length}
        isDeleting={isDeletingAll}
        onConfirm={handleDeleteAll}
      />

      <ClearFailedDialog
        open={clearFailedDialogOpen}
        onOpenChange={setClearFailedDialogOpen}
        failedCount={failedCount}
        isClearing={clearFailed.isPending}
        onConfirm={handleClearFailedConfirm}
      />

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        selectedFileName={selectedFile?.name}
        isImporting={importGeneration.isPending}
        hasFile={!!selectedFile}
        onConfirm={handleImportConfirm}
        onCancel={() => {
          setImportDialogOpen(false);
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />

      <ExportAllDialog
        open={exportAllDialogOpen}
        onOpenChange={setExportAllDialogOpen}
        exportableCount={exportableItems.length}
        exportFormat={exportFormat}
        joinFiles={joinFiles}
        onFormatChange={setExportFormat}
        onJoinToggle={() => setJoinFiles((v) => !v)}
        onConfirm={handleExportAllConfirm}
      />

      <EffectsDialog
        open={effectsDialogOpen}
        onOpenChange={setEffectsDialogOpen}
        versions={effectsTargetVersions}
        sourceVersionId={effectsSourceVersionId}
        effectsChain={effectsChain}
        isApplying={applyingEffects}
        onSourceVersionChange={setEffectsSourceVersionId}
        onEffectsChainChange={setEffectsChain}
        onConfirm={handleApplyEffectsConfirm}
      />
    </div>
  );
}
