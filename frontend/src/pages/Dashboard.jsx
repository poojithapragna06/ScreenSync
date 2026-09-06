import React, { useEffect, useState, useCallback } from 'react';
import { deviceApi, playlistApi, taskApi, alertApi } from '../services/api';
import { createAdminSocket } from '../services/websocket';
import { useAuth } from '../context/AuthContext';
import DeviceCard from '../components/DeviceCard';
import AlertBanner from '../components/AlertBanner';

export default function Dashboard() {
  const { token } = useAuth();
  const [devices, setDevices] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [activeTasks, setActiveTasks] = useState([]);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [devicesRes, playlistsRes, tasksRes, alertsRes] = await Promise.all([
      deviceApi.list(),
      playlistApi.list(),
      taskApi.listActive(),
      alertApi.listActive(),
    ]);
    setDevices(devicesRes.data.data.devices);
    setActivePlaylist(playlistsRes.data.data.playlists.find((p) => p.active) || null);
    setActiveTasks(tasksRes.data.data.tasks);
    setActiveAlerts(alertsRes.data.data.alerts);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!token) return undefined;
    const socket = createAdminSocket({
      token,
      onMessage: (msg) => {
        if (msg.type === 'device_list') {
          setDevices(msg.devices);
        }
      },
    });
    return () => socket.close();
  }, [token]);

  if (loading) {
    return <div className="page-loading">Loading dashboard...</div>;
  }

  const onlineCount = devices.filter((d) => d.status === 'online').length;

  return (
    <div className="page">
      <h1>Dashboard</h1>

      {activeAlerts.map((alert) => (
        <AlertBanner key={alert.alert_id} alert={alert} />
      ))}

      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-value">{devices.length}</span>
          <span className="stat-label">Connected Displays</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{onlineCount}</span>
          <span className="stat-label">Online</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{activeTasks.length}</span>
          <span className="stat-label">Active Tasks</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{activeAlerts.length}</span>
          <span className="stat-label">Active Alerts</span>
        </div>
      </div>

      <section>
        <h2>Connected Displays</h2>
        <div className="device-grid">
          {devices.length === 0 && <p className="empty-state">No TVs have registered yet.</p>}
          {devices.map((device) => (
            <DeviceCard key={device.device_id} device={device} />
          ))}
        </div>
      </section>

      <section>
        <h2>Current Content</h2>
        {activePlaylist ? (
          <p>
            Playlist: <strong>{activePlaylist.name}</strong> ({activePlaylist.items.length} items)
          </p>
        ) : (
          <p className="empty-state">No playlist is currently active.</p>
        )}
      </section>

      <section>
        <h2>Active Tasks</h2>
        {activeTasks.length === 0 && <p className="empty-state">No active tasks.</p>}
        <ul>
          {activeTasks.map((task) => (
            <li key={task.task_id}>
              [{task.priority}] {task.title}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
