import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { getProficiencyFraction } from '../../../utils/proficiencyHelper';
import { formatHref } from '../../../utils/linkUtils';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';

export const SystemsTech: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#0f172a';

  // Split name into first and last for bold stacked name effect
  const nameParts = personal.fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || 'Dinah';
  const lastName = nameParts.slice(1).join(' ') || 'Tobey';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary" style={{ backgroundColor: '#f1f5f9', padding: '14px 18px', borderRadius: '8px', marginBottom: '4px' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px', fontFamily: 'inherit' }}>
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
            <h3 style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', marginBottom: '12px', fontFamily: 'inherit' }}>
              Employment History
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {experiences.map(exp => (
                <div key={exp.id} style={{ fontFamily: 'inherit' }}>
                  {/* Dark Badge Highlight Line */}
                  <div style={{ backgroundColor: accentColor, color: '#ffffff', padding: '4px 10px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 700, display: 'inline-block', marginBottom: '4px', maxWidth: '100%', wordBreak: 'break-word' }}>
                    {exp.position} at {exp.company}
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>
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
            <h3 style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              Education
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {educations.map(edu => (
                <div key={edu.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ backgroundColor: accentColor, color: '#ffffff', padding: '4px 10px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 700, display: 'inline-block', marginBottom: '4px', maxWidth: '100%', wordBreak: 'break-word' }}>
                    {edu.degree}, {edu.institution}
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                    {edu.startDate} — {edu.endDate}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              Portfolio Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ backgroundColor: accentColor, color: '#ffffff', padding: '4px 10px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 700, display: 'inline-block', marginBottom: '4px', maxWidth: '100%', wordBreak: 'break-word' }}>
                    {proj.link ? (
                      <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: '#ffffff', textDecoration: 'underline' }}>{proj.title}</a>
                    ) : (
                      proj.title
                    )}
                  </div>
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
            <h3 style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              Certifications & Licenses
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ backgroundColor: accentColor, color: '#ffffff', padding: '4px 10px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 700, display: 'inline-block', marginBottom: '4px', maxWidth: '100%', wordBreak: 'break-word' }}>
                    {cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                    {cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              Key Achievements
            </h3>
            <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills" style={{ backgroundColor: '#f1f5f9', padding: '14px', borderRadius: '8px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 900, color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              Skills
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {skills.map(sk => (
                <div key={sk.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted #cbd5e1', paddingBottom: '3px', fontSize: '0.75rem' }}>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{sk.name}</span>
                  <span style={{ color: accentColor, fontWeight: 700 }}>{getProficiencyFraction(sk.proficiency)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
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

      default:
        return null;
    }
  };

  const rightKeys = ['skills'];
  const leftKeys = ['summary', 'experience', 'education', 'projects', 'certifications', 'mostProudOf', 'myTime', 'philosophy', 'publications'];

  return (
    <div style={{ padding: '20px 32px 36px 32px', minHeight: '1123px', color: '#1e293b', backgroundColor: '#ffffff', fontFamily: 'inherit', boxSizing: 'border-box' }}>
      {/* Top Header: Left Info + Huge Right Stacked Name */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)', gap: '20px', alignItems: 'center', marginBottom: '24px' }}>
        {/* Left Column: Photo + Contact Details */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {sectionVisibility.photo && style.photoShape !== 'hidden' && (
            <img 
              src={personal.photoUrl || 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=250'} 
              alt="Avatar"
              style={{ 
                width: '85px', 
                height: '85px', 
                aspectRatio: '1 / 1',
                objectFit: 'cover',
                borderRadius: style.photoShape === 'round' ? '50%' : '8px',
                flexShrink: 0
              }}
            />
          )}
          <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4, wordBreak: 'break-word' }}>
            <strong style={{ display: 'block', color: '#0f172a', fontSize: '0.825rem' }}>{personal.jobTitle}</strong>
            {personal.email && <div><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></div>}
            {personal.phone && <div><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></div>}
            {personal.location && <div>{personal.location}</div>}
            {personal.linkedin && <div><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></div>}
            {personal.github && <div><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></div>}
            {personal.website && <div><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></div>}
          </div>
        </div>

        {/* Right Column: Huge Stacked Bold Name */}
        <div>
          <h1 
            style={{ fontSize: '3rem', fontWeight: 900, color: '#0f172a', lineHeight: 0.95, letterSpacing: '-0.02em', fontFamily: 'inherit' }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
          >
            <div>{firstName}</div>
            <div>{lastName}</div>
          </h1>
        </div>
      </div>

      {/* 2-Column Split: Left Main Flow (minmax), Right Skills Cards (200px) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 200px)', gap: '24px', fontFamily: 'inherit' }}>
        {/* Left Column mapped to sectionOrder */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'inherit' }}>
          {sectionOrder.filter(k => leftKeys.includes(k)).map(key => renderSection(key))}
        </div>

        {/* Right Column mapped to sectionOrder */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontFamily: 'inherit' }}>
          {sectionOrder.filter(k => rightKeys.includes(k)).map(key => renderSection(key))}
        </div>
      </div>
    </div>
  );
};
