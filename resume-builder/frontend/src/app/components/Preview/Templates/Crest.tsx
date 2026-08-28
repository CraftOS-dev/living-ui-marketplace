import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';

export const Crest: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#1e293b';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary" style={{ maxWidth: '88%', margin: '0 auto 12px auto', textAlign: 'center' }}>
            <p 
              style={{ fontSize: '0.9rem', fontStyle: 'italic', color: '#334155', lineHeight: 'var(--resume-line-height, 1.65)', fontFamily: 'inherit' }}
              contentEditable 
              suppressContentEditableWarning 
              onBlur={(e) => updateInlineField('personal.summary', e.currentTarget.innerText)}
            >
              "{personal.summary}"
            </p>
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '10px' }}>
              Key Achievements
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {mostProudOf.map(item => (
                <div key={item.id} style={{ fontSize: '0.825rem', color: '#334155', fontFamily: 'inherit' }}>
                  <strong style={{ color: '#0f172a', fontFamily: 'inherit', fontSize: '0.875rem' }}>{item.title}: </strong>
                  <span>{item.description}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'experience':
        return sectionVisibility.experience && experiences.length > 0 ? (
          <div key="experience">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px' }}>
              Experience
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {experiences.map(exp => (
                <div key={exp.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'inherit', fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>{exp.position}</span>
                    <span style={{ fontSize: '0.775rem', color: '#64748b' }}>{exp.startDate} – {exp.endDate}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', fontStyle: 'italic', color: accentColor, marginBottom: '6px' }}>
                    {exp.company} {exp.location ? `• ${exp.location}` : ''}
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

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Key Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: 'inherit' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ fontSize: '0.825rem', color: '#334155', fontFamily: 'inherit' }}>
                  <strong style={{ color: '#0f172a', fontFamily: 'inherit', fontSize: '0.875rem' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}: </strong>
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
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Certifications & Licenses
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'inherit' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ fontSize: '0.825rem', color: '#334155', fontFamily: 'inherit' }}>
                  <strong style={{ color: '#0f172a', fontFamily: 'inherit', fontSize: '0.875rem' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}: </strong>
                  <span>{cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'education':
        return sectionVisibility.education && educations.length > 0 ? (
          <div key="education">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Education
            </h3>
            {educations.map(edu => (
              <div key={edu.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '6px', fontFamily: 'inherit' }}>
                <div>
                  <strong style={{ fontFamily: 'inherit', color: '#0f172a' }}>{edu.degree}</strong>, {edu.institution}
                </div>
                <div style={{ color: '#64748b' }}>{edu.startDate} – {edu.endDate}</div>
              </div>
            ))}
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Time Allocation
            </h3>
            <MyTimeChart items={myTime} accentColor={accentColor} />
          </div>
        ) : null;

      case 'philosophy':
        return sectionVisibility.philosophy && philosophy.quote ? (
          <div key="philosophy">
            <PhilosophyQuote philosophy={philosophy} accentColor={accentColor} />
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Core Competencies
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem', color: '#334155', fontFamily: 'inherit' }}>
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
    <div style={{ padding: '44px 36px', minHeight: '1123px', color: '#1e293b', fontFamily: 'inherit' }}>
      {/* High-End Serif Centered Header */}
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h1 
          style={{ fontSize: '3rem', fontWeight: 500, letterSpacing: '0.04em', color: '#0f172a', lineHeight: 1.1, fontFamily: 'inherit' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>

        <div style={{ borderTop: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '6px 0', margin: '12px auto', maxWidth: '90%' }}>
          <h2 
            style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.15em', color: accentColor, fontFamily: 'inherit' }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
          >
            {personal.jobTitle}
          </h2>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '12px', fontSize: '0.775rem', color: '#64748b', fontFamily: 'inherit' }}>
          {personal.phone && <span><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></span>}
          {personal.email && <span><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></span>}
          {personal.location && <span>{personal.location}</span>}
          {personal.linkedin && <span><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></span>}
          {personal.github && <span><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></span>}
          {personal.website && <span><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></span>}
        </div>
      </div>

      {/* Main Single Column Sections mapped to sectionOrder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'inherit' }}>
        {sectionOrder.map(key => renderSection(key))}
      </div>
    </div>
  );
};
