import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { HistoryQuery } from '@/lib/api/types';
import { usePlatform } from '@/platform/PlatformContext';

// Re-exported from dedicated module — kept here so existing imports don't break
export type { ExportAllProgress, ExportFormat } from './useExportAllAudio';
export { useExportAllAudio } from './useExportAllAudio';

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
