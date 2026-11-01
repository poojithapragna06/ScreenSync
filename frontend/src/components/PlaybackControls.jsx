import React, { useEffect, useRef, useState, useCallback } from 'react';
import { playbackApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Small inline icons (inherit the button's text colour)
const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);
const PlayIcon = () => <Icon><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></Icon>;
const PauseIcon = () => <Icon><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Icon>;
const PrevIcon = () => <Icon><rect x="5" y="5" width="2.5" height="14" rx="1" /><path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9.6 13.3a1.5 1.5 0 0 1 0-2.6l7.85-5.33A1 1 0 0 1 19 6.2z" /></Icon>;
const NextIcon = () => <Icon><rect x="16.5" y="5" width="2.5" height="14" rx="1" /><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83l7.85-5.33a1.5 1.5 0 0 0 0-2.6L6.55 5.37A1 1 0 0 0 5 6.2z" /></Icon>;
const RestartIcon = () => <Icon><path d="M12 5a7 7 0 1 1-6.93 8h2.03A5 5 0 1 0 12 7v3L7.5 6 12 2v3z" /></Icon>;
const VolumeIcon = () => <Icon><path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.4 3.67A1 1 0 0 0 14 18.4V5.6a1 1 0 0 0-1.6-.78L8 8.5H5a1 1 0 0 0-1 1z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></Icon>;
const MutedIcon = () => <Icon><path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.4 3.67A1 1 0 0 0 14 18.4V5.6a1 1 0 0 0-1.6-.78L8 8.5H5a1 1 0 0 0-1 1z" /><path d="M17 9.5l4 5m0-5l-4 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></Icon>;

// Remote control for the screens: pause/resume, skip, restart, volume, mute.
// Applies to every connected screen at once.
// hideWhenIdle: render nothing (instead of a "nothing playing" line) when idle.
export default function PlaybackControls({ refreshKey, hideWhenIdle = false }) {
  const { isAdmin } = useAuth();
  const [state, setState] = useState(null);
  const [volume, setVolume] = useState(100);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const volumeTimer = useRef(null);
  const messageTimer = useRef(null);
  const draggingVolume = useRef(false);

  const applyResponse = useCallback((data) => {
    setState(data);
    if (!draggingVolume.current) setVolume(data.volume);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await playbackApi.get();
      applyResponse(res.data.data);
    } catch (err) {
      // Keep the last known state; the next poll will retry
    }
  }, [applyResponse]);

  useEffect(() => {
    load();
    // Light polling so changes from another window show up here too
    const interval = setInterval(load, 5000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, [load, refreshKey]);

  useEffect(() => () => {
    clearTimeout(volumeTimer.current);
    clearTimeout(messageTimer.current);
  }, []);

  async function send(action, extra) {
    setBusy(true);
    setError('');
    try {
      const res = await playbackApi.control(action, extra);
      applyResponse(res.data.data);
      // Confirmation fades away after a few seconds
      setMessage(res.data.message);
      clearTimeout(messageTimer.current);
      messageTimer.current = setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reach the screens');
    } finally {
      setBusy(false);
    }
  }

  // Send volume shortly after the slider stops moving (not on every pixel)
  function onVolumeChange(e) {
    const value = Number(e.target.value);
    setVolume(value);
    draggingVolume.current = true;
    clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => {
      draggingVolume.current = false;
      send('volume', { volume: value });
    }, 300);
  }

  if (!state) return null;

  const playing = Boolean(state.playlist);

  if (!playing) {
    if (hideWhenIdle) return null;
    return (
      <p className="empty-state player-idle">
        Nothing is playing. Click <strong>Sync to TVs</strong> on a playlist to start.
      </p>
    );
  }

  const silent = state.muted || volume === 0;

  return (
    <div className={`player-bar ${state.paused ? 'is-paused' : 'is-playing'}`}>
      <div className="player-info">
        <span className="player-eq" aria-hidden="true">
          <span /><span /><span />
        </span>
        <div className="player-text">
          <span className="player-label">
            {state.paused ? 'Paused' : 'Now playing'} · all screens
          </span>
          <strong className="player-title" title={state.playlist.name}>
            {state.playlist.name}
          </strong>
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="player-controls">
            <button type="button" className="player-btn" disabled={busy} onClick={() => send('previous')} title="Previous item" aria-label="Previous item">
              <PrevIcon />
            </button>
            {state.paused ? (
              <button type="button" className="player-btn player-btn-main" disabled={busy} onClick={() => send('resume')} title="Resume" aria-label="Resume">
                <PlayIcon />
              </button>
            ) : (
              <button type="button" className="player-btn player-btn-main" disabled={busy} onClick={() => send('pause')} title="Pause" aria-label="Pause">
                <PauseIcon />
              </button>
            )}
            <button type="button" className="player-btn" disabled={busy} onClick={() => send('next')} title="Next item" aria-label="Next item">
              <NextIcon />
            </button>
            <button type="button" className="player-btn" disabled={busy} onClick={() => send('restart')} title="Restart from the first item" aria-label="Restart from the first item">
              <RestartIcon />
            </button>
          </div>

          <div
            className="player-volume"
            title={'Screens started with launch-tv.bat play sound by themselves; others need one click on the screen.'}
          >
            <button
              type="button"
              className="player-btn"
              disabled={busy}
              onClick={() => send(state.muted ? 'unmute' : 'mute')}
              title={state.muted ? 'Unmute' : 'Mute'}
              aria-label={state.muted ? 'Unmute' : 'Mute'}
            >
              {silent ? <MutedIcon /> : <VolumeIcon />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={onVolumeChange}
              aria-label="Volume"
              // Fills the track up to the thumb
              style={{ '--fill': `${state.muted ? 0 : volume}%` }}
              className={state.muted ? 'is-muted' : ''}
            />
            <span className="player-volume-value">{state.muted ? 'Muted' : `${volume}%`}</span>
          </div>
        </>
      )}

      {(error || message) && (
        <p className={`player-status ${error ? 'is-error' : ''}`} role="status">
          {error || message}
        </p>
      )}
    </div>
  );
}
