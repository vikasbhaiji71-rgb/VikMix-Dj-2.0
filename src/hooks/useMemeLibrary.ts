import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { useYouTubeDeck } from './useYouTubeDeck.ts';
import { MixerSettings } from '../types.ts';
import { calculateCrossfadeGains, calculateEffectiveVolume } from '../utils/youtube.ts';
import { generateProceduralMemeSound } from '../utils/audioEncoder.ts';
import { getAllStoredMemes, saveMemeToStorage, deleteMemeFromStorage, StoredMeme } from '../utils/memeStorage.ts';

type DeckControls = ReturnType<typeof useYouTubeDeck>;

export interface MemeItem {
  id: string;
  name: string;
  url?: string;
  blob?: Blob;
  duration?: number;
  category: 'royalty_free' | 'viral_slot' | 'custom';
  isReady: boolean;
  description?: string;
}

interface UseMemeLibraryProps {
  deckAControlsRef: MutableRefObject<DeckControls | null>;
  deckBControlsRef: MutableRefObject<DeckControls | null>;
  settingsRef: MutableRefObject<MixerSettings>;
  isMasterMutedRef: MutableRefObject<boolean>;
  rewindTransitionActiveRef: MutableRefObject<boolean>;
  soundOverlayDuckingRef?: MutableRefObject<number>;
  onNotify?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export interface MemeLibraryState {
  memes: MemeItem[];
  playingMemeId: string | null;
  playingMemeName: string | null;
  status: 'READY' | 'PLAYING';
  memeDuckingMultiplierRef: MutableRefObject<number>;
  onAddMemeFile: (file: File, slotId?: string) => Promise<void>;
  onPlayMeme: (id: string) => Promise<void>;
  onStopMeme: () => void;
  onRemoveMeme: (id: string) => Promise<void>;
}

// Built-in Indian viral reaction meme slots (copyright compliant: user-provided audio slots)
const VIRAL_MEME_SLOTS: Omit<MemeItem, 'isReady'>[] = [
  { id: 'slot-nagar-palika', name: 'Arrey Bhai Bhai! (Nagar Palika)', category: 'viral_slot', description: 'Famous viral civic reaction drop' },
  { id: 'slot-kya-gunda', name: 'Kya Gunda Banega Re', category: 'viral_slot', description: 'Classic Bollywood comedy dialogue reaction' },
  { id: 'slot-baigan', name: 'Aayein? (Baigan)', category: 'viral_slot', description: 'Iconic classroom viral reaction sound' },
  { id: 'slot-moye-moye', name: 'Moye Moye (Reaction Drop)', category: 'viral_slot', description: 'Viral tragicomic slow reaction tone' },
  { id: 'slot-paisa-hi-paisa', name: 'Raju: Paisa Hi Paisa Hoga', category: 'viral_slot', description: 'Legendary comedy wealth anticipation punchline' },
  { id: 'slot-bhai-kya-hua', name: 'Bhai Yeh Kya Hogaya', category: 'viral_slot', description: 'Astonished gaming/meme commentary reaction' },
  { id: 'slot-mauj-kardi', name: 'Wah Bete Mauj Kardi', category: 'viral_slot', description: 'Celebrated driving viral reaction audio' },
  { id: 'slot-samosa', name: 'Samosa Khao (Reaction)', category: 'viral_slot', description: 'Popular conversational meme moment' },
];

export function useMemeLibrary({
  deckAControlsRef,
  deckBControlsRef,
  settingsRef,
  isMasterMutedRef,
  rewindTransitionActiveRef,
  soundOverlayDuckingRef,
  onNotify,
}: UseMemeLibraryProps): MemeLibraryState {
  const [memes, setMemes] = useState<MemeItem[]>([]);
  const [playingMemeId, setPlayingMemeId] = useState<string | null>(null);
  const [status, setStatus] = useState<'READY' | 'PLAYING'>('READY');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const memeDuckingMultiplierRef = useRef<number>(1.0);
  const duckingAnimRef = useRef<number | null>(null);

  // Helper to calculate effective deck volumes with current meme ducking multiplier (50%)
  const applyDeckVolumes = useCallback(
    (memeDuckFactor: number) => {
      // If REWIND MIX is actively controlling the smooth crossfade volume curve, let that loop control fading
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
      const soundOverlayDuck = soundOverlayDuckingRef?.current ?? 1.0;
      const totalDuck = soundOverlayDuck * memeDuckFactor;

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

      const effVolA = Math.max(0, Math.min(100, Math.round(baseVolA * totalDuck)));
      const effVolB = Math.max(0, Math.min(100, Math.round(baseVolB * totalDuck)));

      deckA.applyVolume(effVolA);
      deckB.applyVolume(effVolB);
    },
    [deckAControlsRef, deckBControlsRef, settingsRef, isMasterMutedRef, rewindTransitionActiveRef, soundOverlayDuckingRef]
  );

  // Smooth ducking down: music volume fades 100% -> 50% over ~300ms
  const startMemeDucking = useCallback(() => {
    if (duckingAnimRef.current) {
      cancelAnimationFrame(duckingAnimRef.current);
    }

    const startFactor = memeDuckingMultiplierRef.current;
    const targetFactor = 0.50; // Exactly 50% background music ducking as requested
    const durationMs = 300;
    const startTime = performance.now();

    const animateDown = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      // Smooth cosine easing
      const factor = startFactor + (targetFactor - startFactor) * (1 - Math.cos((progress * Math.PI) / 2));
      memeDuckingMultiplierRef.current = factor;
      applyDeckVolumes(factor);

      if (progress < 1) {
        duckingAnimRef.current = requestAnimationFrame(animateDown);
      } else {
        duckingAnimRef.current = null;
        memeDuckingMultiplierRef.current = targetFactor;
        applyDeckVolumes(targetFactor);
      }
    };

    duckingAnimRef.current = requestAnimationFrame(animateDown);
  }, [applyDeckVolumes]);

