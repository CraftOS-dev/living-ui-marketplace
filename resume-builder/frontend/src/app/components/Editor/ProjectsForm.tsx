import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { Plus, Trash2 } from 'lucide-react';
import { handleBulletKeyDown } from '../../utils/bulletUtils';

export const ProjectsForm: React.FC = () => {
  const { resume, addProject, updateProject, removeProject } = useResume();
  const { projects } = resume;

  return (
    <div className="form-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Portfolio & Side Projects
        </h3>
        <button className="btn btn-primary btn-sm" onClick={addProject}>
          <Plus size={14} />
          <span>Add Project</span>
        </button>
      </div>

      {projects.map((proj) => (
        <div key={proj.id} className="form-card">
          <div className="form-card-header">
            <span className="form-card-title">{proj.title || 'Project Name'}</span>
            <button 
              className="btn btn-outline btn-sm" 
              onClick={() => removeProject(proj.id)}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Project Title</label>
            <input 
              type="text" 
              className="form-control" 
              value={proj.title}
              onChange={(e) => updateProject(proj.id, { title: e.target.value })}
              placeholder="LiveCanvas Engine"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Technologies Used</label>
            <input 
              type="text" 
              className="form-control" 
              value={proj.technologies}
              onChange={(e) => updateProject(proj.id, { technologies: e.target.value })}
              placeholder="TypeScript, WebSockets, React"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Project Link / URL</label>
            <input 
              type="text" 
              className="form-control" 
              value={proj.link || ''}
              onChange={(e) => updateProject(proj.id, { link: e.target.value })}
              placeholder="https://github.com/..."
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label className="form-label">Description</label>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Press Enter for automatic bullets (•)</span>
            </div>
            <textarea 
              className="form-control" 
              rows={2}
              value={proj.description}
              onChange={(e) => updateProject(proj.id, { description: e.target.value })}
              onKeyDown={(e) => handleBulletKeyDown(e, proj.description, (newText) => updateProject(proj.id, { description: newText }))}
              placeholder="Brief description of what this project solved..."
            />
          </div>
        </div>
      ))}
    </div>
  );
};

