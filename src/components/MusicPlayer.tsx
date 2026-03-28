import { useCallback, useEffect, useRef, useState } from "react";

interface Track {
  title: string;
  src: string;
}

interface ElectronMusicAPI {
  music: { listTracks: () => Promise<Track[]> };
  isElectron: boolean;
}

function getMusicAPI(): ElectronMusicAPI["music"] | null {
  const w = window as unknown as { electronAPI?: ElectronMusicAPI };
  return w.electronAPI?.isElectron ? w.electronAPI.music : null;
}

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackIndex, setTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = getMusicAPI();
    if (api) {
      api.listTracks().then((list) => {
        let shuffled = list.sort(() => Math.random() - 0.5);
        setTracks(shuffled);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const track = tracks[trackIndex] ?? null;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    audio.src = track.src;
    if (playing) {
      audio.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIndex, track]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
    setPlaying((p) => !p);
  }, [playing]);

  const skip = useCallback(
    (dir: 1 | -1) => {
      setTrackIndex((i) => (i + dir + tracks.length) % tracks.length);
    },
    [tracks.length],
  );

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !muted;
    setMuted((m) => !m);
  }, [muted]);

  const handleEnded = useCallback(() => {
    setTrackIndex((i) => (i + 1) % tracks.length);
  }, [tracks.length]);

  if (loading || tracks.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900/60 rounded border border-slate-700">
        <span className="text-[11px] font-pixel text-slate-400">
          {loading ? "Loading..." : "No tracks"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900/60 rounded border border-slate-700">
      <audio ref={audioRef} onEnded={handleEnded} />

      {/* Prev */}
      <button
        onClick={() => skip(-1)}
        className="text-slate-300 hover:text-white transition-colors"
        title="Previous track"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="1" y="2" width="2" height="8" />
          <polygon points="11,2 11,10 4,6" />
        </svg>
      </button>

      {/* Play/Pause */}
      <button
        onClick={toggle}
        className="text-indigo-400 hover:text-indigo-300 transition-colors"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="2" y="2" width="3" height="8" />
            <rect x="7" y="2" width="3" height="8" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <polygon points="2,1 11,6 2,11" />
          </svg>
        )}
      </button>

      {/* Next */}
      <button
        onClick={() => skip(1)}
        className="text-slate-300 hover:text-white transition-colors"
        title="Next track"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <polygon points="1,2 1,10 8,6" />
          <rect x="9" y="2" width="2" height="8" />
        </svg>
      </button>

      {/* Track name – marquee scroll */}
      <div className="overflow-hidden max-w-[100px]">
        <span
          className="text-[11px] font-pixel text-slate-300 inline-block whitespace-nowrap animate-marquee"
          title={track!.title}
        >
          {track!.title}
        </span>
      </div>

      {/* Mute */}
      <button
        onClick={toggleMute}
        className={`ml-auto transition-colors ${muted ? "text-red-400 hover:text-red-300" : "text-slate-300 hover:text-white"}`}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <polygon points="1,4 1,8 3,8 6,11 6,1 3,4" />
            <line
              x1="8"
              y1="3"
              x2="11"
              y2="9"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="11"
              y1="3"
              x2="8"
              y2="9"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <polygon points="1,4 1,8 3,8 6,11 6,1 3,4" />
            <path
              d="M8,4 Q10,6 8,8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path
              d="M9,2.5 Q12,6 9,9.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
