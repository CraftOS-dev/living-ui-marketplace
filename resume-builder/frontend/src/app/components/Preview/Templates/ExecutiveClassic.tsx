import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';

export const ExecutiveClassic: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#334155';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <h3 style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Executive Summary
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)' }}>{personal.summary}</p>
          </div>
        ) : null;

      case 'experience':
        return sectionVisibility.experience && experiences.length > 0 ? (
          <div key="experience">
            <h3 style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '12px' }}>
              Leadership & Experience
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {experiences.map(exp => (
                <div key={exp.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '0.925rem', color: '#0f172a' }}>
                    <span>{exp.position} — <span style={{ color: accentColor }}>{exp.company}</span></span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{exp.startDate} – {exp.endDate}</span>
                  </div>
                  <div style={{ fontSize: '0.825rem', color: '#334155', marginTop: '6px', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line' }}>{exp.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, color: accentColor, borderBottom: `1px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Time & Energy Focus
            </h3>
            <MyTimeChart items={myTime} accentColor={accentColor} />
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, color: accentColor, borderBottom: `1px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Key Accomplishments
            </h3>
            <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
          </div>
        ) : null;

      case 'philosophy':
        return sectionVisibility.philosophy && philosophy.quote ? (
          <div key="philosophy">
            <PhilosophyQuote philosophy={philosophy} accentColor={accentColor} />
          </div>
        ) : null;

      case 'education':
        return sectionVisibility.education && educations.length > 0 ? (
          <div key="education">
            <h3 style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Education & Academic Background
            </h3>
            {educations.map(edu => (
              <div key={edu.id} style={{ fontSize: '0.85rem', marginBottom: '6px' }}>
                <strong>{edu.degree}</strong>, {edu.institution} ({edu.startDate} – {edu.endDate})
              </div>
            ))}
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Portfolio Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ fontSize: '0.85rem' }}>
                  <strong style={{ color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}: </strong>
                  <span>{proj.description}</span>
                  {proj.technologies && <span style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}> ({proj.technologies})</span>}
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
            <h3 style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Certifications & Credentials
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ fontSize: '0.85rem' }}>
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
            <h3 style={{ fontFamily: 'inherit', fontSize: '1rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Core Competencies & Skills
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem', color: '#334155' }}>
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
    <div style={{ padding: '40px', minHeight: '1123px', fontFamily: 'inherit' }}>
      {/* Centered Serif Header */}
      <div style={{ textAlign: 'center', borderBottom: `2px double ${accentColor}`, paddingBottom: '20px', marginBottom: '28px' }}>
        {sectionVisibility.photo !== false && style.photoShape !== 'hidden' && personal.photoUrl && (
          <div style={{ marginBottom: '12px' }}>
            <img 
              src={personal.photoUrl} 
              alt={personal.fullName}
              style={{
                width: '85px',
                height: '85px',
                aspectRatio: '1 / 1',
                flexShrink: 0,
                borderRadius: style.photoShape === 'square' ? '12px' : '50%',
                border: `2px solid ${accentColor}`,
                objectFit: 'cover'
              }}
            />
          </div>
        )}
        <h1 
          style={{ fontSize: '2.6rem', fontWeight: 700, color: '#0f172a', letterSpacing: '0.02em' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>
        <h2 
          style={{ fontSize: '1.2rem', fontStyle: 'italic', color: accentColor, marginTop: '4px' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
        >
          {personal.jobTitle}
        </h2>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '0.8rem', color: '#475569', marginTop: '12px', fontFamily: 'inherit' }}>
          {personal.email && <span><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></span>}
          {personal.phone && <span><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></span>}
          {personal.location && <span>{personal.location}</span>}
          {personal.linkedin && <span><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></span>}
          {personal.github && <span><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></span>}
          {personal.website && <span><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></span>}
        </div>
      </div>

      {/* Main Single Column Flow mapped to sectionOrder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', fontFamily: 'inherit' }}>
        {sectionOrder.map(key => renderSection(key))}
      </div>
    </div>
  );
};
