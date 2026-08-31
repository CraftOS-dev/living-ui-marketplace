import React, { useRef } from 'react';
import { useResume } from '../../context/ResumeContext';
import { Upload, Trash2, Image as ImageIcon } from 'lucide-react';

export const PersonalForm: React.FC = () => {
  const { resume, updatePersonal } = useResume();
  const { personal } = resume;
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64Url = event.target?.result as string;
        if (base64Url) {
          updatePersonal({ photoUrl: base64Url });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="form-section">
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
        Personal & Contact Information
      </h3>

      <div className="form-group">
        <label className="form-label">Full Name</label>
        <input 
          type="text" 
          className="form-control" 
          value={personal.fullName} 
          onChange={(e) => updatePersonal({ fullName: e.target.value })}
          placeholder="e.g. Alex River"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Job Title / Headline</label>
        <input 
          type="text" 
          className="form-control" 
          value={personal.jobTitle} 
          onChange={(e) => updatePersonal({ jobTitle: e.target.value })}
          placeholder="e.g. Senior Software Architect"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="form-group">
          <label className="form-label">Email Address</label>
          <input 
            type="email" 
            className="form-control" 
            value={personal.email} 
            onChange={(e) => updatePersonal({ email: e.target.value })}
            placeholder="alex@example.com"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Phone Number</label>
          <input 
            type="text" 
            className="form-control" 
            value={personal.phone} 
            onChange={(e) => updatePersonal({ phone: e.target.value })}
            placeholder="+1 (512) 555-0199"
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Location</label>
        <input 
          type="text" 
          className="form-control" 
          value={personal.location} 
          onChange={(e) => updatePersonal({ location: e.target.value })}
          placeholder="San Francisco, CA"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        <div className="form-group">
          <label className="form-label">LinkedIn URL</label>
          <input 
            type="text" 
            className="form-control" 
            value={personal.linkedin || ''} 
            onChange={(e) => updatePersonal({ linkedin: e.target.value })}
            placeholder="linkedin.com/in/alex"
          />
        </div>

        <div className="form-group">
          <label className="form-label">GitHub URL</label>
          <input 
            type="text" 
            className="form-control" 
            value={personal.github || ''} 
            onChange={(e) => updatePersonal({ github: e.target.value })}
            placeholder="github.com/alex"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Portfolio Website</label>
          <input 
            type="text" 
            className="form-control" 
            value={personal.website || ''} 
            onChange={(e) => updatePersonal({ website: e.target.value })}
            placeholder="alexriver.dev"
          />
        </div>
      </div>

      {/* Profile Photo Upload Section */}
      <div className="form-group">
        <label className="form-label">Profile Photo</label>
        <input 
          type="file" 
          ref={photoInputRef}
          onChange={handleImageFileChange}
          accept="image/*"
          style={{ display: 'none' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          {personal.photoUrl ? (
            <img 
              src={personal.photoUrl} 
              alt="Avatar preview" 
              style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--accent-primary)' }}
            />
          ) : (
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--bg-card)', border: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ImageIcon size={20} color="var(--text-muted)" />
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              type="button" 
              className="btn btn-secondary btn-sm"
              onClick={() => photoInputRef.current?.click()}
            >
              <Upload size={14} />
              <span>Upload Image File</span>
            </button>

            {personal.photoUrl && (
              <button 
                type="button" 
                className="btn btn-outline btn-sm"
                onClick={() => updatePersonal({ photoUrl: '' })}
                style={{ color: '#ef4444', borderColor: 'transparent' }}
                title="Remove photo"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        <input 
          type="text" 
          className="form-control" 
          value={personal.photoUrl || ''} 
          onChange={(e) => updatePersonal({ photoUrl: e.target.value })}
          placeholder="Or paste image URL (https://...)"
          style={{ fontSize: '0.8rem' }}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Professional Summary</label>
        <textarea 
          className="form-control" 
          value={personal.summary} 
          onChange={(e) => updatePersonal({ summary: e.target.value })}
          placeholder="Write 2-4 sentences highlighting key achievements, value prop & years experience..."
          rows={4}
        />
      </div>
    </div>
  );
};
