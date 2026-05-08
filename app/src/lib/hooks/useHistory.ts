import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { HistoryQuery } from '@/lib/api/types';
import { usePlatform } from '@/platform/PlatformContext';


export function useHistory(query?: HistoryQuery) {
  return useQuery({
    queryKey: ['history', query],
    queryFn: () => apiClient.listHistory(query),
  });
}

export function useGenerationDetail(generationId: string) {
  return useQuery({
    queryKey: ['history', generationId],
    queryFn: () => apiClient.getGeneration(generationId),
    enabled: !!generationId,
  });
}

export function useDeleteGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (generationId: string) => apiClient.deleteGeneration(generationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useClearFailedGenerations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.clearFailedGenerations(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useExportGeneration() {
  const platform = usePlatform();

  return useMutation({
    mutationFn: async ({ generationId, text }: { generationId: string; text: string }) => {
      const blob = await apiClient.exportGeneration(generationId);

      // Create safe filename from text
      const safeText = text
        .substring(0, 30)
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();
      const filename = `generation-${safeText}.voicebox.zip`;

      await platform.filesystem.saveFile(filename, blob, [
        {
          name: 'Voicebox Generation',
          extensions: ['zip'],
        },
      ]);

      return blob;
    },
  });
}

export function useExportGenerationAudio() {
  const platform = usePlatform();

  return useMutation({
    mutationFn: async ({ generationId, text }: { generationId: string; text: string }) => {
      const blob = await apiClient.exportGenerationAudio(generationId);

      // Create safe filename from text
      const safeText = text
        .substring(0, 30)
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();
      const filename = `${safeText}.wav`;

      await platform.filesystem.saveFile(filename, blob, [
        {
          name: 'Audio File',
          extensions: ['wav'],
        },
      ]);

      return blob;
    },
  });
}

export function useImportGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => apiClient.importGeneration(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export interface ExportAllProgress {
  current: number;
  total: number;
}

export function useExportAllAudio() {
  const platform = usePlatform();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportAllProgress | null>(null);

  const exportAll = async (
    items: Array<{ id: string }>,
    onComplete?: (count: number) => void,
    onError?: (err: Error, index: number) => void,
  ) => {
    if (items.length === 0) return;

    // 1. Let the user pick a destination folder once
    const dir = await platform.filesystem.pickDirectory('Choose export folder');
    if (!dir) return; // user cancelled

    setIsExporting(true);
    setProgress({ current: 0, total: items.length });

    try {
      // Import Tauri writeFile — same plugin already used by saveFile
      const { writeFile } = await import('@tauri-apps/plugin-fs');

      for (let i = 0; i < items.length; i++) {
        const { id } = items[i];
        const blob = await apiClient.exportGenerationAudio(id);
        const arrayBuffer = await blob.arrayBuffer();
        // Zero-padded sequential name: 01.wav, 02.wav, …
        const filename = String(i + 1).padStart(2, '0') + '.wav';
        await writeFile(`${dir}\\${filename}`, new Uint8Array(arrayBuffer));
        setProgress({ current: i + 1, total: items.length });
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
