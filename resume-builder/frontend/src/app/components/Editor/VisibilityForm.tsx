import React from 'react';
import { useResume } from '../../context/ResumeContext';
import type { SectionKey, SectionVisibility } from '../../types/resume';
import { getTemplateSupportedSections } from '../../utils/templateSections';
import { Eye, EyeOff, ArrowUp, ArrowDown, Hash } from 'lucide-react';

const SECTION_LABELS: Record<SectionKey, string> = {
  summary: 'Summary / Bio',
  experience: 'Work Experience',
  education: 'Education & Degrees',
  skills: 'Skills & Competencies',
  myTime: 'My Time Breakdown',
  mostProudOf: 'Achievements Badges',
  philosophy: 'Work Philosophy & Quote',
  projects: 'Portfolio Projects',
  certifications: 'Certifications',
  publications: 'Publications & Papers'
};

export const VisibilityForm: React.FC = () => {
  const { resume, updateSectionVisibility, updateSectionOrder, updateStyle } = useResume();
  const { sectionVisibility, sectionOrder, style } = resume;
  const supported = getTemplateSupportedSections(style.templateId);

  const toggleVisibility = (key: keyof SectionVisibility) => {
    updateSectionVisibility(key, !sectionVisibility[key]);
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...sectionOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < newOrder.length) {
      const a = newOrder[index];
      const b = newOrder[targetIndex];
      if (a && b) {
        newOrder[index] = b;
        newOrder[targetIndex] = a;
        updateSectionOrder(newOrder);
      }
    }
  };

  return (
    <div className="form-section">
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
        Section Visibility & Reordering
      </h3>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
        Show, hide, or rearrange sections on your live resume canvas.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sectionOrder.map((key, idx) => {
          const isSupportedInTemplate = supported[key as SectionKey] !== false;
          const isVisible = (sectionVisibility[key as keyof SectionVisibility] !== false) && isSupportedInTemplate;

          return (
            <div 
              key={key} 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                opacity: isVisible ? 1 : 0.5
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{SECTION_LABELS[key] || key}</span>
                {!isSupportedInTemplate && (
                  <span style={{ fontSize: '0.7rem', color: '#ef4444', fontStyle: 'italic' }}>
                    (Omitted in template)
                  </span>
                )}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  className="btn btn-outline btn-sm"
                  style={{ padding: '4px' }}
                  disabled={idx === 0}
                  onClick={() => moveSection(idx, 'up')}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  style={{ padding: '4px' }}
                  disabled={idx === sectionOrder.length - 1}
                  onClick={() => moveSection(idx, 'down')}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  className={`btn ${isVisible ? 'btn-secondary' : 'btn-outline'} btn-sm`}
                  style={{ padding: '4px 8px' }}
                  onClick={() => toggleVisibility(key as keyof SectionVisibility)}
                  title={isVisible ? 'Hide Section' : 'Show Section'}
                >
                  {isVisible ? <Eye size={14} color="#10b981" /> : <EyeOff size={14} color="#ef4444" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
