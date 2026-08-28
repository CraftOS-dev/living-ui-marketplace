import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';
import { Mail, Phone, MapPin, Globe, Linkedin, Github } from 'lucide-react';

export const ModernSplit: React.FC = () => {
  const { resume, updatePersonal, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#6366f1';
  const photoInputRef = React.useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          updatePersonal({ photoUrl: evt.target.result as string });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: '1123px', height: '100%' }}>
      {/* Left Sidebar (260px) */}
      <div 
        style={{ 
          backgroundColor: '#ffffff', 
          borderRight: '1px solid #e2e8f0', 
          padding: '32px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px'
        }}
      >
        {/* Photo Avatar */}
        {sectionVisibility.photo !== false && style.photoShape !== 'hidden' && (
          <div style={{ textAlign: 'center' }}>
            <input 
              type="file" 
              ref={photoInputRef}
              onChange={handlePhotoUpload}
              accept="image/*"
              style={{ display: 'none' }}
            />
            {personal.photoUrl ? (
              <img 
                src={personal.photoUrl} 
                alt={personal.fullName}
                onClick={() => photoInputRef.current?.click()}
                title="Click to upload new photo"
                style={{
                  width: '110px',
                  height: '110px',
                  aspectRatio: '1 / 1',
                  flexShrink: 0,
                  objectFit: 'cover',
                  borderRadius: style.photoShape === 'square' ? '12px' : '50%',
                  border: `3px solid ${accentColor}`,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  cursor: 'pointer'
                }}
              />
            ) : (
              <div 
                onClick={() => photoInputRef.current?.click()}
                title="Click to upload photo"
                style={{
                  width: '110px',
                  height: '110px',
                  borderRadius: style.photoShape === 'square' ? '12px' : '50%',
                  border: `2px dashed ${accentColor}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: accentColor,
                  fontSize: '0.75rem',
                  fontWeight: 600
                }}
              >
                + Photo
              </div>
            )}
          </div>
        )}

        {/* Contact Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.775rem', color: '#475569' }}>
          {personal.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={13} color={accentColor} />
              <a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a>
            </div>
          )}
          {personal.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Phone size={13} color={accentColor} />
              <a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a>
            </div>
          )}
          {personal.location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MapPin size={13} color={accentColor} />
              <span>{personal.location}</span>
            </div>
          )}
          {personal.website && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Globe size={13} color={accentColor} />
              <a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a>
            </div>
          )}
          {personal.linkedin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Linkedin size={13} color={accentColor} />
              <a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a>
            </div>
          )}
          {personal.github && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Github size={13} color={accentColor} />
              <a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a>
            </div>
          )}
        </div>

        {/* My Time Section */}
        {sectionVisibility.myTime && myTime.length > 0 && (
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '8px', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px' }}>
              My Time
            </h4>
            <MyTimeChart items={myTime} accentColor={accentColor} />
          </div>
        )}

        {/* Most Proud Of Section */}
        {sectionVisibility.mostProudOf && mostProudOf.length > 0 && (
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '8px', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px' }}>
              Most Proud Of
            </h4>
            <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
          </div>
        )}

        {/* Philosophy Section */}
        {sectionVisibility.philosophy && philosophy.quote && (
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '8px', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px' }}>
              Philosophy
            </h4>
            <PhilosophyQuote philosophy={philosophy} accentColor={accentColor} />
          </div>
        )}

        {/* Skills Pills */}
        {sectionVisibility.skills && skills.length > 0 && (
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '8px', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px' }}>
              Core Skills
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {skills.map((sk) => (
                <span 
                  key={sk.id}
                  style={{
                    fontSize: '0.725rem',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    color: accentColor,
                    border: `1px solid rgba(99, 102, 241, 0.2)`
                  }}
                >
                  {sk.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Main Content (1fr) */}
      <div style={{ padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Name & Title Header */}
        <div style={{ borderBottom: `3px solid ${accentColor}`, paddingBottom: '16px' }}>
          <h1 
            style={{ fontSize: '2.2rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
          >
            {personal.fullName}
          </h1>
          <h2 
            style={{ fontSize: '1.15rem', fontWeight: 600, color: accentColor, marginTop: '6px' }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
          >
            {personal.jobTitle}
          </h2>
        </div>

        {/* Dynamic Section Ordering */}
        {sectionOrder.map((sectionKey) => {
          if (!sectionVisibility[sectionKey as keyof typeof sectionVisibility]) return null;

          if (sectionKey === 'summary' && personal.summary) {
            return (
              <div key="summary">
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '8px' }}>
                  Summary
                </h3>
                  <p 
                    style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)' }}
                    contentEditable 
                    suppressContentEditableWarning 
                    onBlur={(e) => updateInlineField('personal.summary', e.currentTarget.innerText)}
                  >
                    {personal.summary}
                  </p>
              </div>
            );
          }

          if (sectionKey === 'experience' && experiences.length > 0) {
            return (
              <div key="experience">
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '12px' }}>
                  Work Experience
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {experiences.map((exp) => (
                    <div key={exp.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span 
                          style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}
                          contentEditable 
                          suppressContentEditableWarning 
                          onBlur={(e) => updateInlineField(`experience.${exp.id}.position`, e.currentTarget.innerText)}
                        >
                          {exp.position}
                        </span>
                        <span style={{ fontSize: '0.775rem', color: '#64748b', fontWeight: 600 }}>
                          {exp.startDate} – {exp.endDate}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.825rem', fontWeight: 600, color: accentColor, marginBottom: '6px' }}>
                        {exp.company} {exp.location ? `• ${exp.location}` : ''}
                      </div>
                      <div 
                        style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line' }}
                        contentEditable 
                        suppressContentEditableWarning 
                        onBlur={(e) => updateInlineField(`experience.${exp.id}.description`, e.currentTarget.innerText)}
                      >
                        {exp.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          if (sectionKey === 'projects' && projects.length > 0) {
            return (
              <div key="projects">
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '10px' }}>
                  Projects & Accomplishments
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {projects.map((proj) => (
                    <div key={proj.id}>
                      <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>
                        {proj.link ? (
                        <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a>
                      ) : (
                        proj.title
                      )} {proj.technologies && <span style={{ fontWeight: 400, fontSize: '0.775rem', color: '#64748b' }}>({proj.technologies})</span>}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#334155', marginTop: '2px' }}>
                        {proj.description}
                      </div>
                      {proj.link && (
                        <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                          <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{proj.link}</a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          if (sectionKey === 'education' && educations.length > 0) {
            return (
              <div key="education">
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '10px' }}>
                  Education
                </h3>
                {educations.map((edu) => (
                  <div key={edu.id} style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>{edu.degree}</span>
                      <span style={{ fontSize: '0.775rem', color: '#64748b' }}>{edu.startDate} – {edu.endDate}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: accentColor }}>
                      {edu.institution} {edu.gpa ? `• ${edu.gpa}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            );
          }

          if (sectionKey === 'certifications' && certifications && certifications.length > 0) {
            return (
              <div key="certifications">
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '10px' }}>
                  Certifications & Licenses
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {certifications.map((cert) => (
                    <div key={cert.id} style={{ fontSize: '0.825rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div>
                          <strong style={{ color: '#0f172a' }}>
                            {cert.url ? (
                              <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{cert.name}</a>
                            ) : (
                              cert.name
                            )}
                          </strong>
                          {cert.issuer && <span style={{ color: '#475569', marginLeft: '6px' }}>— {cert.issuer}</span>}
                        </div>
                        {cert.issueDate && <div style={{ color: '#64748b', fontWeight: 600 }}>{cert.issueDate}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          if (sectionKey === 'publications' && publications.length > 0) {
            return (
              <div key="publications">
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, marginBottom: '10px' }}>
                  Publications & Research
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {publications.map((pub) => (
                    <div key={pub.id} style={{ fontSize: '0.825rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div>
                          <strong style={{ color: '#0f172a' }}>
                            {pub.url ? (
                              <a href={formatHref(pub.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{pub.title}</a>
                            ) : (
                              pub.title
                            )}
                          </strong>
                          {pub.publisher && <span style={{ color: '#475569', marginLeft: '6px' }}>— {pub.publisher}</span>}
                        </div>
                        {pub.date && <div style={{ color: '#64748b', fontWeight: 600 }}>{pub.date}</div>}
                      </div>
                      {pub.description && <div style={{ color: '#334155', marginTop: '2px' }}>{pub.description}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
};
