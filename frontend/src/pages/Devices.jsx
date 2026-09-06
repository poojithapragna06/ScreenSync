import React, { useEffect, useState, useCallback } from 'react';
import { deviceApi } from '../services/api';
import { createAdminSocket } from '../services/websocket';
import { useAuth } from '../context/AuthContext';

function timeAgo(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ago`;
}

export default function Devices() {
  const { token } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await deviceApi.list();
    setDevices(res.data.data.devices);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  if (loading) return <div className="page-loading">Loading devices...</div>;

  return (
    <div className="page">
      <h1>Device Monitoring</h1>
      <table className="data-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Network</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last Heartbeat</th>
            <th>Last Sync</th>
            <th>Current Content</th>
          </tr>
        </thead>
        <tbody>
          {devices.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-state">
                No devices registered yet.
              </td>
            </tr>
          )}
          {devices.map((device) => (
            <tr key={device.device_id}>
              <td>{device.device_id}</td>
              <td>{device.network}</td>
              <td>{device.role}</td>
              <td>
                <span className={`status-dot ${device.status === 'online' ? 'dot-online' : 'dot-offline'}`} />
                {device.status === 'online' ? 'Online' : 'Offline'}
              </td>
              <td>{timeAgo(device.last_heartbeat)}</td>
              <td>{device.last_sync ? timeAgo(device.last_sync) : 'never'}</td>
              <td>
                {device.current_content
                  ? `${device.current_content.type}${
                      device.current_content.name ? `: ${device.current_content.name}` : ''
                    }`
                  : 'idle'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