  // Smooth restoration: music volume fades 50% -> 100% over ~350ms
  const restoreMusicVolume = useCallback(() => {
    if (duckingAnimRef.current) {
      cancelAnimationFrame(duckingAnimRef.current);
    }

    const startFactor = memeDuckingMultiplierRef.current;
    const targetFactor = 1.0;
    const durationMs = 350;
    const startTime = performance.now();

    const animateUp = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      // Smooth sine easing
      const factor = startFactor + (targetFactor - startFactor) * Math.sin((progress * Math.PI) / 2);
      memeDuckingMultiplierRef.current = factor;
      applyDeckVolumes(factor);

      if (progress < 1) {
        duckingAnimRef.current = requestAnimationFrame(animateUp);
      } else {
        duckingAnimRef.current = null;
        memeDuckingMultiplierRef.current = 1.0;
        applyDeckVolumes(1.0);
      }
    };

    duckingAnimRef.current = requestAnimationFrame(animateUp);
  }, [applyDeckVolumes]);

  // Load procedural royalty-free memes and IndexedDB stored memes on mount
  useEffect(() => {
    let isCancelled = false;
    const objectUrlsToRevoke: string[] = [];

    async function initLibrary() {
      // 1. Generate royalty-free procedural reaction sound effects (100% copyright clean)
      const royaltyFreeDefs: { id: string; name: string; type: 'airhorn' | 'boing' | 'rimshot' | 'buzzer' | 'sannata'; desc: string }[] = [
        { id: 'rf-airhorn', name: 'Air Horn DJ Blast', type: 'airhorn', desc: 'Classic DJ triple stab reggae horn' },
        { id: 'rf-boing', name: 'Cartoon Boing / Twist', type: 'boing', desc: 'Punchy comedy bounce sound effect' },
        { id: 'rf-rimshot', name: 'Comedy Rimshot (Ba-Dum-Tss)', type: 'rimshot', desc: 'Snappy punchline drum drop' },
        { id: 'rf-sannata', name: 'Cricket Chirp (Sannata Drop)', type: 'sannata', desc: 'Awkward silence cricket reaction' },
        { id: 'rf-buzzer', name: 'Fail Buzzer (Wrong Answer)', type: 'buzzer', desc: 'Game-show comedy buzzer drop' },
      ];

      const builtInMemes: MemeItem[] = [];
      for (const def of royaltyFreeDefs) {
        try {
          const blob = await generateProceduralMemeSound(def.type);
          const url = URL.createObjectURL(blob);
          objectUrlsToRevoke.push(url);
          builtInMemes.push({
            id: def.id,
            name: def.name,
            url,
            blob,
            duration: def.type === 'sannata' ? 1.0 : def.type === 'airhorn' ? 0.9 : 0.7,
            category: 'royalty_free',
            isReady: true,
            description: def.desc,
          });
        } catch (err) {
          console.warn(`Could not synthesize ${def.name}:`, err);
        }
      }

      // 2. Fetch IndexedDB user memes
      const storedMemes = await getAllStoredMemes();

      // 3. Construct viral meme slots, populating with user-stored audio if available
      const viralSlots: MemeItem[] = VIRAL_MEME_SLOTS.map((slot) => {
        const matchingStored = storedMemes.find((m) => m.slotId === slot.id);
        if (matchingStored) {
          const url = URL.createObjectURL(matchingStored.blob);
          objectUrlsToRevoke.push(url);
          return {
            ...slot,
            url,
            blob: matchingStored.blob,
            duration: matchingStored.duration,
            isReady: true,
          };
        }
        return {
          ...slot,
          isReady: false,
        };
      });

      // 4. Construct custom user memes (not tied to predefined slots)
      const customMemes: MemeItem[] = storedMemes
        .filter((m) => !m.slotId)
        .map((m) => {
          const url = URL.createObjectURL(m.blob);
          objectUrlsToRevoke.push(url);
          return {
            id: m.id,
            name: m.name,
            url,
            blob: m.blob,
            duration: m.duration,
            category: 'custom' as const,
            isReady: true,
          };
        });

      if (!isCancelled) {
        setMemes([...builtInMemes, ...viralSlots, ...customMemes]);
      }
    }

    initLibrary();

    return () => {
      isCancelled = true;
      objectUrlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Initialize persistent HTMLAudioElement for single-instance playback
  const getAudioElement = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.volume = 1.0; // Play meme at full volume

      audio.onended = () => {
        setStatus('READY');
        setPlayingMemeId(null);
        restoreMusicVolume();
      };

      audio.onerror = (e) => {
        console.warn('Meme audio playback error:', e);
        setStatus('READY');
        setPlayingMemeId(null);
        restoreMusicVolume();
      };

      audioRef.current = audio;
    }
    return audioRef.current;
  }, [restoreMusicVolume]);

  // Handle playing a meme sound
  const handlePlayMeme = useCallback(
    async (id: string) => {
      const meme = memes.find((m) => m.id === id);
      if (!meme || !meme.url || !meme.isReady) {
        onNotify?.('Please attach an audio file for this meme first.', 'warning');
        return;
      }

      const audio = getAudioElement();

      // If another meme is already playing, cleanly stop it first
      if (playingMemeId) {
        audio.pause();
        audio.currentTime = 0;
      }

      // If already ducked, maintain ducking; otherwise smoothly fade music to 50%
      if (memeDuckingMultiplierRef.current > 0.55) {
        startMemeDucking();
      }

      audio.src = meme.url;
      audio.currentTime = 0;
      audio.volume = 1.0;

      try {
        await audio.play();
        setPlayingMemeId(id);
        setStatus('PLAYING');
      } catch (err) {
        console.warn('Playback prevented by browser policy:', err);
        setStatus('READY');
        setPlayingMemeId(null);
        restoreMusicVolume();
        onNotify?.('Tap anywhere on screen to enable audio playback.', 'warning');
      }
    },
    [memes, getAudioElement, playingMemeId, startMemeDucking, restoreMusicVolume, onNotify]
  );

  // Handle stopping the currently playing meme sound
  const handleStopMeme = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setStatus('READY');
    setPlayingMemeId(null);
    restoreMusicVolume();
  }, [restoreMusicVolume]);

  // Handle adding a new meme audio file (custom or to a specific viral slot)
  const handleAddMemeFile = useCallback(
    async (file: File, slotId?: string) => {
      if (!file) return;

      const objectUrl = URL.createObjectURL(file);

      // Determine duration if possible
      let duration: number | undefined;
      try {
        const tempAudio = new Audio(objectUrl);
        await new Promise<void>((resolve) => {
          tempAudio.addEventListener('loadedmetadata', () => {
            duration = Math.round(tempAudio.duration);
            resolve();
          });
          tempAudio.addEventListener('error', () => resolve());
          setTimeout(resolve, 800);
        });
      } catch {}

      const memeId = slotId || `meme-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const storedMeme: StoredMeme = {
        id: memeId,
        name: file.name.replace(/\.[^/.]+$/, ''), // strip extension for clean display
        blob: file,
        duration,
        timestamp: Date.now(),
        slotId,
      };

      // Save to IndexedDB
      await saveMemeToStorage(storedMeme);

      // Update state
      setMemes((prev) => {
        if (slotId) {
          return prev.map((item) =>
            item.id === slotId
              ? {
                  ...item,
                  url: objectUrl,
                  blob: file,
                  duration,
                  isReady: true,
                }
              : item
          );
        } else {
          const newCustomMeme: MemeItem = {
            id: memeId,
            name: storedMeme.name,
            url: objectUrl,
            blob: file,
            duration,
            category: 'custom',
            isReady: true,
          };
          return [...prev, newCustomMeme];
        }
      });

      onNotify?.(`Added "${file.name}" to Meme Library`, 'success');
    },
    [onNotify]
  );

  // Handle removing a meme (either clearing a slot or deleting a custom meme)
  const handleRemoveMeme = useCallback(
    async (id: string) => {
      if (playingMemeId === id) {
        handleStopMeme();
      }

      await deleteMemeFromStorage(id);

      setMemes((prev) =>
        prev
          .map((item) => {
            if (item.id === id) {
              if (item.category === 'viral_slot') {
                if (item.url) URL.revokeObjectURL(item.url);
                return {
                  ...item,
                  url: undefined,
                  blob: undefined,
                  duration: undefined,
                  isReady: false,
                };
              }
              // For custom memes, remove completely
              if (item.url) URL.revokeObjectURL(item.url);
              return null;
            }
            return item;
          })
          .filter((item): item is MemeItem => item !== null)
      );

      onNotify?.('Meme removed from library.', 'info');
    },
    [playingMemeId, handleStopMeme, onNotify]
  );

  // Clean up audio and animation on unmount
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
    };
  }, []);

  const playingMeme = memes.find((m) => m.id === playingMemeId);

  return {
    memes,
    playingMemeId,
    playingMemeName: playingMeme ? playingMeme.name : null,
    status,
    memeDuckingMultiplierRef,
    onAddMemeFile: handleAddMemeFile,
    onPlayMeme: handlePlayMeme,
    onStopMeme: handleStopMeme,
    onRemoveMeme: handleRemoveMeme,
  };
}
