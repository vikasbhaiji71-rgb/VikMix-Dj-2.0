import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { useYouTubeDeck } from './useYouTubeDeck.ts';
import { MixerSettings } from '../types.ts';
import { calculateCrossfadeGains, calculateEffectiveVolume } from '../utils/youtube.ts';
import { WebAudioEqualizer } from '../utils/webAudioEq.ts';

type DeckControls = ReturnType<typeof useYouTubeDeck>;

interface UseSoundOverlayProps {
  deckAControlsRef: MutableRefObject<DeckControls | null>;
  deckBControlsRef: MutableRefObject<DeckControls | null>;
  settingsRef: MutableRefObject<MixerSettings>;
  isMasterMutedRef: MutableRefObject<boolean>;
  rewindTransitionActiveRef: MutableRefObject<boolean>;
  eqLow?: number;
  eqMid?: number;
  eqHigh?: number;
  onNotify?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export interface SoundOverlayState {
  soundFile: { name: string; url: string } | null;
  status: 'READY' | 'PLAYING';
  onFileSelected: (file: File) => void;
  onPlaySound: () => void;
  onStopSound: () => void;
  onRemoveSound: () => void;
  duckingMultiplierRef: MutableRefObject<number>;
  setEq: (low: number, mid: number, high: number) => void;
}

export function useSoundOverlay({
  deckAControlsRef,
  deckBControlsRef,
  settingsRef,
  isMasterMutedRef,
  rewindTransitionActiveRef,
  eqLow = 0,
  eqMid = 0,
  eqHigh = 0,
  onNotify,
}: UseSoundOverlayProps): SoundOverlayState {
  const [soundFile, setSoundFile] = useState<{ name: string; url: string } | null>(null);
  const [status, setStatus] = useState<'READY' | 'PLAYING'>('READY');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const equalizerRef = useRef<WebAudioEqualizer | null>(null);
  const duckingMultiplierRef = useRef<number>(1.0);
  const duckingAnimRef = useRef<number | null>(null);

  // Initialize Web Audio API Equalizer instance
  if (!equalizerRef.current) {
    equalizerRef.current = new WebAudioEqualizer();
  }

  // Real-time EQ parameter updates: whenever eqLow, eqMid, or eqHigh change, update DSP filters immediately
  useEffect(() => {
    if (equalizerRef.current) {
      equalizerRef.current.setEq(eqLow, eqMid, eqHigh);
    }
  }, [eqLow, eqMid, eqHigh]);

  const setEq = useCallback((low: number, mid: number, high: number) => {
    if (equalizerRef.current) {
      equalizerRef.current.setEq(low, mid, high);
    }
  }, []);

  // Helper to calculate and apply effective deck volumes with current ducking multiplier
  const applyDeckVolumes = useCallback(
    (duckFactor: number) => {
      // If REWIND MIX is actively running its own animation loop, let that loop control fading
      if (rewindTransitionActiveRef.current) {
        return;
      }

      const deckA = deckAControlsRef.current;
      const deckB = deckBControlsRef.current;
      if (!deckA || !deckB) return;

      const settings = settingsRef.current;
      const isMasterMuted = isMasterMutedRef.current;

      const { gainA, gainB } = calculateCrossfadeGains(
        settings.crossfader,
        settings.crossfadeCurve || 'linear'
      );
      const effectiveMaster = isMasterMuted ? 0 : settings.masterVolume;

      const baseVolA = calculateEffectiveVolume(
        deckA.deck.volume,
        gainA,
        effectiveMaster,
        deckA.deck.isOn,
        deckA.deck.muted,
        deckA.deck.gain ?? 50
      );

      const baseVolB = calculateEffectiveVolume(
        deckB.deck.volume,
        gainB,
        effectiveMaster,
        deckB.deck.isOn,
        deckB.deck.muted,
        deckB.deck.gain ?? 50
      );

      const effVolA = Math.max(0, Math.min(100, Math.round(baseVolA * duckFactor)));
      const effVolB = Math.max(0, Math.min(100, Math.round(baseVolB * duckFactor)));

      deckA.applyVolume(effVolA);
      deckB.applyVolume(effVolB);
    },
    [deckAControlsRef, deckBControlsRef, settingsRef, isMasterMutedRef, rewindTransitionActiveRef]
  );

  // Smooth ducking down: playlist volume fades 100% -> 25% over ~300ms
  const startDucking = useCallback(() => {
    if (duckingAnimRef.current) {
      cancelAnimationFrame(duckingAnimRef.current);
    }

    const startFactor = duckingMultiplierRef.current;
    const targetFactor = 0.25; // Duck to 25% background volume
    const durationMs = 300;
    const startTime = performance.now();

    const animateDown = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      // Smooth cosine easing
      const factor = startFactor + (targetFactor - startFactor) * (1 - Math.cos((progress * Math.PI) / 2));
      duckingMultiplierRef.current = factor;
      applyDeckVolumes(factor);

      if (progress < 1) {
        duckingAnimRef.current = requestAnimationFrame(animateDown);
      } else {
        duckingAnimRef.current = null;
        duckingMultiplierRef.current = targetFactor;
        applyDeckVolumes(targetFactor);
      }
    };

    duckingAnimRef.current = requestAnimationFrame(animateDown);
  }, [applyDeckVolumes]);

