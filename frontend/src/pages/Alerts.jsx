import React, { useEffect, useState, useCallback } from 'react';
import { alertApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import AlertBanner from '../components/AlertBanner';

export default function Alerts() {
  const { isAdmin } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
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
      await alertApi.push({ message, priority: 4, expires });
      setMessage('');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to push alert');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClear(alert) {
    await alertApi.clear(alert._id);
    load();
  }

  if (loading) return <div className="page-loading">Loading alerts...</div>;

  const activeAlerts = alerts.filter((a) => a.active && new Date(a.expires) > new Date());
  const pastAlerts = alerts.filter((a) => !(a.active && new Date(a.expires) > new Date()));

  return (
    <div className="page">
      <h1>Emergency Alerts</h1>

      {isAdmin && (
        <form className="card emergency-form" onSubmit={handlePush}>
          <h3>EMERGENCY ALERT</h3>
          {error && <div className="form-error">{error}</div>}

          <label htmlFor="alert-message">Message</label>
          <textarea
            id="alert-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            placeholder="Enter emergency message to broadcast to all screens..."
          />

          <label htmlFor="alert-minutes">Active for (minutes)</label>
          <input
            id="alert-minutes"
            type="number"
            min="1"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            required
          />

          <button type="submit" className="btn btn-emergency" disabled={submitting}>
            {submitting ? 'Pushing...' : 'PUSH ALERT'}
          </button>
        </form>
      )}

      <section>
        <h2>Active Alerts</h2>
        {activeAlerts.length === 0 && <p className="empty-state">No active alerts.</p>}
        {activeAlerts.map((alert) => (
          <AlertBanner key={alert.alert_id} alert={alert} onClear={isAdmin ? handleClear : null} />
        ))}
      </section>

      <section>
        <h2>Alert History</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Message</th>
              <th>Priority</th>
              <th>Pushed At</th>
              <th>Expires</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pastAlerts.map((alert) => (
              <tr key={alert.alert_id}>
                <td>{alert.message}</td>
                <td>{alert.priority}</td>
                <td>{new Date(alert.createdAt).toLocaleString()}</td>
                <td>{new Date(alert.expires).toLocaleString()}</td>
                <td>{alert.active ? 'Expired' : 'Cleared'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
