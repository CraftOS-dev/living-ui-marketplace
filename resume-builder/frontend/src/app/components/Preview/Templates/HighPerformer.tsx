import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { formatHref } from '../../../utils/linkUtils';
import { Phone, Mail, MapPin, Linkedin, Github, Globe } from 'lucide-react';

export const HighPerformer: React.FC = () => {
  const { resume, updatePersonal, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, style } = resume;
  const accentColor = style.accentColor || '#0f172a';

  return (
    <div style={{ padding: '36px', minHeight: '1123px', color: '#0f172a', backgroundColor: '#ffffff', fontFamily: 'inherit' }}>
      {/* Header Block */}
      <div style={{ borderBottom: `2px solid ${accentColor}`, paddingBottom: '16px', marginBottom: '24px' }}>
        <h1 
          style={{ fontSize: '2.4rem', fontWeight: 900, textTransform: 'uppercase', color: '#0f172a', lineHeight: 1.1 }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>
        <h2 
          style={{ fontSize: '1rem', fontWeight: 700, color: accentColor, marginTop: '4px' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
        >
          {personal.jobTitle}
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.775rem', color: '#64748b', marginTop: '8px', fontWeight: 600 }}>
          {personal.phone && (
            <span>
              <Phone size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a>
            </span>
          )}
          {personal.email && (
            <span>
              <Mail size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a>
            </span>
          )}
          {personal.location && <span><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />{personal.location}</span>}
          {personal.linkedin && (
            <span>
              <Linkedin size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a>
            </span>
          )}
          {personal.github && (
            <span>
              <Github size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a>
            </span>
          )}
          {personal.website && (
            <span>
              <Globe size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a>
            </span>
          )}
        </div>
      </div>

      {/* 2-Column Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '28px' }}>
        {/* Left Column (Experience + Projects Breakdown) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {sectionVisibility.experience && experiences.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '12px' }}>
                Experience
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {experiences.map(exp => (
                  <div key={exp.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span 
                        style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}
                        contentEditable 
                        suppressContentEditableWarning 
                        onBlur={(e) => updateInlineField(`experience.${exp.id}.position`, e.currentTarget.innerText)}
                      >
                        {exp.position}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                        {exp.startDate} – {exp.endDate}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: accentColor, marginBottom: '4px' }}>
                      {exp.company} {exp.location ? `• ${exp.location}` : ''}
                    </div>
                    <div 
                      style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line' }}
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
          )}

          {/* Project Highlights Table Cards */}
          {sectionVisibility.projects && projects.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '10px' }}>
                Project Highlights
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {projects.map(proj => (
                  <div key={proj.id} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '10px', padding: '8px 10px', borderRadius: '4px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.775rem', color: accentColor }}>
                    {proj.link ? (
                      <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a>
                    ) : (
                      proj.title
                    )}
                  </div>
                  {proj.link && (
                    <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.7rem', color: '#64748b', textDecoration: 'underline', wordBreak: 'break-all', display: 'block', marginTop: '2px' }}>
                      {proj.link}
                    </a>
                  )}
                    <div style={{ fontSize: '0.75rem', color: '#475569' }}>{proj.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sectionVisibility.skills && skills.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
                Skills
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {skills.map(sk => (
                  <span key={sk.id} style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 8px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1' }}>
                    {sk.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (Summary & Key Achievements) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {sectionVisibility.summary && personal.summary && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
                Summary
              </h3>
              <p 
                style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)' }}
                contentEditable 
                suppressContentEditableWarning 
                onBlur={(e) => updateInlineField('personal.summary', e.currentTarget.innerText)}
              >
                {personal.summary}
              </p>
            </div>
          )}

          {sectionVisibility.mostProudOf && mostProudOf.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
                Key Achievements
              </h3>
              <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
            </div>
          )}

          {sectionVisibility.education && educations.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
                Education
              </h3>
              {educations.map(edu => (
                <div key={edu.id} style={{ marginBottom: '8px', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a' }}>{edu.degree}</div>
                  <div style={{ color: accentColor, fontWeight: 600 }}>{edu.institution}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{edu.startDate} – {edu.endDate}</div>
                </div>
              ))}
            </div>
          )}

          {sectionVisibility.certifications && certifications && certifications.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
                Certifications
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {certifications.map(cert => (
                  <div key={cert.id} style={{ fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sectionVisibility.publications && publications && publications.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
                Publications & Research
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {publications.map(pub => (
                  <div key={pub.id} style={{ fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>
                      {pub.url ? (
                        <a href={formatHref(pub.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{pub.title}</a>
                      ) : (
                        pub.title
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{pub.publisher} {pub.date ? `(${pub.date})` : ''}</div>
                    {pub.description && <div style={{ fontSize: '0.775rem', color: '#334155', marginTop: '2px' }}>{pub.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
