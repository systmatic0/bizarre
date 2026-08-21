
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TUNES_PASSWORD = 'theunforgettablesound';
const TUNES_UNLOCK_KEY = 'bizarre:tunes-unlocked';

const playlist = [
  {
    title: 'Tomorrow Comes Today',
    artist: 'Gorillaz',
    album: 'Gorillaz',
    year: '2001',
    time: '3:15',
    src: '/music/01 Tomorrow Comes Today.mp3',
    art: '/music/01 Tomorrow Comes Today.jpg',
  },
  {
    title: 'All Going Off Round Here',
    artist: 'DJ Fidelity',
    album: 'The No.1 Drum & Bass Album',
    year: '2008',
    time: '5:49',
    src: '/music/02 All Going Off Round Here.mp3',
    art: '/music/02 All Going Off Round Here.jpg',
  },
  {
    title: 'Run For Your Life',
    artist: 'Static-X',
    album: 'Project Regeneration, Vol. 2',
    year: '2024',
    time: '2:48',
    src: '/music/03 Run For Your Life.mp3',
    art: '/music/03 Run For Your Life.jpg',
  },
  {
    title: 'The Way You Like It',
    artist: 'Adema',
    album: 'Adema',
    year: '2001',
    time: '3:40',
    src: '/music/04 The Way You Like It.mp3',
    art: '/music/04 The Way You Like It.jpg',
  },
  {
    title: 'Gap in the Fence',
    artist: 'Enter Shikari',
    album: 'Common Dreads',
    year: '2009',
    time: '4:07',
    src: '/music/05 Gap in the Fence.mp3',
    art: '/music/05 Gap in the Fence.jpeg',
  },
  {
    title: 'Death Kink',
    artist: 'Fontaines D.C.',
    album: 'Romance',
    year: '2024',
    time: '2:23',
    src: '/music/06 Death Kink.mp3',
    art: '/music/06 Death Kink.jpg',
  },
  {
    title: 'Renditions of Reality',
    artist: 'Twiztid',
    album: 'Mostasteless',
    year: '1998',
    time: '05:16',
    src: '/music/07 Renditions of Reality.mp3',
    art: '/music/07 Renditions of Reality.jpg',
  },
  {
    title: 'Angels Falling',
    artist: 'Insane Clown Posse',
    album: "Hell's Pit",
    year: '2002',
    time: '3:21',
    src: '/music/08 Angels Falling.mp3',
    art: '/music/08 Angels Falling.jpg',
  },
  {
    title: 'Transitions',
    artist: 'Mike Shinoda',
    album: "Dropped Frames, Vol. 2",
    year: '2020',
    time: '3:00',
    src: '/music/09 Transitions.mp3',
    art: '/music/09 Transitions.jpg',
  },
  {
    title: 'What Does Your Soul Look Like',
    artist: 'DJ Shadow',
    album: "Endtroducing",
    year: '1996',
    time: '7:28',
    src: '/music/10 What Does Your Soul Look Like.mp3',
    art: '/music/10 What Does Your Soul Look Like.jpg',
  },
];



const defaultArt =
  'data:image/svg+xml;utf8,<svg width="160" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="24" fill="%23222"/><text x="50%" y="54%" text-anchor="middle" font-size="32" fill="%23b1f1cb" font-family="sans-serif" dy=".3em">🎵</text></svg>';

