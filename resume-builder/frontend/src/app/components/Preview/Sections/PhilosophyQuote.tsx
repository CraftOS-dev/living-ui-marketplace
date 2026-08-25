import React from 'react';
import { PhilosophyItem } from '../../../types/resume';

export const PhilosophyQuote: React.FC<{ philosophy: PhilosophyItem; accentColor: string }> = ({ philosophy, accentColor }) => {
  if (!philosophy || !philosophy.quote) return null;

  return (
    <div 
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        backgroundColor: 'rgba(99, 102, 241, 0.05)',
        borderLeft: `4px solid ${accentColor}`,
        marginTop: '10px',
        marginBottom: '14px',
        position: 'relative',
        breakInside: 'avoid',
        pageBreakInside: 'avoid'
      }}
    >
      <div style={{ fontStyle: 'italic', fontSize: '0.825rem', color: '#1e293b', lineHeight: 1.4 }}>
        "{philosophy.quote}"
      </div>
      {philosophy.author && (
        <div style={{ fontWeight: 700, fontSize: '0.75rem', color: accentColor, textAlign: 'right', marginTop: '4px' }}>
          — {philosophy.author}
        </div>
      )}
    </div>
  );
};

