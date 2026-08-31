import React, { useState } from 'react';
import { useResume } from '../../context/ResumeContext';
import { Plus, Trash2 } from 'lucide-react';

export const SkillsForm: React.FC = () => {
  const { resume, addSkill, updateSkill, removeSkill } = useResume();
  const { skills } = resume;
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillCat, setNewSkillCat] = useState('Programming Languages');

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSkillName.trim()) {
      addSkill(newSkillName.trim(), newSkillCat);
      setNewSkillName('');
    }
  };

  return (
    <div className="form-section">
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
        Skills & Core Competencies
      </h3>

      <form onSubmit={handleQuickAdd} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input 
          type="text" 
          className="form-control"
          placeholder="Add a skill (e.g. React, Python)"
          value={newSkillName}
          onChange={(e) => setNewSkillName(e.target.value)}
        />
        <select 
          className="select-input" 
          value={newSkillCat}
          onChange={(e) => setNewSkillCat(e.target.value)}
        >
          <option value="Programming Languages">Programming Languages</option>
          <option value="Technical Skills">Technical Skills</option>
          <option value="Programs & Tools">Programs & Tools</option>
          <option value="Interpersonal Skills">Interpersonal Skills</option>
        </select>
        <button type="submit" className="btn btn-primary btn-sm">
          <Plus size={14} />
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {skills.map(sk => (
          <div 
            key={sk.id} 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '8px 12px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)'
            }}
          >
            <input 
              type="text" 
              className="form-control" 
              style={{ flex: 1, padding: '4px 8px' }}
              value={sk.name}
              onChange={(e) => updateSkill(sk.id, { name: e.target.value })}
            />
            <input 
              type="text" 
              className="form-control" 
              style={{ width: '110px', padding: '4px 8px' }}
              value={sk.category || ''}
              onChange={(e) => updateSkill(sk.id, { category: e.target.value })}
              placeholder="Category"
            />
            <select 
              className="select-input"
              style={{ padding: '4px 8px', fontSize: '0.8rem' }}
              value={sk.proficiency || 'Advanced'}
              onChange={(e) => updateSkill(sk.id, { proficiency: e.target.value as any })}
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
              <option value="Expert">Expert</option>
            </select>
            <button 
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => removeSkill(sk.id)}
              style={{ padding: '4px 6px', color: '#ef4444', borderColor: 'transparent' }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
// skill by Aima