import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { Plus, Trash2, Zap } from 'lucide-react';
import { handleBulletKeyDown } from '../../utils/bulletUtils';

const SUGGESTED_VERBS = [
  'Spearheaded', 'Engineered', 'Architected', 'Orchestrated', 'Optimized',
  'Accelerated', 'Redesigned', 'Pioneered', 'Scaled', 'Transformed'
];

export const ExperienceForm: React.FC = () => {
  const { resume, addExperience, updateExperience, removeExperience } = useResume();
  const { experiences } = resume;

  const insertActionVerb = (id: string, verb: string, currentDesc: string) => {
    const desc = currentDesc || '';
    let updated = '';
    if (!desc.trim()) {
      updated = `• ${verb} `;
    } else if (desc.endsWith('\n')) {
      updated = `${desc}• ${verb} `;
    } else {
      updated = `${desc}\n• ${verb} `;
    }
    updateExperience(id, { description: updated });
  };

  return (
    <div className="form-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Work Experience
        </h3>
        <button className="btn btn-primary btn-sm" onClick={addExperience}>
          <Plus size={14} />
          <span>Add Position</span>
        </button>
      </div>

      {experiences.map((exp) => (
        <div key={exp.id} className="form-card">
          <div className="form-card-header">
            <span className="form-card-title">{exp.company || 'Company Name'}</span>
            <button 
              className="btn btn-outline btn-sm" 
              onClick={() => removeExperience(exp.id)}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label className="form-label">Position / Title</label>
              <input 
                type="text" 
                className="form-control" 
                value={exp.position}
                onChange={(e) => updateExperience(exp.id, { position: e.target.value })}
                placeholder="Senior Engineer"
              />
            </div>
            <div>
              <label className="form-label">Company Name</label>
              <input 
                type="text" 
                className="form-control" 
                value={exp.company}
                onChange={(e) => updateExperience(exp.id, { company: e.target.value })}
                placeholder="Acme Corp"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label className="form-label">Start Date</label>
              <input 
                type="text" 
                className="form-control" 
                value={exp.startDate}
                onChange={(e) => updateExperience(exp.id, { startDate: e.target.value })}
                placeholder="Jan 2021"
              />
            </div>
            <div>
              <label className="form-label">End Date</label>
              <input 
                type="text" 
                className="form-control" 
                value={exp.endDate}
                disabled={exp.isCurrent}
                onChange={(e) => updateExperience(exp.id, { endDate: e.target.value })}
                placeholder="Present"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                <input 
                  type="checkbox" 
                  checked={exp.isCurrent} 
                  onChange={(e) => updateExperience(exp.id, { isCurrent: e.target.checked, endDate: e.target.checked ? 'Present' : '' })} 
                />
                <span>Current</span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label className="form-label">Bullet Points & Accomplishments</label>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Press Enter for automatic bullets (•)</span>
            </div>

            {/* Action Verbs Helper */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <Zap size={13} color="#f59e0b" />
              <span style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Action Verbs:</span>
              {SUGGESTED_VERBS.map(verb => (
                <button
                  key={verb}
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                  onClick={() => insertActionVerb(exp.id, verb, exp.description)}
                >
                  +{verb}
                </button>
              ))}
            </div>

            <textarea 
              className="form-control"
              rows={4}
              value={exp.description}
              onChange={(e) => updateExperience(exp.id, { description: e.target.value })}
              onKeyDown={(e) => handleBulletKeyDown(e, exp.description, (newText) => updateExperience(exp.id, { description: newText }))}
              placeholder="• Spearheaded project migration, cutting load times by 40%..."
            />
          </div>
        </div>
      ))}
    </div>
  );
};