  // Smooth restoration: playlist volume fades 25% -> 100% over ~380ms
  const restoreMusicVolume = useCallback(() => {
    if (duckingAnimRef.current) {
      cancelAnimationFrame(duckingAnimRef.current);
    }

    const startFactor = duckingMultiplierRef.current;
    const targetFactor = 1.0;
    const durationMs = 380;
    const startTime = performance.now();

    const animateUp = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      // Smooth sine easing
      const factor = startFactor + (targetFactor - startFactor) * Math.sin((progress * Math.PI) / 2);
      duckingMultiplierRef.current = factor;
      applyDeckVolumes(factor);

      if (progress < 1) {
        duckingAnimRef.current = requestAnimationFrame(animateUp);
      } else {
        duckingAnimRef.current = null;
        duckingMultiplierRef.current = 1.0;
        applyDeckVolumes(1.0);
      }
    };

    duckingAnimRef.current = requestAnimationFrame(animateUp);
  }, [applyDeckVolumes]);

  // Handle local file selection
  const handleFileSelected = useCallback(
    (file: File) => {
      if (!file) return;

      if (soundFile?.url) {
        try {
          URL.revokeObjectURL(soundFile.url);
        } catch {}
      }

      // Initialize persistent HTMLAudioElement and attach to Web Audio API EQ filter chain once
      if (!audioRef.current) {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.volume = 1.0;

        audio.onended = () => {
          setStatus('READY');
          restoreMusicVolume();
        };

        audio.onerror = (e) => {
          console.warn('Sound overlay audio element error:', e);
          setStatus('READY');
          restoreMusicVolume();
          onNotify?.('Error loading sound file format.', 'warning');
        };

        audioRef.current = audio;
        equalizerRef.current?.attachMediaElement(audio, {
          low: eqLow,
          mid: eqMid,
          high: eqHigh,
        });
      } else {
        audioRef.current.pause();
      }

      const objectUrl = URL.createObjectURL(file);
      audioRef.current.src = objectUrl;
      audioRef.current.load();

      // Ensure current EQ is applied
      equalizerRef.current?.setEq(eqLow, eqMid, eqHigh);

      setSoundFile({
        name: file.name,
        url: objectUrl,
      });
      setStatus('READY');
      onNotify?.(`Loaded "${file.name}" for Sound Overlay (Web Audio EQ Active)`, 'info');
    },
    [soundFile, restoreMusicVolume, onNotify, eqLow, eqMid, eqHigh]
  );

  // Handle PLAY SOUND
  const handlePlaySound = useCallback(() => {
    if (!soundFile || !audioRef.current) {
      onNotify?.('Please add a sound first.', 'warning');
      return;
    }

    const audio = audioRef.current;

    // Resume AudioContext on user interaction
    equalizerRef.current?.resume();
    equalizerRef.current?.setEq(eqLow, eqMid, eqHigh);

    // Reset currentTime to 0 (or restart cleanly if already playing)
    try {
      audio.currentTime = 0;
      audio.volume = 1.0; // Always 100% full foreground volume
    } catch {}

    // Start music ducking smoothly
    startDucking();

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setStatus('PLAYING');
        })
        .catch((err) => {
          console.warn('Autoplay prevented or playback error on sound overlay:', err);
          setStatus('READY');
          restoreMusicVolume();
          onNotify?.('Playback failed. Please click anywhere on the page to enable audio.', 'warning');
        });
    }
  }, [soundFile, startDucking, restoreMusicVolume, onNotify, eqLow, eqMid, eqHigh]);

  // Handle STOP
  const handleStopSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      try {
        audioRef.current.currentTime = 0;
      } catch {}
    }
    setStatus('READY');
    restoreMusicVolume();
  }, [restoreMusicVolume]);

  // Handle REMOVE
  const handleRemoveSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (soundFile?.url) {
      try {
        URL.revokeObjectURL(soundFile.url);
      } catch {}
    }
    setSoundFile(null);
    setStatus('READY');
    restoreMusicVolume();
    onNotify?.('Sound overlay removed.', 'info');
  }, [soundFile, restoreMusicVolume, onNotify]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (duckingAnimRef.current) {
        cancelAnimationFrame(duckingAnimRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      if (equalizerRef.current) {
        equalizerRef.current.close();
        equalizerRef.current = null;
      }
    };
  }, []);

  return {
    soundFile,
    status,
    onFileSelected: handleFileSelected,
    onPlaySound: handlePlaySound,
    onStopSound: handleStopSound,
    onRemoveSound: handleRemoveSound,
    duckingMultiplierRef,
    setEq,
  };
}
