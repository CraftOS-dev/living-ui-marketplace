import React from 'react';
import { MostProudOfItem } from '../../../types/resume';
import { Trophy, Rocket, Target, Star, Award, Zap, Heart, Flame } from 'lucide-react';

const ICON_MAP = {
  trophy: Trophy,
  rocket: Rocket,
  target: Target,
  star: Star,
  award: Award,
  zap: Zap,
  heart: Heart,
  flame: Flame,
};

export const MostProudOfBadges: React.FC<{ items: MostProudOfItem[]; accentColor: string }> = ({ items, accentColor }) => {
  if (!items || items.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
      {items.map((item) => {
        const IconComponent = ICON_MAP[item.icon] || Trophy;
        return (
          <div 
            key={item.id} 
            className="badge-card"
            style={{ '--resume-accent': accentColor, breakInside: 'avoid', pageBreakInside: 'avoid' } as React.CSSProperties}
          >
            <div className="badge-icon" style={{ backgroundColor: accentColor }}>
              <IconComponent size={14} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.825rem', color: '#0f172a' }}>
                {item.title}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '2px', lineHeight: 1.3 }}>
                {item.description}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
