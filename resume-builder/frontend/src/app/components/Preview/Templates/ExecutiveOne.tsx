import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { formatHref } from '../../../utils/linkUtils';

export const ExecutiveOne: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, mostProudOf, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#334155';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '8px', fontFamily: 'inherit' }}>
              Profile
            </h3>
            <p 
              style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)', fontFamily: 'inherit' }}
              contentEditable 
              suppressContentEditableWarning 
              onBlur={(e) => updateInlineField('personal.summary', e.currentTarget.innerText)}
            >
              {personal.summary}
            </p>
          </div>
        ) : null;

      case 'experience':
        return sectionVisibility.experience && experiences.length > 0 ? (
          <div key="experience">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '12px', fontFamily: 'inherit' }}>
              Employment History
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {experiences.map(exp => (
                <div key={exp.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.875rem', color: '#0f172a' }}>
                      {exp.position}, {exp.company}
                    </div>
                    {exp.location && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{exp.location}</div>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>
                    {exp.startDate} — {exp.endDate}
                  </div>
                  <div 
                    style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line', fontFamily: 'inherit' }}
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
        ) : null;

      case 'education':
        return sectionVisibility.education && educations.length > 0 ? (
          <div key="education">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Education
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {educations.map(edu => (
                <div key={edu.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
                      {edu.degree}, {edu.institution}
                    </div>
                    {edu.fieldOfStudy && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{edu.fieldOfStudy}</div>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {edu.startDate} — {edu.endDate}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Achievements
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {mostProudOf.map(item => (
                <div key={item.id} style={{ padding: '8px 10px', borderRadius: '4px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: accentColor }}>{item.title}</div>
                  <div style={{ fontSize: '0.75rem', color: '#475569' }}>{item.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Portfolio Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#334155' }}>{proj.description}</div>
                  {proj.technologies && <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>Tech: {proj.technologies}</div>}
                  {proj.link && (
                    <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                      <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{proj.link}</a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null;

      
      case 'publications':
        return sectionVisibility.publications && publications && publications.length > 0 ? (
          <div key="publications">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Publications & Research
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {publications.map(pub => (
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
        ) : null;

      case 'certifications':
        return sectionVisibility.certifications && certifications && certifications.length > 0 ? (
          <div key="certifications">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Certifications & Licenses
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#334155' }}>{cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Skills
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {skills.map(sk => (
                <div key={sk.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.775rem', color: '#334155' }}>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{sk.name}</span>
                  <span style={{ fontStyle: 'italic', color: '#64748b', fontSize: '0.75rem' }}>{sk.proficiency || 'Advanced'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      default:
        return null;
    }
  };

  return (
    <div style={{ padding: '20px 40px 40px 40px', minHeight: '1123px', color: '#1e293b', backgroundColor: '#ffffff', fontFamily: 'inherit' }}>
      {/* Header: Centered Name & Address Sub-header */}
      <div style={{ textAlign: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '24px' }}>
        <h1 
          style={{ fontSize: '2.4rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0f172a', lineHeight: 1.1, fontFamily: 'inherit' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px', fontSize: '0.8rem', color: '#475569', marginTop: '6px', fontFamily: 'inherit' }}>
          {personal.jobTitle && <span>{personal.jobTitle}</span>}
          {personal.location && <span>{personal.location}</span>}
          {personal.phone && <span><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></span>}
          {personal.email && <span><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></span>}
          {personal.linkedin && <span><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></span>}
          {personal.github && <span><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></span>}
          {personal.website && <span><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></span>}
        </div>
      </div>

      {/* Main Flow mapped to sectionOrder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', fontFamily: 'inherit' }}>
        {sectionOrder.map(key => renderSection(key))}
      </div>
    </div>
  );
};
