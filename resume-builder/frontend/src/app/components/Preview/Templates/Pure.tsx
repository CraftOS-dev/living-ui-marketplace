import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { formatHref } from '../../../utils/linkUtils';

export const Pure: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, mostProudOf, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#0f172a';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <div style={{ borderTop: '1px dotted #94a3b8', borderBottom: '1px dotted #94a3b8', padding: '5px 0', marginBottom: '10px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, margin: 0, fontFamily: 'inherit' }}>
                Professional Summary
              </h3>
            </div>
            <p 
              style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.6)', textAlign: 'justify', fontFamily: 'inherit' }}
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
            <div style={{ borderTop: '1px dotted #94a3b8', borderBottom: '1px dotted #94a3b8', padding: '5px 0', marginBottom: '14px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, margin: 0, fontFamily: 'inherit' }}>
                Employment History
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {experiences.map(exp => (
                <div key={exp.id} style={{ textAlign: 'center', fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>
                    {exp.position}, {exp.company} {exp.location ? `, ${exp.location}` : ''}
                  </div>
                  <div style={{ fontSize: '0.775rem', fontStyle: 'italic', color: '#64748b', marginBottom: '4px' }}>
                    {exp.startDate} – {exp.endDate}
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
            <div style={{ borderTop: '1px dotted #94a3b8', borderBottom: '1px dotted #94a3b8', padding: '5px 0', marginBottom: '10px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, margin: 0, fontFamily: 'inherit' }}>
                Education
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'center' }}>
              {educations.map(edu => (
                <div key={edu.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>
                    {edu.institution}, {edu.degree}
                  </div>
                  <div style={{ fontSize: '0.775rem', fontStyle: 'italic', color: '#64748b' }}>
                    {edu.startDate} – {edu.endDate}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <div style={{ borderTop: '1px dotted #94a3b8', borderBottom: '1px dotted #94a3b8', padding: '5px 0', marginBottom: '10px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, margin: 0, fontFamily: 'inherit' }}>
                Honors & Key Achievements
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center' }}>
              {mostProudOf.map(item => (
                <div key={item.id} style={{ fontSize: '0.825rem', color: '#334155', fontFamily: 'inherit' }}>
                  <strong style={{ color: '#0f172a' }}>{item.title}: </strong>
                  <span>{item.description}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <div style={{ borderTop: '1px dotted #94a3b8', borderBottom: '1px dotted #94a3b8', padding: '5px 0', marginBottom: '10px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, margin: 0, fontFamily: 'inherit' }}>
                Key Projects
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'center' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ fontSize: '0.825rem', color: '#334155', fontFamily: 'inherit' }}>
                  <strong style={{ color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}: </strong>
                  <span>{proj.description}</span>
                  {proj.technologies && <span style={{ color: '#64748b', fontSize: '0.75rem' }}> ({proj.technologies})</span>}{proj.link && <span style={{ marginLeft: '6px' }}><a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, fontSize: '0.75rem', textDecoration: 'underline' }}>{proj.link}</a></span>}
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
            <div style={{ borderTop: '1px dotted #94a3b8', borderBottom: '1px dotted #94a3b8', padding: '5px 0', marginBottom: '10px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, margin: 0, fontFamily: 'inherit' }}>
                Certifications & Credentials
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'center' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ fontSize: '0.825rem', color: '#334155', fontFamily: 'inherit' }}>
                  <strong style={{ color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}: </strong>
                  <span>{cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <div style={{ borderTop: '1px dotted #94a3b8', borderBottom: '1px dotted #94a3b8', padding: '5px 0', marginBottom: '10px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, margin: 0, fontFamily: 'inherit' }}>
                Skills
              </h3>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px', fontSize: '0.825rem', color: '#334155', fontFamily: 'inherit' }}>
              {skills.map((sk, idx) => (
                <span key={sk.id}>
                  {sk.name} {idx < skills.length - 1 ? '•' : ''}
                </span>
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
      {/* Header: Centered Name & Contact Line */}
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h1 
          style={{ fontSize: '2.8rem', fontWeight: 500, letterSpacing: '0.02em', color: '#0f172a', lineHeight: 1.1, fontFamily: 'inherit' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>

        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px', fontSize: '0.8rem', color: '#475569', marginTop: '6px', fontFamily: 'inherit' }}>
          {personal.location && <span>{personal.location}</span>}
          {personal.phone && <span><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></span>}
          {personal.email && <span><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></span>}
          {personal.linkedin && <span><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></span>}
          {personal.github && <span><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></span>}
          {personal.website && <span><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></span>}
        </div>
      </div>

      {/* Main Flow with Dotted Dividers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'inherit' }}>
        {sectionOrder.map(key => renderSection(key))}
      </div>
    </div>
  );
};
