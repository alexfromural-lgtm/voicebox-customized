import { motion } from 'framer-motion';

interface AudioBarsProps {
  mode: 'idle' | 'generating' | 'playing';
}

export function AudioBars({ mode }: AudioBarsProps) {
  const barColor = mode !== 'idle' ? 'bg-accent' : 'bg-muted-foreground/40';
  return (
    <div className="flex items-center gap-[2px] h-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={`${mode}-${i}`}
          className={`w-[3px] rounded-full ${barColor}`}
          animate={
            mode === 'generating'
              ? { height: ['6px', '16px', '6px'] }
              : mode === 'playing'
                ? { height: ['8px', '14px', '4px', '12px', '8px'] }
                : { height: '8px' }
          }
          transition={
            mode === 'generating'
              ? { duration: 0.6, repeat: Infinity, delay: i * 0.08, ease: 'easeInOut' }
              : mode === 'playing'
                ? { duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }
                : { duration: 0.4, ease: 'easeOut' }
          }
        />
      ))}
    </div>
  );
}
