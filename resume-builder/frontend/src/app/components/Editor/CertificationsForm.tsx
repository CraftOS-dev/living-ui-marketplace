import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { Plus, Trash2 } from 'lucide-react';

export const CertificationsForm: React.FC = () => {
  const { resume, addCertification, updateCertification, removeCertification } = useResume();
  const { certifications } = resume;

  return (
    <div className="form-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Certifications & Licenses
        </h3>
        <button className="btn btn-primary btn-sm" onClick={addCertification}>
          <Plus size={14} />
          <span>Add Cert</span>
        </button>
      </div>

      {(!certifications || certifications.length === 0) && (
        <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', fontStyle: 'italic', margin: '12px 0' }}>
          No certifications added yet. Click "+ Add Cert" to add professional certificates.
        </p>
      )}

      {(certifications || []).map((cert) => (
        <div key={cert.id} className="form-card">
          <div className="form-card-header">
            <span className="form-card-title">{cert.name || 'Certification Name'}</span>
            <button 
              className="btn btn-outline btn-sm" 
              onClick={() => removeCertification(cert.id)}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Certification Name</label>
            <input 
              type="text" 
              className="form-control" 
              value={cert.name}
              onChange={(e) => updateCertification(cert.id, { name: e.target.value })}
              placeholder="AWS Certified Solutions Architect"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Issuer / Authority</label>
            <input 
              type="text" 
              className="form-control" 
              value={cert.issuer}
              onChange={(e) => updateCertification(cert.id, { issuer: e.target.value })}
              placeholder="Amazon Web Services"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Issue Date / Year</label>
            <input 
              type="text" 
              className="form-control" 
              value={cert.issueDate}
              onChange={(e) => updateCertification(cert.id, { issueDate: e.target.value })}
              placeholder="2024"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Credential URL / ID (Optional)</label>
            <input 
              type="text" 
              className="form-control" 
              value={cert.url || ''}
              onChange={(e) => updateCertification(cert.id, { url: e.target.value })}
              placeholder="https://credly.com/..."
            />
          </div>
        </div>
      ))}
    </div>
  );
};
