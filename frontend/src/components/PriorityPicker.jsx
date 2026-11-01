import React from 'react';
import { PRIORITY_LABELS } from './AlertBanner';

// Coloured Low / Medium / High / Emergency chips (radio buttons underneath)
export default function PriorityPicker({ name, value, onChange, order = [1, 2, 3, 4] }) {
  return (
    <div className="chip-group" role="radiogroup" aria-label="Priority">
      {order.map((p) => (
        <label key={p} className={`chip chip-priority-${p} ${Number(value) === p ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value={p}
            checked={Number(value) === p}
            onChange={() => onChange(p)}
          />
          {PRIORITY_LABELS[p]}
        </label>
      ))}
    </div>
  );
}
