import { useState, useRef, useEffect, useCallback } from 'react';
import { DeckId, DeckState, PlayerStatus } from '../types.ts';
import { loadYouTubeIFrameAPI } from '../utils/youtube.ts';

interface UseYouTubeDeckProps {
  deckId: DeckId;
  elementId: string;
  initialVideoId?: string;
  initialVolume?: number;
  initialGain?: number;
  initialMuted?: boolean;
  initialFilter?: number;
  initialEqLow?: number;
  initialEqMid?: number;
  initialEqHigh?: number;
  onTrackLoaded?: (track: { id: string; title: string }) => void;
  onAutoPauseOpposite?: () => void;
}

export function useYouTubeDeck({
  deckId,
  elementId,
  initialVideoId = '',
  initialVolume = 100,
  initialGain = 50,
  initialMuted = false,
  initialFilter = 0,
  initialEqLow = 0,
  initialEqMid = 0,
  initialEqHigh = 0,
  onTrackLoaded,
  onAutoPauseOpposite,
}: UseYouTubeDeckProps) {
  const [deck, setDeck] = useState<DeckState>({
    deckId,
    videoId: initialVideoId,
    title: '',
    author: '',
    duration: 0,
    currentTime: 0,
    status: 'IDLE',
    volume: initialVolume,
    gain: initialGain,
    filter: initialFilter,
    effectiveVolume: initialVolume,
    muted: initialMuted,
    playbackRate: 1.0,
    speedPitchPercent: 0,
    cuePoint: null,
    isCueActive: false,
    loopActive: false,
    loopStart: null,
    loopEnd: null,
    loopBeats: null,
    bpm: 126,
    isOn: true,
    eqLow: initialEqLow,
    eqMid: initialEqMid,
    eqHigh: initialEqHigh,
    error: null,
    isLoading: false,
    thumbnailUrl: '',
  });

  const playerRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const isSettingUpRef = useRef(false);

  // Keep latest callbacks in refs to prevent stale closure inside YouTube event listeners
  const onTrackLoadedRef = useRef(onTrackLoaded);
  onTrackLoadedRef.current = onTrackLoaded;

  const onAutoPauseOppositeRef = useRef(onAutoPauseOpposite);
  onAutoPauseOppositeRef.current = onAutoPauseOpposite;

  const effectiveVolRef = useRef(deck.effectiveVolume);
  effectiveVolRef.current = deck.effectiveVolume;

  const playbackRateRef = useRef(deck.playbackRate);
  playbackRateRef.current = deck.playbackRate;

  // High-frequency polling loop for current time, duration & loop boundary detection
  useEffect(() => {
    const updateProgress = () => {
      const player = playerRef.current;
      if (player && typeof player.getCurrentTime === 'function') {
        try {
          const current = player.getCurrentTime() || 0;
          const total = player.getDuration() || 0;

          setDeck((prev) => {
            // Check Loop condition
            if (
              prev.loopActive &&
              prev.loopStart !== null &&
              prev.loopEnd !== null &&
              current >= prev.loopEnd
            ) {
              // Rewind to loop start
              player.seekTo(prev.loopStart, true);
              return {
                ...prev,
                currentTime: prev.loopStart,
                duration: total > 0 ? total : prev.duration,
              };
            }

            // Also dynamically enrich title and duration if player received metadata late
            let updatedTitle = prev.title;
            let updatedAuthor = prev.author;
            try {
              if (!prev.title || prev.title.startsWith('Track ')) {
                const videoData = player.getVideoData?.();
                if (videoData && videoData.title) {
                  updatedTitle = videoData.title;
                  updatedAuthor = videoData.author || '';
                  onTrackLoadedRef.current?.({ id: prev.videoId, title: videoData.title });
                }
              }
            } catch {
              // ignore
            }

            return {
              ...prev,
              currentTime: current,
              duration: total > 0 ? total : prev.duration,
              title: updatedTitle,
              author: updatedAuthor,
            };
          });
        } catch {
          // Player might not be ready yet
        }
      }
    };

    timerRef.current = window.setInterval(updateProgress, 150);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Initialize or load video into YouTube player
  const loadVideo = useCallback(
    async (newVideoId: string) => {
      if (!newVideoId) return;

      setDeck((prev) => ({
        ...prev,
        videoId: newVideoId,
        isLoading: true,
        error: null,
        status: 'BUFFERING',
        cuePoint: null,
        loopActive: false,
        currentTime: 0,
        thumbnailUrl: `https://img.youtube.com/vi/${newVideoId}/hqdefault.jpg`,
      }));

      try {
        const YT = await loadYouTubeIFrameAPI();

        // If player instance already exists and is attached to DOM, reuse it without rebuilding iframe
        if (playerRef.current && typeof playerRef.current.cueVideoById === 'function') {
          try {
            // Use cueVideoById so it preloads without unsolicited loud autoplay over the other deck
            playerRef.current.cueVideoById({
              videoId: newVideoId,
              startSeconds: 0,
            });

            // Re-apply current fader volume and playback rate
            try {
              playerRef.current.setVolume(effectiveVolRef.current);
              if (effectiveVolRef.current === 0) {
                playerRef.current.mute?.();
              } else {
                playerRef.current.unMute?.();
              }
              playerRef.current.setPlaybackRate(playbackRateRef.current);
            } catch {
              // ignore
            }

            setDeck((prev) => ({
              ...prev,
              isLoading: false,
              status: 'CUED',
              currentTime: 0,
            }));

            // Fetch video title and duration once cued
            setTimeout(() => {
              try {
                const videoData = playerRef.current?.getVideoData?.();
                const totalDur = playerRef.current?.getDuration?.() || 0;
                if (videoData && videoData.title) {
                  setDeck((p) => ({
                    ...p,
                    title: videoData.title,
                    author: videoData.author || '',
                    duration: totalDur > 0 ? totalDur : p.duration,
                  }));
                  onTrackLoadedRef.current?.({ id: newVideoId, title: videoData.title });
                }
              } catch {
                // ignore
              }
            }, 600);
            return;
          } catch (cueErr) {
            console.warn(`Re-cueing player ${elementId} failed, will re-mount:`, cueErr);
          }
        }

        // Check if DOM target element exists; wait a frame if needed
        let targetEl = document.getElementById(elementId);
        if (!targetEl) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          targetEl = document.getElementById(elementId);
          if (!targetEl) {
            throw new Error(`Target DOM element #${elementId} not found in document.`);
          }
        }

        if (isSettingUpRef.current) return;
        isSettingUpRef.current = true;

        new YT.Player(elementId, {
          height: '100%',
          width: '100%',
          videoId: newVideoId,
          playerVars: {
            autoplay: 0,
            controls: 1, // keep embedded controls accessible
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              isSettingUpRef.current = false;
              playerRef.current = event.target;

              // Apply initial volume and playback rate
              try {
                event.target.setVolume(effectiveVolRef.current);
                if (effectiveVolRef.current === 0) {
                  event.target.mute?.();
                } else {
                  event.target.unMute?.();
                }
                event.target.setPlaybackRate(playbackRateRef.current);

                const videoData = event.target.getVideoData?.();
                const totalDur = event.target.getDuration?.() || 0;

                setDeck((prev) => ({
                  ...prev,
                  isLoading: false,
                  status: 'CUED',
                  duration: totalDur,
                  title: videoData?.title || `Track ${newVideoId}`,
                  author: videoData?.author || '',
                }));

                if (videoData?.title) {
                  onTrackLoadedRef.current?.({ id: newVideoId, title: videoData.title });
                }
              } catch {
                setDeck((prev) => ({ ...prev, isLoading: false, status: 'CUED' }));
              }
            },
            onStateChange: (event: any) => {
              // YT.PlayerState: -1 (UNSTARTED), 0 (ENDED), 1 (PLAYING), 2 (PAUSED), 3 (BUFFERING), 5 (CUED)
              let mappedStatus: PlayerStatus = 'IDLE';
              if (event.data === 1) {
                mappedStatus = 'PLAYING';
                // Trigger auto-pause on opposite deck if Exclusive Mode is active
                onAutoPauseOppositeRef.current?.();
              } else if (event.data === 2) {
                mappedStatus = 'PAUSED';
              } else if (event.data === 3) {
                mappedStatus = 'BUFFERING';
              } else if (event.data === 0) {
                mappedStatus = 'ENDED';
                // Strictly prevent YouTube from autoplaying any suggested or random video when ended
                try {
                  event.target.pauseVideo?.();
                  event.target.seekTo?.(0, true);
                } catch {
                  // ignore
                }
              } else if (event.data === 5) {
                mappedStatus = 'CUED';
              } else if (event.data === -1) {
                mappedStatus = 'UNSTARTED';
              }

              setDeck((prev) => ({
                ...prev,
                status: mappedStatus,
                isLoading: mappedStatus === 'BUFFERING',
              }));

              // Refresh video title if missing or placeholder
              try {
                const videoData = event.target.getVideoData?.();
                if (videoData && videoData.title) {
                  setDeck((p) => {
                    if (!p.title || p.title.startsWith('Track ')) {
                      return { ...p, title: videoData.title, author: videoData.author || '' };
                    }
                    return p;
                  });
                }
              } catch {
                // ignore
              }
            },
            onError: (event: any) => {
              isSettingUpRef.current = false;
              let errMsg = 'Playback error occurred';
              if (event.data === 2) errMsg = 'Invalid YouTube URL or Video ID (Code 2)';
              else if (event.data === 5) errMsg = 'HTML5 player error on this track (Code 5)';
              else if (event.data === 100) errMsg = 'Video not found, removed, or private (Code 100)';
              else if (event.data === 101 || event.data === 150) {
                errMsg = 'Embedding restricted by copyright owner. Try a different track (Code 150).';
              }

              setDeck((prev) => ({
                ...prev,
                status: 'ERROR',
                error: errMsg,
                isLoading: false,
              }));
            },
          },
        });
      } catch (err: any) {
        isSettingUpRef.current = false;
        setDeck((prev) => ({
          ...prev,
          status: 'ERROR',
          error: err?.message || 'Failed to initialize YouTube Player',
          isLoading: false,
        }));
      }
    },
    [elementId]
  );

  // Trigger initial video load on mount if provided
  useEffect(() => {
    if (initialVideoId) {
      loadVideo(initialVideoId);
    }
  }, [initialVideoId, loadVideo]);

  // Playback actions
  const play = useCallback(() => {
    setDeck((p) => (p.isOn ? p : { ...p, isOn: true }));

    if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
      try {
        playerRef.current.playVideo();
        setDeck((p) => ({ ...p, status: 'PLAYING', error: null, isOn: true }));
      } catch (err) {
        console.error('Failed to play video', err);
      }
    } else if (deck.videoId) {
      // Re-initialize and play
      loadVideo(deck.videoId).then(() => {
        setTimeout(() => {
          playerRef.current?.playVideo?.();
        }, 400);
      });
    }
  }, [deck.videoId, loadVideo]);

  const pause = useCallback(() => {
    if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
      playerRef.current.pauseVideo();
      setDeck((p) => ({ ...p, status: 'PAUSED' }));
    }
  }, []);

  const stop = useCallback(() => {
    if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
      playerRef.current.pauseVideo();
      const returnTime = deck.cuePoint !== null ? deck.cuePoint : 0;
      playerRef.current.seekTo(returnTime, true);
      setDeck((p) => ({ ...p, status: 'PAUSED', currentTime: returnTime }));
    }
  }, [deck.cuePoint]);

  const restart = useCallback(() => {
    if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
      playerRef.current.seekTo(0, true);
      if (deck.isOn) {
        playerRef.current.playVideo();
        setDeck((p) => ({ ...p, status: 'PLAYING', currentTime: 0 }));
      }
    }
  }, [deck.isOn]);

  const seek = useCallback((seconds: number) => {
    if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
      playerRef.current.seekTo(seconds, true);
      setDeck((p) => ({ ...p, currentTime: seconds }));
    }
  }, []);

  // Cue action (DJ Standard: If paused, sets cue point. If playing, jumps to cue and pauses)
  const cue = useCallback(() => {
    if (deck.status === 'PLAYING') {
      const targetCue = deck.cuePoint !== null ? deck.cuePoint : 0;
      pause();
      seek(targetCue);
    } else {
      // Set cue point at current position
      setDeck((p) => ({ ...p, cuePoint: p.currentTime }));
    }
  }, [deck.status, deck.cuePoint, pause, seek]);

  // Sync action: matches playback rate and aligns tempo/phase with opposite deck
  const syncTo = useCallback(
    (targetRate: number, targetBpm: number) => {
      if (playerRef.current && typeof playerRef.current.setPlaybackRate === 'function') {
        playerRef.current.setPlaybackRate(targetRate);
      }
      setDeck((p) => ({
        ...p,
        playbackRate: targetRate,
        bpm: targetBpm,
        speedPitchPercent: Math.round((targetRate - 1.0) * 100),
      }));
    },
    []
  );

  // Loop actions
  const toggleLoop = useCallback(() => {
    setDeck((prev) => {
      const nextActive = !prev.loopActive;
      if (nextActive && (prev.loopStart === null || prev.loopEnd === null)) {
        // Default 4 beats loop starting at current time
        const beatDuration = 60 / prev.bpm;
        const lengthSeconds = beatDuration * 4;
        return {
          ...prev,
          loopActive: true,
          loopBeats: 4,
          loopStart: prev.currentTime,
          loopEnd: prev.currentTime + lengthSeconds,
        };
      }
      return {
        ...prev,
        loopActive: nextActive,
      };
    });
  }, []);

  const setLoopBeats = useCallback((beats: 4 | 8 | 16) => {
    setDeck((prev) => {
      const beatDuration = 60 / prev.bpm;
      const lengthSeconds = beatDuration * beats;
      return {
        ...prev,
        loopActive: true,
        loopBeats: beats,
        loopStart: prev.currentTime,
        loopEnd: prev.currentTime + lengthSeconds,
      };
    });
  }, []);

  // Playback rate / Tempo
  const setPlaybackRate = useCallback((rate: number) => {
    if (playerRef.current && typeof playerRef.current.setPlaybackRate === 'function') {
      try {
        playerRef.current.setPlaybackRate(rate);
      } catch {
        // ignore
      }
    }
    setDeck((p) => ({
      ...p,
      playbackRate: rate,
      speedPitchPercent: Math.round((rate - 1.0) * 100),
    }));
  }, []);

  const setSpeedOffset = useCallback((percent: number) => {
    // Convert -50 to +50% into supported YouTube rates (0.5, 0.75, 1, 1.25, 1.5, 2.0)
    const factor = 1 + percent / 100;
    // Map to closest supported YouTube playback rate
    const supportedRates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    let closest = supportedRates[0];
    let minDiff = Infinity;
    for (const r of supportedRates) {
      const diff = Math.abs(r - factor);
      if (diff < minDiff) {
        minDiff = diff;
        closest = r;
      }
    }

    if (playerRef.current && typeof playerRef.current.setPlaybackRate === 'function') {
      try {
        playerRef.current.setPlaybackRate(closest);
      } catch {
        // ignore
      }
    }

    setDeck((p) => ({
      ...p,
      speedPitchPercent: percent,
      playbackRate: closest,
    }));
  }, []);

  // Update hardware volume on the player instance
  const applyVolume = useCallback((effectiveVol: number) => {
    setDeck((p) => ({ ...p, effectiveVolume: effectiveVol }));
    if (playerRef.current && typeof playerRef.current.setVolume === 'function') {
      try {
        playerRef.current.setVolume(effectiveVol);
        if (effectiveVol === 0) {
          playerRef.current.mute?.();
        } else {
          playerRef.current.unMute?.();
        }
      } catch {
        // ignore
      }
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    setDeck((p) => ({ ...p, volume: vol }));
  }, []);

  const setGain = useCallback((gain: number) => {
    setDeck((p) => ({ ...p, gain }));
  }, []);

  const setFilter = useCallback((filter: number) => {
    setDeck((p) => ({ ...p, filter }));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    setDeck((p) => ({ ...p, muted }));
  }, []);

  const toggleMute = useCallback(() => {
    setDeck((p) => ({ ...p, muted: !p.muted }));
  }, []);

  const toggleDeckPower = useCallback(() => {
    setDeck((p) => {
      const nextOn = !p.isOn;
      if (!nextOn) {
        // If turned OFF, pause player
        if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
          playerRef.current.pauseVideo();
        }
      }
      return { ...p, isOn: nextOn };
    });
  }, []);

  const updateEq = useCallback((band: 'low' | 'mid' | 'high', val: number) => {
    setDeck((p) => {
      if (band === 'low') return { ...p, eqLow: val };
      if (band === 'mid') return { ...p, eqMid: val };
      return { ...p, eqHigh: val };
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return {
    deck,
    playerRef,
    loadVideo,
    play,
    pause,
    stop,
    restart,
    seek,
    cue,
    syncTo,
    toggleLoop,
    setLoopBeats,
    setPlaybackRate,
    setSpeedOffset,
    setVolume,
    setGain,
    setFilter,
    setMuted,
    toggleMute,
    toggleDeckPower,
    updateEq,
    applyVolume,
  };
}
