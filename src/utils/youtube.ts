import { DemoTrack } from '../types.ts';

// Comprehensive extractor for YouTube Video IDs from various URLs, shorts, embeds, and raw IDs
export function extractYouTubeVideoId(input: string): string | null {
  if (!input) return null;
  // Strip whitespace, quotes, angle brackets
  const trimmed = input.trim().replace(/^[<"']+|[>"']+$/g, '');
  if (!trimmed) return null;

  // 1. Direct 11-character YouTube video ID (alphanumeric, dash, underscore)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // 2. Comprehensive URL pattern matching:
  // - youtube.com/watch?v=XXXXXXXXXXX
  // - youtube.com/embed/XXXXXXXXXXX
  // - youtube-nocookie.com/embed/XXXXXXXXXXX
  // - youtube.com/shorts/XXXXXXXXXXX
  // - youtube.com/live/XXXXXXXXXXX
  // - youtube.com/v/XXXXXXXXXXX
  // - youtu.be/XXXXXXXXXXX
  // - music.youtube.com/watch?v=XXXXXXXXXXX
  // - m.youtube.com/watch?v=XXXXXXXXXXX
  const urlPatterns = [
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?v=|watch\?.+?&v=))([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
  ];

  for (const pattern of urlPatterns) {
    const match = trimmed.match(pattern);
    if (match && match[1] && /^[a-zA-Z0-9_-]{11}$/.test(match[1])) {
      return match[1];
    }
  }

  // 3. Fallback: Parse via URL API
  try {
    const urlStr = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }
      // Check pathname segments: /shorts/ID, /embed/ID, /live/ID, /v/ID
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live', 'v'].includes(segments[0]) && segments[1]) {
        const candidate = segments[1];
        if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
          return candidate;
        }
      }
    } else if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const candidate = parsed.pathname.slice(1).split('/')[0];
      if (candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
        return candidate;
      }
    }
  } catch {
    // If URL parsing fails, continue to final fallback
  }

  return null;
}

// Global promise to guarantee YouTube Iframe API script is only injected once
let ytApiPromise: Promise<any> | null = null;

export function loadYouTubeIFrameAPI(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window not available'));
  }

  // If already available on window
  if ((window as any).YT && (window as any).YT.Player) {
    return Promise.resolve((window as any).YT);
  }

  if (ytApiPromise) {
    return ytApiPromise;
  }

  ytApiPromise = new Promise((resolve, reject) => {
    // Set a safety timeout
    const timeout = setTimeout(() => {
      ytApiPromise = null;
      reject(new Error('YouTube IFrame API script load timed out. Check network connection.'));
    }, 12000);

    // YouTube API calls window.onYouTubeIframeAPIReady when script finishes
    const existingCallback = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      if (existingCallback) {
        try {
          existingCallback();
        } catch {
          // ignore
        }
      }
      resolve((window as any).YT);
    };

    // Check if script tag is already in DOM
    const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => {
        clearTimeout(timeout);
        ytApiPromise = null;
        reject(new Error('Failed to load YouTube IFrame API script'));
      };
      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.head.appendChild(tag);
      }
    } else if ((window as any).YT && (window as any).YT.Player) {
      clearTimeout(timeout);
      resolve((window as any).YT);
    }
  });

  return ytApiPromise;
}

// Convert seconds into standard MM:SS or HH:MM:SS
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Calculate effective gain for each deck based on crossfader position (0 to 100)
// 0 = Deck A 100% (max), Deck B 0% (min)
// 50 = Center (both equal at 50% for linear, or ~70.7% for equal-power)
// 100 = Deck A 0% (min), Deck B 100% (max)
// Linear gives exact volume ramp: 100 -> 90 -> 75 -> 50 -> 25 -> 0
export function calculateCrossfadeGains(
  crossfaderPos: number,
  curve: 'linear' | 'equal-power' = 'linear'
): { gainA: number; gainB: number } {
  const clamped = Math.max(0, Math.min(100, crossfaderPos));
  const t = clamped / 100; // 0.0 to 1.0

  if (curve === 'linear') {
    return {
      gainA: 1 - t,
      gainB: t,
    };
  }

  // Standard mathematical equal-power crossfade curve: cos(t * pi/2) and sin(t * pi/2)
  const gainA = Math.cos(t * (Math.PI / 2));
  const gainB = Math.sin(t * (Math.PI / 2));

  return { gainA, gainB };
}

// Calculate final player volume (0 - 100) given channel fader, crossfader gain, master volume, ON/mute state, and independent channel gain
export function calculateEffectiveVolume(
  channelFader: number,
  crossfadeGain: number,
  masterVolume: number,
  isOn: boolean,
  isMuted: boolean,
  channelGain: number = 50 // 0 - 100 (50 = unity 1.0x)
): number {
  if (!isOn || isMuted) return 0;
  const gainMultiplier = Math.max(0, channelGain / 50);
  const combined = (channelFader / 100) * gainMultiplier * crossfadeGain * (masterVolume / 100);
  return Math.max(0, Math.min(100, Math.round(combined * 100)));
}

// Curated high-energy & groove tracks for immediate DJ testing
export const CURATED_DEMO_TRACKS: DemoTrack[] = [
  {
    title: 'Never Gonna Give You Up (Classic Remaster)',
    author: 'Rick Astley',
    videoId: 'dQw4w9WgXcQ',
    genre: '80s Dance Pop',
    bpm: 113,
  },
  {
    title: 'Around the World (Electro Club Mix)',
    author: 'Daft Punk',
    videoId: 'dwDns8x3Jb4',
    genre: 'French House',
    bpm: 121,
  },
  {
    title: 'Midnight City (Synthwave Anthem)',
    author: 'M83',
    videoId: 'dX3k_QDnzHE',
    genre: 'Synthwave',
    bpm: 105,
  },
  {
    title: 'Ghosts \'n\' Stuff (EDM Club Festival)',
    author: 'deadmau5 ft. Rob Swire',
    videoId: 'h7ArUgxtlJs',
    genre: 'Progressive Electro',
    bpm: 128,
  },
  {
    title: 'Lofi Beats to Chill / Mix to',
    author: 'Lofi Records',
    videoId: 'jfKfPfyJRdk',
    genre: 'Lo-Fi Chill Hop',
    bpm: 85,
  },
  {
    title: 'Strobe (Live Performance Mix)',
    author: 'deadmau5',
    videoId: 'tKi9Z-f6qX4',
    genre: 'Progressive House',
    bpm: 128,
  },
];
