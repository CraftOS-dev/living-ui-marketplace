import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { Plus, Trash2, Trophy, Rocket, Target, Star, Award, Zap, Heart, Flame } from 'lucide-react';
import { MostProudOfItem } from '../../types/resume';

const ICONS = [
  { id: 'trophy', label: 'Trophy', Component: Trophy },
  { id: 'rocket', label: 'Rocket', Component: Rocket },
  { id: 'target', label: 'Target', Component: Target },
  { id: 'star', label: 'Star', Component: Star },
  { id: 'award', label: 'Award', Component: Award },
  { id: 'zap', label: 'Zap', Component: Zap },
  { id: 'heart', label: 'Heart', Component: Heart },
  { id: 'flame', label: 'Flame', Component: Flame },
];

export const MostProudOfForm: React.FC = () => {
  const { resume, addMostProudOfItem, updateMostProudOfItem, removeMostProudOfItem } = useResume();
  const { mostProudOf } = resume;

  return (
    <div className="form-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Trophy size={18} color="var(--accent-primary)" />
          Achievements
        </h3>
        <button className="btn btn-primary btn-sm" onClick={addMostProudOfItem}>
          <Plus size={14} />
          <span>Add Highlight</span>
        </button>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
        Highlight major career milestones, metric breakthroughs, or awards in eye-catching icon cards.
      </p>

      {mostProudOf.map((item) => (
        <div key={item.id} className="form-card">
          <div className="form-card-header">
            <span className="form-card-title">{item.title || 'Highlight Title'}</span>
            <button 
              className="btn btn-outline btn-sm" 
              onClick={() => removeMostProudOfItem(item.id)}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Headline / Title</label>
            <input 
              type="text" 
              className="form-control" 
              value={item.title}
              onChange={(e) => updateMostProudOfItem(item.id, { title: e.target.value })}
              placeholder="e.g. 68% Build Time Cut"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description & Impact</label>
            <input 
              type="text" 
              className="form-control" 
              value={item.description}
              onChange={(e) => updateMostProudOfItem(item.id, { description: e.target.value })}
              placeholder="e.g. Saved 450+ engineering hours annually across 8 product teams."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Badge Icon</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {ICONS.map(({ id, Component }) => (
                <button
                  key={id}
                  type="button"
                  className={`btn ${item.icon === id ? 'btn-primary' : 'btn-outline'} btn-sm`}
                  style={{ padding: '6px' }}
                  onClick={() => updateMostProudOfItem(item.id, { icon: id as MostProudOfItem['icon'] })}
                >
                  <Component size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
