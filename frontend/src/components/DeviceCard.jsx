import React from 'react';

function timeAgo(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ago`;
}

export default function DeviceCard({ device }) {
  const isOnline = device.status === 'online';

  return (
    <div className={`device-card ${isOnline ? 'online' : 'offline'}`}>
      <div className="device-card-header">
        <span className={`status-dot ${isOnline ? 'dot-online' : 'dot-offline'}`} />
        <span className="device-id">{device.device_id}</span>
      </div>
      <div className="device-card-body">
        <div className="device-row">
          <span className="label">Network</span>
          <span>{device.network}</span>
        </div>
        <div className="device-row">
          <span className="label">Role</span>
          <span>{device.role}</span>
        </div>
        <div className="device-row">
          <span className="label">Status</span>
          <span>{isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div className="device-row">
          <span className="label">Last Heartbeat</span>
          <span>{timeAgo(device.last_heartbeat)}</span>
        </div>
        <div className="device-row">
          <span className="label">Last Sync</span>
          <span>{device.last_sync ? timeAgo(device.last_sync) : 'never'}</span>
        </div>
        <div className="device-row">
          <span className="label">Current Content</span>
          <span>
            {device.current_content
              ? `${device.current_content.type}${
                  device.current_content.name ? `: ${device.current_content.name}` : ''
                }`
              : 'idle'}
          </span>
        </div>
      </div>
    </div>
  );
}
