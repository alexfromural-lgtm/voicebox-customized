import { useQuery } from '@tanstack/react-query';
import { useMatchRoute } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Globe, Loader2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api/client';
import { getLanguageOptionsForEngine, type LanguageCode } from '@/lib/constants/languages';
import { applyEngineSelection } from '@/components/Generation/EngineModelSelector';
import { useGenerationForm } from '@/lib/hooks/useGenerationForm';
import { useProfile, useProfiles } from '@/lib/hooks/useProfiles';
import { useStory } from '@/lib/hooks/useStories';
import { cn } from '@/lib/utils/cn';
import { useGenerationStore } from '@/stores/generationStore';
import { useStoryStore } from '@/stores/storyStore';
import { useUIStore } from '@/stores/uiStore';
import { EngineModelSelector } from './EngineModelSelector';
import { ParalinguisticInput } from './ParalinguisticInput';
import type { TranslationLanguage } from '@/lib/api/types';

interface FloatingGenerateBoxProps {
  isPlayerOpen?: boolean;
  showVoiceSelector?: boolean;
}

export function FloatingGenerateBox({
  isPlayerOpen = false,
  showVoiceSelector = false,
}: FloatingGenerateBoxProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const selectedProfileId = useUIStore((state) => state.selectedProfileId);
  const setSelectedProfileId = useUIStore((state) => state.setSelectedProfileId);
  const setSelectedEngine = useUIStore((state) => state.setSelectedEngine);
  const { data: selectedProfile } = useProfile(selectedProfileId || '');
  const { data: profiles } = useProfiles();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isInstructExpanded, setIsInstructExpanded] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const matchRoute = useMatchRoute();
  const isStoriesRoute = matchRoute({ to: '/stories' });
  const selectedStoryId = useStoryStore((state) => state.selectedStoryId);
  const trackEditorHeight = useStoryStore((state) => state.trackEditorHeight);
  const { data: currentStory } = useStory(selectedStoryId);
  const addPendingStoryAdd = useGenerationStore((s) => s.addPendingStoryAdd);

  // Fetch effect presets for the dropdown
  const { data: effectPresets } = useQuery({
    queryKey: ['effectPresets'],
    queryFn: () => apiClient.listEffectPresets(),
  });

  // Calculate if track editor is visible (on stories route with items)
  const hasTrackEditor = isStoriesRoute && currentStory && currentStory.items.length > 0;

  const { form, handleSubmit, isPending } = useGenerationForm({
    onSuccess: async (generationId) => {
      setIsExpanded(false);
      // Defer the story add until TTS completes -- useGenerationProgress handles it
      if (isStoriesRoute && selectedStoryId && generationId) {
        addPendingStoryAdd(generationId, selectedStoryId);
      }
    },
    getEffectsChain: () => {
      if (!selectedPresetId) return undefined;
      // Profile's own effects chain (no matching preset)
      if (selectedPresetId === '_profile') {
        return selectedProfile?.effects_chain ?? undefined;
      }
      if (!effectPresets) return undefined;
      const preset = effectPresets.find((p) => p.id === selectedPresetId);
      return preset?.effects_chain;
    },
  });

  // Click away handler to collapse the box
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;

      // Don't collapse if clicking inside the container
      if (containerRef.current?.contains(target)) {
        return;
      }

      // Don't collapse if clicking on a Select dropdown (which renders in a portal)
      if (
        target.closest('[role="listbox"]') ||
        target.closest('[data-radix-popper-content-wrapper]')
      ) {
        return;
      }

      setIsExpanded(false);
    }

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded]);

  // Read selectedProfileId via ref so the auto-select effect only fires when
  // profiles load — NOT when the user explicitly deselects a profile.
  const selectedProfileIdRef = useRef(selectedProfileId);
  selectedProfileIdRef.current = selectedProfileId;

  // Set first voice as default only on initial profiles load (or after all
  // profiles are deleted and a new one is added). Deliberately excludes
  // selectedProfileId from deps so clicking a selected card to deselect it
  // doesn't immediately re-select profiles[0].
  useEffect(() => {
    if (!selectedProfileIdRef.current && profiles && profiles.length > 0) {
      setSelectedProfileId(profiles[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, setSelectedProfileId]);

  // Sync engine selection to global store so ProfileList can filter
  const watchedEngine = form.watch('engine');

  // When the user explicitly picks an engine incompatible with the currently
  // selected preset profile, deselect that profile so they can choose a compatible one.
  // Using onEngineChange (user-initiated) instead of a useEffect avoids the race
  // condition where profile→engine sync fires before the engine watcher can check.
  function handleEngineChange(rawValue: string) {
    if (!selectedProfile || selectedProfile.voice_type !== 'preset') return;
    const engineKey = rawValue.startsWith('qwen_custom_voice:')
      ? 'qwen_custom_voice'
      : rawValue.startsWith('qwen:')
        ? 'qwen'
        : rawValue.startsWith('tada:')
          ? 'tada'
          : rawValue;
    if (engineKey !== selectedProfile.preset_engine) {
      setSelectedProfileId(null);
    }
  }
  useEffect(() => {
    if (watchedEngine) {
      setSelectedEngine(watchedEngine);
    }
  }, [watchedEngine, setSelectedEngine]);

  // Sync generation form language, engine, and effects with selected profile
  useEffect(() => {
    if (selectedProfile?.language) {
      form.setValue('language', selectedProfile.language as LanguageCode);
    }
    // Auto-switch engine to match the profile
    const engine = selectedProfile?.default_engine ?? selectedProfile?.preset_engine;
    if (engine) {
      const selectValue =
        engine === 'qwen'
          ? 'qwen:1.7B'
          : engine === 'qwen_custom_voice'
            ? 'qwen_custom_voice:1.7B'
            : engine === 'tada'
              ? 'tada:1B'
              : engine;
      applyEngineSelection(form, selectValue);
    } else if (selectedProfile && selectedProfile.voice_type !== 'preset') {
      // Cloned/designed profile with no default — ensure a compatible (non-preset) engine
      const currentEngine = form.getValues('engine');
      const presetEngines = new Set(['kokoro', 'qwen_custom_voice', 'silero']);
      if (currentEngine && presetEngines.has(currentEngine)) {
        applyEngineSelection(form, 'qwen:1.7B');
      }
    }
    // Pre-fill effects from profile defaults
    if (
      selectedProfile?.effects_chain &&
      selectedProfile.effects_chain.length > 0 &&
      effectPresets
    ) {
      // Try to match against a known preset
      const profileChainJson = JSON.stringify(selectedProfile.effects_chain);
      const matchingPreset = effectPresets.find(
        (p) => JSON.stringify(p.effects_chain) === profileChainJson,
      );
      if (matchingPreset) {
        setSelectedPresetId(matchingPreset.id);
      } else {
        // No matching preset — use special value to pass profile chain directly
        setSelectedPresetId('_profile');
      }
    } else if (
      selectedProfile &&
      (!selectedProfile.effects_chain || selectedProfile.effects_chain.length === 0)
    ) {
      setSelectedPresetId(null);
    }
  }, [selectedProfile, effectPresets, form]);

  // Auto-resize textarea based on content (only when expanded)
  useEffect(() => {
    if (!isExpanded) {
      // Reset textarea height after collapse animation completes
      const timeoutId = setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.style.height = '32px';
          textarea.style.overflowY = 'hidden';
        }
      }, 200); // Wait for animation to complete
      return () => clearTimeout(timeoutId);
    }

    const textarea = textareaRef.current;
    if (!textarea) return;

    const adjustHeight = () => {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const minHeight = 100; // Expanded minimum
      const maxHeight = 300; // Max height in pixels
      const targetHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
      textarea.style.height = `${targetHeight}px`;

      // Show scrollbar if content exceeds max height
      if (scrollHeight > maxHeight) {
        textarea.style.overflowY = 'auto';
      } else {
        textarea.style.overflowY = 'hidden';
      }
    };

    // Small delay to let framer animation complete
    const timeoutId = setTimeout(() => {
      adjustHeight();
    }, 200);

    // Adjust on mount and when value changes
    adjustHeight();

    // Watch for input changes
    textarea.addEventListener('input', adjustHeight);

    return () => {
      clearTimeout(timeoutId);
      textarea.removeEventListener('input', adjustHeight);
    };
  }, [isExpanded]);

  async function onSubmit(data: Parameters<typeof handleSubmit>[0]) {
    await handleSubmit(data, selectedProfileId);
  }

  // Translate button: translate text, fill the form, submit generate (saves to history)
  const [isTranslating, setIsTranslating] = useState(false);

  /**
   * Split text into chunks of at most maxChars characters,
   * preferring to break at whitespace so words are not cut in half.
   */
  function splitTextIntoChunks(text: string, maxChars: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > maxChars) {
      // Try to find the last whitespace within the limit
      let splitAt = remaining.lastIndexOf(' ', maxChars);
      if (splitAt <= 0) {
        // No whitespace found — hard-cut at the limit
        splitAt = maxChars;
      }
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
    return chunks;
  }

  const handleTranslateAndSynthesize = async () => {
    if (!selectedProfileId) return;

    const textValue = form.getValues('text');
    if (!textValue || !String(textValue).trim()) {
      toast({
        title: t('global.error'),
        description: t(`generation.errors.emptyTranslation`),
        variant: 'destructive',
      });
      return;
    }

    const TRANSLATE_MAX_CHARS = 1800;
    const currentEngine = form.getValues('engine');
    const isF5TtsRu = currentEngine === 'f5tts_ru';

    // For F5-TTS Russian with long text: split into chunks and process each one
    if (textValue.length > TRANSLATE_MAX_CHARS && isF5TtsRu) {
      const chunks = splitTextIntoChunks(textValue, TRANSLATE_MAX_CHARS);

      const availableTranslationLanguages = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'] as const;
      const currentLang = form.getValues('language');
      const translationLang = availableTranslationLanguages.find((lang: TranslationLanguage) => lang === currentLang);

      if (!translationLang) {
        toast({
          title: t('global.error'),
          description: `Selected language "${currentLang}" is not supported for translation. Please change it.`,
          variant: 'destructive',
        });
        return;
      }

      setIsTranslating(true);
      toast({
        title: t('generation.chunked.started'),
        description: t('generation.chunked.description', { count: chunks.length }),
      });

      let successCount = 0;
      try {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          // Translate this chunk
          const result = await apiClient.translateText(chunk, translationLang);
          if (!result.translated_text) continue;

          // Put translated chunk into the form and generate
          form.setValue('text', result.translated_text, { shouldValidate: true });
          await form.handleSubmit(onSubmit)();
          successCount++;
        }

        // Restore the original text in the input after all chunks are processed
        form.setValue('text', textValue, { shouldValidate: false });

        toast({
          title: t('generation.chunked.done', { successCount, total: chunks.length }),
        });
      } catch (error) {
        console.error('Chunked translation failed:', error);
        // Restore original text on error too
        form.setValue('text', textValue, { shouldValidate: false });
        toast({
          title: t('global.error'),
          description: t('generation.errors.translationFailed'),
          variant: 'destructive',
        });
      } finally {
        setIsTranslating(false);
      }
      return;
    }

    // Standard path: text within limit
    if (textValue.length > TRANSLATE_MAX_CHARS) {
      toast({
        title: t('global.error'),
        description: t('generation.errors.textTooLong', { count: textValue.length, max: TRANSLATE_MAX_CHARS }),
        variant: 'destructive',
      });
      return;
    }

    const availableTranslationLanguages = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'] as const;
    const currentLang = form.getValues('language');
    const translationLang = availableTranslationLanguages.find((lang: TranslationLanguage) => lang === currentLang);

    if (!translationLang) {
      toast({
        title: t('global.error'),
        description: `Selected language "${currentLang}" is not supported for translation. Please change it.`,
        variant: 'destructive',
      });
      return;
    }

    setIsTranslating(true);
    try {
      // Step 1: translate text only
      const result = await apiClient.translateText(textValue, translationLang);

      if (!result.translated_text) {
        toast({
          title: t('global.error'),
          description: t(`generation.errors.emptyTranslation`),
          variant: 'destructive',
        });
        return;
      }

      // Step 2: set translated text in the form
      form.setValue('text', result.translated_text, { shouldValidate: true });

      // Step 3: submit the standard generate form so the result appears in history
      await form.handleSubmit(onSubmit)();
    } catch (error) {
      console.error('Translation failed:', error);
      toast({
        title: t('global.error'),
        description: t('generation.errors.translationFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsTranslating(false);
    }
  };


  return (
    <motion.div
      ref={containerRef}
      className={cn(
        'fixed right-auto',
        isStoriesRoute
          ? // Position aligned with story list: after sidebar + padding, width 360px
          'left-[calc(5rem+2rem)] w-[360px]'
          : 'left-[calc(5rem+2rem)] right-8 lg:right-auto lg:w-[calc((100%-5rem-4rem)/2-1rem)]',
      )}
      style={{
        // On stories route: offset by track editor height when visible
        // On other routes: offset by audio player height when visible
        bottom: hasTrackEditor
          ? `${trackEditorHeight + 24}px`
          : isPlayerOpen
            ? 'calc(7rem + 1.5rem)'
            : '1.5rem',
      }}
    >
      <motion.div
        className="bg-background/30 backdrop-blur-2xl border border-accent/20 rounded-[2rem] shadow-2xl hover:bg-background/40 hover:border-accent/20 transition-all duration-300 p-3"
        transition={{ duration: 0.6, ease: 'easeInOut' }}
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="flex gap-2">
              <motion.div className="flex-1" transition={{ duration: 0.3, ease: 'easeOut' }}>
                <FormField
                  control={form.control}
                  name="text"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <motion.div
                          animate={{
                            height: isExpanded ? 'auto' : '32px',
                          }}
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                          style={{ overflow: 'hidden' }}
                        >
                          {form.watch('engine') === 'chatterbox_turbo' ? (
                            <ParalinguisticInput
                              value={field.value}
                              onChange={field.onChange}
                              placeholder={
                                isStoriesRoute && currentStory
                                  ? t('generation.placeholder.storyWithEffects', {
                                    name: currentStory.name,
                                  })
                                  : selectedProfile
                                    ? t('generation.placeholder.effectsHint')
                                    : t('generation.placeholder.selectVoice')
                              }
                              className="px-3 py-2 resize-none bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus:ring-0 outline-none ring-0 rounded-2xl text-sm w-full"
                              style={{
                                minHeight: isExpanded ? '100px' : '32px',
                                maxHeight: '300px',
                                overflowY: 'auto',
                              }}
                              disabled={!selectedProfileId}
                              onClick={() => setIsExpanded(true)}
                              onFocus={() => setIsExpanded(true)}
                            />
                          ) : (
                            <Textarea
                              {...field}
                              ref={(node: HTMLTextAreaElement | null) => {
                                textareaRef.current = node;
                                if (typeof field.ref === 'function') {
                                  field.ref(node);
                                }
                              }}
                              placeholder={
                                isStoriesRoute && currentStory
                                  ? t('generation.placeholder.story', { name: currentStory.name })
                                  : selectedProfile
                                    ? t('generation.placeholder.profile', {
                                      name: selectedProfile.name,
                                    })
                                    : t('generation.placeholder.selectVoice')
                              }
                              className="resize-none bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus:ring-0 outline-none ring-0 rounded-2xl text-sm placeholder:text-muted-foreground/60 w-full"
                              style={{
                                minHeight: isExpanded ? '100px' : '32px',
                                maxHeight: '300px',
                              }}
                              disabled={!selectedProfileId}
                              onClick={() => setIsExpanded(true)}
                              onFocus={() => setIsExpanded(true)}
                            />
                          )}
                        </motion.div>
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </motion.div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Generate button - positioned to the left of Translate */}
                <div className="group relative">
                  <Button
                    type="submit"
                    disabled={isPending || !selectedProfileId}
                    className="h-10 w-10 rounded-full bg-accent hover:bg-accent/90 hover:scale-105 text-accent-foreground shadow-lg hover:shadow-accent/50 transition-all duration-200"
                    size="icon"
                    aria-label={
                      isPending
                        ? t('generation.button.generating')
                        : !selectedProfileId
                          ? t('generation.button.selectFirst')
                          : t('generation.button.generate')
                    }
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                  </Button>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground border border-border opacity-0 transition-opacity group-hover:opacity-100 z-[9999]">
                    {isPending
                      ? t('generation.button.generating')
                      : !selectedProfileId
                        ? t('generation.button.selectFirst')
                        : t('generation.button.generate')}
                  </span>
                </div>

                {/* Translate button — translates text then auto-submits generate */}
                {!isPending && (
                  <div className="group relative">
                    <Button
                      type="button"
                      onClick={handleTranslateAndSynthesize}
                      disabled={isTranslating || !selectedProfileId || form.getValues('text').trim() === ''}
                      variant="secondary"
                      className="h-10 w-10 rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground transition-all duration-200"
                      size="icon"
                      aria-label={isTranslating ? t('generation.button.translating') : t('generation.button.translate')}
                    >
                      {isTranslating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Globe className="h-4 w-4" />
                      )}
                    </Button>
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground border border-border opacity-0 transition-opacity group-hover:opacity-100 z-[9999]">
                      {isTranslating ? t('generation.button.translating') : t('generation.button.translate')}
                    </span>
                  </div>
                )}


                {/* Instruct toggle — only for Qwen CustomVoice, which actually honors the kwarg */}
                <AnimatePresence>
                  {isExpanded && form.watch('engine') === 'qwen_custom_voice' && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.2 }}
                      className="absolute top-0 right-[calc(100%+0.5rem)]"
                    >
                      <div className="group relative">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setIsInstructExpanded((prev) => !prev)}
                          className={cn(
                            'h-10 w-10 rounded-full transition-all duration-200',
                            isInstructExpanded
                              ? 'bg-accent text-accent-foreground border border-accent hover:bg-accent/90'
                              : 'bg-card border border-border hover:bg-background/50',
                          )}
                          aria-label={
                            isInstructExpanded
                              ? t('generation.instruct.hide')
                              : t('generation.instruct.show')
                          }
                          aria-pressed={isInstructExpanded}
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                        </Button>
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground border border-border opacity-0 transition-opacity group-hover:opacity-100 z-[9999]">
                          {t('generation.instruct.tooltip')}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Additive instruct textarea — shown below main text when toggle is on and engine supports it */}
            <AnimatePresence>
              {isInstructExpanded && form.watch('engine') === 'qwen_custom_voice' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <FormField
                    control={form.control}
                    name="instruct"
                    render={({ field }) => (
                      <FormItem className="mt-2">
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder={t('generation.instruct.placeholder')}
                            className="resize-none bg-transparent border border-accent/20 focus-visible:ring-1 focus-visible:ring-accent/40 rounded-2xl text-sm placeholder:text-muted-foreground/60 w-full px-3 py-2"
                            style={{ minHeight: '60px', maxHeight: '160px' }}
                            maxLength={500}
                          />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className=" mt-3"
              >
                <div className="flex items-center gap-2">
                  {showVoiceSelector && (
                    <div className="flex-1">
                      <Select
                        value={selectedProfileId || ''}
                        onValueChange={(value) => setSelectedProfileId(value || null)}
                      >
                        <SelectTrigger className="h-8 text-xs bg-card border-border rounded-full hover:bg-background/50 transition-all w-full">
                          <SelectValue placeholder={t('generation.voiceSelector.placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles?.map((profile) => (
                            <SelectItem key={profile.id} value={profile.id} className="text-xs">
                              {profile.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="language"
                    render={({ field }) => {
                      const engineLangs = getLanguageOptionsForEngine(
                        form.watch('engine') || 'qwen',
                      );
                      return (
                        <FormItem className="flex-1 space-y-0">
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-8 text-xs bg-card border-border rounded-full hover:bg-background/50 transition-all">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {engineLangs.map((lang) => (
                                <SelectItem key={lang.value} value={lang.value} className="text-xs">
                                  {lang.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      );
                    }}
                  />

                  <FormItem className="flex-1 space-y-0">
                    <EngineModelSelector form={form} compact onEngineChange={handleEngineChange} />
                  </FormItem>

                  <FormItem className="flex-1 space-y-0">
                    <Select
                      value={selectedPresetId || 'none'}
                      onValueChange={(value) =>
                        setSelectedPresetId(value === 'none' ? null : value)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs bg-card border-border rounded-full hover:bg-background/50 transition-all">
                        <SelectValue placeholder={t('generation.effects.none')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">
                          {t('generation.effects.none')}
                        </SelectItem>
                        {selectedProfile?.effects_chain &&
                          selectedProfile.effects_chain.length > 0 && (
                            <SelectItem value="_profile" className="text-xs">
                              {t('generation.effects.profileDefault')}
                            </SelectItem>
                          )}
                        {effectPresets?.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id} className="text-xs">
                            {preset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                </div>
              </motion.div>
            </AnimatePresence>
          </form>
        </Form>
      </motion.div>
    </motion.div>
  );
}
