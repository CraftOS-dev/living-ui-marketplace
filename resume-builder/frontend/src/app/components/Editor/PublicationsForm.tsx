import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { Plus, Trash2 } from 'lucide-react';

export const PublicationsForm: React.FC = () => {
  const { resume, addPublication, updatePublication, removePublication } = useResume();
  const { publications } = resume;

  return (
    <div className="form-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Publications & Research
        </h3>
        <button className="btn btn-primary btn-sm" onClick={addPublication}>
          <Plus size={14} />
          <span>Add Paper</span>
        </button>
      </div>

      {(!publications || publications.length === 0) && (
        <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', fontStyle: 'italic', margin: '12px 0' }}>
          No publications added yet. Click "+ Add Paper" to add published papers or research articles.
        </p>
      )}

      {(publications || []).map((pub) => (
        <div key={pub.id} className="form-card">
          <div className="form-card-header">
            <span className="form-card-title">{pub.title || 'Publication Title'}</span>
            <button 
              className="btn btn-outline btn-sm" 
              onClick={() => removePublication(pub.id)}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Title</label>
            <input 
              type="text" 
              className="form-control" 
              value={pub.title}
              onChange={(e) => updatePublication(pub.id, { title: e.target.value })}
              placeholder="e.g. Scalable Micro-Frontends Architecture"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Publisher / Journal / Conference</label>
            <input 
              type="text" 
              className="form-control" 
              value={pub.publisher || ''}
              onChange={(e) => updatePublication(pub.id, { publisher: e.target.value })}
              placeholder="e.g. IEEE Software / Nature Tech"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Publication Date / Year</label>
            <input 
              type="text" 
              className="form-control" 
              value={pub.date || ''}
              onChange={(e) => updatePublication(pub.id, { date: e.target.value })}
              placeholder="e.g. 2024"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Article / Paper URL (Optional)</label>
            <input 
              type="text" 
              className="form-control" 
              value={pub.url || ''}
              onChange={(e) => updatePublication(pub.id, { url: e.target.value })}
              placeholder="https://journal.org/paper-123"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description / Abstract (Optional)</label>
            <textarea 
              className="form-control" 
              rows={2}
              value={pub.description || ''}
              onChange={(e) => updatePublication(pub.id, { description: e.target.value })}
              placeholder="Brief summary of findings or contributions..."
            />
          </div>
        </div>
      ))}
    </div>
  );
};
