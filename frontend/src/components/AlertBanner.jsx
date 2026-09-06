import React from 'react';

export default function AlertBanner({ alert, onClear }) {
  return (
    <div className="alert-banner">
      <div className="alert-banner-text">
        <strong>EMERGENCY:</strong> {alert.message}
      </div>
      <div className="alert-banner-meta">
        Expires: {new Date(alert.expires).toLocaleString()}
      </div>
      {onClear && (
        <button type="button" className="btn btn-ghost btn-on-danger" onClick={() => onClear(alert)}>
          Clear
        </button>
      )}
    </div>
  );
}
