import React from 'react';
import type { MyTimeItem } from '../../../types/resume';

export const MyTimeChart: React.FC<{ items: MyTimeItem[]; accentColor: string }> = ({ items, accentColor }) => {
  if (!items || items.length === 0) return null;

  return (
    <div className="mytime-bar-wrapper" style={{ marginTop: '12px', marginBottom: '16px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      {/* Horizontal Stacked Percentage Bar */}
      <div className="mytime-bar">
        {items.map((item) => (
          <div
            key={item.id}
            className="mytime-bar-segment"
            style={{
              width: `${item.percentage}%`,
              backgroundColor: item.color || accentColor,
            }}
            title={`${item.label}: ${item.percentage}%`}
          />
        ))}
      </div>

      {/* Grid Legend */}
      <div className="mytime-legend">
        {items.map((item) => (
          <div key={item.id} className="mytime-legend-item">
            <span
              className="mytime-dot"
              style={{ backgroundColor: item.color || accentColor }}
            />
            <span style={{ fontWeight: 600, color: '#334155', fontSize: '0.75rem' }}>
              {item.percentage}% {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
