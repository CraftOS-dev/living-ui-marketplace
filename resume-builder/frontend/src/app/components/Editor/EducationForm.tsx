import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { Plus, Trash2 } from 'lucide-react';

export const EducationForm: React.FC = () => {
  const { resume, addEducation, updateEducation, removeEducation } = useResume();
  const { educations } = resume;

  return (
    <div className="form-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Education & Degrees
        </h3>
        <button className="btn btn-primary btn-sm" onClick={addEducation}>
          <Plus size={14} />
          <span>Add Degree</span>
        </button>
      </div>

      {educations.map((edu) => (
        <div key={edu.id} className="form-card">
          <div className="form-card-header">
            <span className="form-card-title">{edu.institution || 'University Name'}</span>
            <button 
              className="btn btn-outline btn-sm" 
              onClick={() => removeEducation(edu.id)}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Degree / Qualification</label>
            <input 
              type="text" 
              className="form-control" 
              value={edu.degree}
              onChange={(e) => updateEducation(edu.id, { degree: e.target.value })}
              placeholder="B.S. in Computer Science"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Institution / School</label>
            <input 
              type="text" 
              className="form-control" 
              value={edu.institution}
              onChange={(e) => updateEducation(edu.id, { institution: e.target.value })}
              placeholder="Stanford University"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <label className="form-label">Start Year</label>
              <input 
                type="text" 
                className="form-control" 
                value={edu.startDate}
                onChange={(e) => updateEducation(edu.id, { startDate: e.target.value })}
                placeholder="2018"
              />
            </div>
            <div>
              <label className="form-label">End Year</label>
              <input 
                type="text" 
                className="form-control" 
                value={edu.endDate}
                onChange={(e) => updateEducation(edu.id, { endDate: e.target.value })}
                placeholder="2022"
              />
            </div>
            <div>
              <label className="form-label">GPA / Honors</label>
              <input 
                type="text" 
                className="form-control" 
                value={edu.gpa || ''}
                onChange={(e) => updateEducation(edu.id, { gpa: e.target.value })}
                placeholder="3.9 GPA"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
