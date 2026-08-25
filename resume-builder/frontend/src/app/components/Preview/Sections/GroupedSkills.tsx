import React from 'react';
import { Skill } from '../../../types/resume';

interface GroupedSkillsProps {
  skills: Skill[];
  accentColor: string;
  badgeBg?: string;
  badgeColor?: string;
  badgeBorder?: string;
}

export const GroupedSkills: React.FC<GroupedSkillsProps> = ({
  skills,
  accentColor,
  badgeBg = '#f1f5f9',
  badgeColor = '#0f172a',
  badgeBorder = '#cbd5e1'
}) => {
  if (!skills || skills.length === 0) return null;

  // Group skills by category
  const categoriesMap: Record<string, Skill[]> = {};
  skills.forEach(sk => {
    const cat = sk.category && sk.category.trim() ? sk.category.trim() : 'Technical Skills';
    if (!categoriesMap[cat]) categoriesMap[cat] = [];
    categoriesMap[cat].push(sk);
  });

  const categoryNames = Object.keys(categoriesMap);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {categoryNames.map(catName => (
        <div key={catName} className="skill-category-block" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <div style={{ fontSize: '0.775rem', fontWeight: 700, color: accentColor, marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {catName}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {categoriesMap[catName].map(sk => (
              <span 
                key={sk.id} 
                style={{ 
                  fontSize: '0.75rem', 
                  fontWeight: 600, 
                  padding: '3px 8px', 
                  borderRadius: '4px', 
                  backgroundColor: badgeBg, 
                  color: badgeColor, 
                  border: `1px solid ${badgeBorder}` 
                }}
              >
                {sk.name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