function getTotalDuration(playlist: { time?: string }[]) {
  // expects time in mm:ss or m:ss
  let totalSeconds = 0;
  for (const track of playlist) {
    if (!track.time) continue;
    const [min, sec] = track.time.split(':').map(Number);
    totalSeconds += (min || 0) * 60 + (sec || 0);
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function Tunes() {
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(
    () => typeof window !== 'undefined' && sessionStorage.getItem(TUNES_UNLOCK_KEY) === '1',
  );

  useEffect(() => {
    if (unlocked) return;

    const input = window.prompt('Password:');
    if (input === TUNES_PASSWORD) {
      sessionStorage.setItem(TUNES_UNLOCK_KEY, '1');
      setUnlocked(true);
    } else {
      window.alert('Wrong password.');
      navigate('/', { replace: true });
    }
  }, [unlocked, navigate]);

  const [current, setCurrent] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);


  const handleSelect = (idx: number) => {
    setCurrent(idx);
    setTimeout(() => {
      audioRef.current?.play();
    }, 0);
  };

  // Autoplay next song when current ends
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnded = () => {
      setCurrent((prev) => (prev + 1) % playlist.length);
      // play will be triggered by useEffect on current change
    };
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioRef, playlist.length]);

  // Play automatically when current changes, but not on initial load
  const isFirstLoad = useRef(true);
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.play().catch(() => {});
    }
  }, [current]);

  if (!unlocked) {
    return null;
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, marginTop: 48, width: '100%' }}>

      
      <div style={{ width: '100%', maxWidth: 720, background: 'var(--backgroundBlur)', borderRadius: 16, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, fontSize: '1rem' }}>
        {/* Now Playing Section */}
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 32, marginBottom: 8 }}>
          <img
            src={playlist[current].art || defaultArt}
            alt="Art"
            style={{ width: 160, height: 160, borderRadius: 12, objectFit: 'cover', background: '#222', boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}
          />
          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: 8, lineHeight: 1.1, marginTop: 0, textAlign: 'left' }}>
              {playlist[current].title}
            </h2>
            <p style={{ fontSize: '1.1rem', marginBottom: 4, marginTop: 0, textAlign: 'left' }}>
              Artist: <p style={{ display: 'inline', fontSize: '1rem', fontWeight: 600, margin: 0 }}>{playlist[current].artist}</p>
            </p>
            <p style={{ fontSize: '1.1rem', marginBottom: 4, marginTop: 0, textAlign: 'left' }}>
              Album: <p style={{ display: 'inline', fontSize: '1rem', fontWeight: 600, margin: 0 }}>{playlist[current].album}</p>
            </p>
            <p style={{ fontSize: '1.1rem', marginTop: 0, textAlign: 'left' }}>
              Time: <p style={{ display: 'inline', fontSize: '1rem', fontWeight: 700, margin: 0 }}>{playlist[current].time}</p>
            </p>
          </div>
        </div>
        <audio
          ref={audioRef}
          controls
          src={playlist[current].src}
          style={{ width: '100%', marginBottom: 12 }}
        >
          Your browser does not support the audio element.
        </audio>
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1rem' }}>
            <thead>
              <tr style={{ color: 'var(--text)' }}>

                <th style={{ textAlign: 'left', padding: '8px 8px', fontWeight: 600, fontSize: '1rem' }}>Song</th>
                <th style={{ textAlign: 'left', padding: '8px 8px', fontWeight: 600, fontSize: '1rem' }}>Album</th>
                <th style={{ textAlign: 'left', padding: '8px 8px', fontWeight: 600, fontSize: '1rem' }}>Year</th>
                <th style={{ textAlign: 'left', padding: '8px 8px', fontWeight: 600, fontSize: '1rem' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {playlist.map((track, idx) => {
                const isActive = idx === current;
                const tdRadius = isActive
                  ? { background: 'rgba(177,241,203,0.10)' }
                  : {};
                return (
                  <tr
                    key={track.src}
                    style={{
                      color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                      fontWeight: 400,
                      cursor: 'pointer',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onClick={() => handleSelect(idx)}
                  >
                    <td style={{ padding: '8px 8px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', fontSize: '1rem', ...tdRadius }}>
                      <img
                        src={track.art || defaultArt}
                        alt="Art"
                        style={{ width: 40, height: 40, objectFit: 'cover', background: '#222', boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', fontSize: '1rem' }}>
                        <p style={{ fontWeight: 500, margin: 0, fontSize: '1rem' }}>{track.title}</p>
                        <p style={{ opacity: 0.7, margin: 0, fontSize: '1rem' }}>{track.artist}</p>
                      </div>
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'left', fontSize: '1rem', ...tdRadius }}>{track.album || ''}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'left', fontSize: '1rem', ...tdRadius }}>{track.year || ''}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'left', fontSize: '1rem', ...tdRadius }}>{track.time || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
        {playlist.length} songs, {getTotalDuration(playlist)} total
      </div>
    </section>
  );
}
