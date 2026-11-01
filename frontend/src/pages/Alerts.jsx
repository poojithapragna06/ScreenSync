import React, { useEffect, useState, useCallback } from 'react';
import { alertApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import AlertBanner, { PRIORITY_LABELS } from '../components/AlertBanner';
import PriorityPicker from '../components/PriorityPicker';

export default function Alerts() {
  const { isAdmin } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState(4);
  const [minutes, setMinutes] = useState(15);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await alertApi.listAll();
    setAlerts(res.data.data.alerts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePush(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const expires = new Date(Date.now() + Number(minutes) * 60 * 1000).toISOString();
      await alertApi.push({ message, priority: Number(priority), expires });
      setMessage('');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to push alert');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClear(alert) {
    try {
      await alertApi.clear(alert._id);
    } catch (err) {
      window.alert(err.response?.data?.message || 'Failed to clear alert');
    }
    load();
  }

  async function handleDelete(alert) {
    if (!window.confirm(`Delete this alert from history?\n\n"${alert.message}"`)) return;
    try {
      await alertApi.remove(alert._id);
    } catch (err) {
      // 404 = already deleted elsewhere; the reload below fixes the list
      if (err.response?.status !== 404) {
        window.alert(err.response?.data?.message || 'Failed to delete alert');
      }
    }
    load();
  }

  async function handleClearHistory() {
    if (!window.confirm('Delete ALL past alerts (cleared and expired)? Active alerts are kept.')) return;
    try {
      await alertApi.clearHistory();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Failed to clear history');
    }
    load();
  }

  if (loading) return <div className="page-loading">Loading alerts...</div>;

  const now = new Date();
  const isActive = (a) => a.active && new Date(a.expires) > now;
  // Same order the screens use: highest priority first, then newest
  const activeAlerts = alerts
    .filter(isActive)
    .sort((a, b) => b.priority - a.priority || new Date(b.createdAt) - new Date(a.createdAt));
  const pastAlerts = alerts.filter((a) => !isActive(a));

  return (
    <div className="page">
      <h1>Alerts</h1>

      {isAdmin && (
        <form className={`card alert-form alert-form-priority-${priority}`} onSubmit={handlePush}>
          <div className="alert-form-fields">
            <h3>Push an alert</h3>
            {error && <div className="form-error">{error}</div>}

            <label htmlFor="alert-message">Message</label>
            <textarea
              id="alert-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              maxLength={1000}
              placeholder="e.g. Fire drill in progress — please leave the building by the nearest exit."
            />

            <label>Priority</label>
            <PriorityPicker name="alert-priority" value={priority} onChange={setPriority} order={[4, 3, 2, 1]} />

            <label htmlFor="alert-minutes">Show for</label>
            <div className="chip-group">
              {[5, 15, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip ${Number(minutes) === m ? 'is-selected' : ''}`}
                  onClick={() => setMinutes(m)}
                >
                  {m < 60 ? `${m} min` : '1 hour'}
                </button>
              ))}
              <span className="chip-input">
                <input
                  id="alert-minutes"
                  type="number"
                  min="1"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  required
                  aria-label="Minutes"
                />
                min
              </span>
            </div>

            <button
              type="submit"
              className={`btn btn-push btn-push-priority-${priority}`}
              disabled={submitting}
            >
              {submitting ? 'Pushing...' : `Push ${PRIORITY_LABELS[priority].toLowerCase()} alert to all screens`}
            </button>
          </div>

          {/* What the TVs will show (same colours as the TV alert screen) */}
          <div className="alert-preview" aria-hidden="true">
            <span className="alert-preview-caption">Preview on screens</span>
            <div className={`alert-preview-screen priority-${priority}`}>
              <span className="alert-preview-tag">{PRIORITY_LABELS[priority].toUpperCase()}</span>
              <span className="alert-preview-text">{message || 'Your message appears here'}</span>
            </div>
          </div>
        </form>
      )}

      <section>
        <h2>Active Alerts</h2>
        <p className="section-hint">
          Screens show all active alerts together, highest priority at the top (newest first within the same priority).
        </p>
        {activeAlerts.length === 0 && <p className="empty-state">No active alerts — screens are showing their normal content.</p>}
        {activeAlerts.map((alert) => (
          <AlertBanner key={alert.alert_id} alert={alert} onClear={isAdmin ? handleClear : null} />
        ))}
      </section>

      <section>
        <div className="page-header">
          <h2>Alert History</h2>
          {isAdmin && pastAlerts.length > 0 && (
            <button type="button" className="btn btn-danger btn-small" onClick={handleClearHistory}>
              Clear history
            </button>
          )}
        </div>
        {pastAlerts.length === 0 ? (
          <p className="empty-state">No past alerts.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Message</th>
                <th>Priority</th>
                <th>Pushed At</th>
                <th>Expires</th>
                <th>Status</th>
                {isAdmin && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {pastAlerts.map((alert) => (
                <tr key={alert.alert_id}>
                  <td>{alert.message}</td>
                  <td>
                    <span className={`badge badge-priority-${alert.priority}`}>
                      {PRIORITY_LABELS[alert.priority] || alert.priority}
                    </span>
                  </td>
                  <td>{new Date(alert.createdAt).toLocaleString()}</td>
                  <td>{new Date(alert.expires).toLocaleString()}</td>
                  <td>
                    <span className={`status-pill ${alert.active ? 'is-expired' : 'is-cleared'}`}>
                      {alert.active ? 'Expired' : 'Cleared'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <button type="button" className="btn btn-danger btn-small" onClick={() => handleDelete(alert)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
