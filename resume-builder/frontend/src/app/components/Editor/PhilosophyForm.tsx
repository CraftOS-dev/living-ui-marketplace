import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { Quote } from 'lucide-react';

export const PhilosophyForm: React.FC = () => {
  const { resume, updatePhilosophy } = useResume();
  const { philosophy } = resume;

  return (
    <div className="form-section">
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Quote size={18} color="var(--accent-primary)" />
        Work Philosophy & Personal Quote
      </h3>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
        Share your core work guiding principle or favorite professional quote.
      </p>

      <div className="form-group">
        <label className="form-label">Quote / Philosophy Statement</label>
        <textarea 
          className="form-control"
          rows={4}
          value={philosophy.quote}
          onChange={(e) => updatePhilosophy(e.target.value, philosophy.author)}
          placeholder="e.g. Simplicity is prerequisite for reliability. Great frontend software hides immense complexity..."
        />
      </div>

      <div className="form-group">
        <label className="form-label">Author / Attributed Name</label>
        <input 
          type="text" 
          className="form-control"
          value={philosophy.author}
          onChange={(e) => updatePhilosophy(philosophy.quote, e.target.value)}
          placeholder="Alex River"
        />
      </div>
    </div>
  );
};
