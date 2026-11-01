import React from 'react';

// Matches PRIORITY in backend/src/utils/constants.js
export const PRIORITY_LABELS = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Emergency',
};

// "in 12 min", "in 1 h 5 min", "now"
export function timeUntil(date) {
  const minutes = Math.round((new Date(date) - Date.now()) / 60000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
}

export default function AlertBanner({ alert, onClear }) {
  const label = PRIORITY_LABELS[alert.priority] || 'Alert';

  return (
    <div className={`alert-banner alert-banner-priority-${alert.priority}`}>
      <span className="alert-banner-pulse" aria-hidden="true" />
      <div className="alert-banner-body">
        <div className="alert-banner-top">
          <span className="alert-banner-tag">{label}</span>
          <span className="alert-banner-meta" title={new Date(alert.expires).toLocaleString()}>
            On all screens · ends {timeUntil(alert.expires)}
          </span>
        </div>
        <p className="alert-banner-message">{alert.message}</p>
      </div>
      {onClear && (
        <button type="button" className="btn btn-small alert-banner-clear" onClick={() => onClear(alert)}>
          Clear
        </button>
      )}
    </div>
  );
}
