import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { getProficiencyDots } from '../../../utils/proficiencyHelper';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';

export const DataTimeline: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#334155';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '-30px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: accentColor, border: '2px solid #ffffff' }} />
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', marginBottom: '6px', fontFamily: 'inherit' }}>
              PROFILE
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
          <div key="experience" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '-30px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: accentColor, border: '2px solid #ffffff' }} />
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', marginBottom: '12px', fontFamily: 'inherit' }}>
              EMPLOYMENT HISTORY
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {experiences.map(exp => (
                <div key={exp.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.875rem', color: '#0f172a' }}>
                    {exp.position} <span style={{ fontWeight: 500, color: '#64748b' }}>at {exp.company}</span>
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
          <div key="education" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '-30px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: accentColor, border: '2px solid #ffffff' }} />
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              EDUCATION
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {educations.map(edu => (
                <div key={edu.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
                    {edu.degree}, {edu.institution}
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
          <div key="mostProudOf" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '-30px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: accentColor, border: '2px solid #ffffff' }} />
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              KEY ACHIEVEMENTS
            </h3>
            <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '-30px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: accentColor, border: '2px solid #ffffff' }} />
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              TIME BREAKDOWN
            </h3>
            <MyTimeChart items={myTime} accentColor={accentColor} />
          </div>
        ) : null;

      case 'philosophy':
        return sectionVisibility.philosophy && philosophy.quote ? (
          <div key="philosophy" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '-30px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: accentColor, border: '2px solid #ffffff' }} />
            <PhilosophyQuote philosophy={philosophy} accentColor={accentColor} />
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '-30px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: accentColor, border: '2px solid #ffffff' }} />
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              PORTFOLIO PROJECTS
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
          <div key="certifications" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '-30px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: accentColor, border: '2px solid #ffffff' }} />
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              CERTIFICATIONS & LICENSES
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}</div>
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
      {/* Top Header: Centered Avatar + Uppercase Title */}
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        {sectionVisibility.photo && style.photoShape !== 'hidden' && (
          <img 
            src={personal.photoUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=250'} 
            alt="Avatar"
            style={{ 
              width: '68px', 
              height: '68px', 
              aspectRatio: '1 / 1',
              flexShrink: 0,
              objectFit: 'cover',
              borderRadius: style.photoShape === 'round' ? '50%' : '6px',
              marginBottom: '10px'
            }}
          />
        )}
        <h1 
          style={{ fontSize: '2.4rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0f172a', lineHeight: 1.1, fontFamily: 'inherit' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>
        <div style={{ fontSize: '0.775rem', color: '#64748b', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'inherit' }}>
          {[personal.jobTitle, personal.location, personal.phone].filter(Boolean).join('   ')}
        </div>
      </div>

      {/* 2-Column Split: Left Sidebar (180px), Right Timeline Track (minmax) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 180px) minmax(0, 1fr)', gap: '24px', fontFamily: 'inherit' }}>
        {/* Left Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', fontFamily: 'inherit' }}>
          {/* Details */}
          <div>
            <h3 style={{ fontSize: '0.775rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', textAlign: 'center', marginBottom: '8px', fontFamily: 'inherit' }}>
              DETAILS
            </h3>
            <div style={{ fontSize: '0.75rem', color: '#475569', textAlign: 'center', lineHeight: 1.5 }}>
              {personal.location && <div>{personal.location}</div>}
              {personal.phone && <div><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></div>}
              {personal.email && <div style={{ wordBreak: 'break-all' }}><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></div>}
              {personal.linkedin && <div style={{ wordBreak: 'break-all' }}><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></div>}
              {personal.github && <div style={{ wordBreak: 'break-all' }}><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></div>}
              {personal.website && <div style={{ wordBreak: 'break-all' }}><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></div>}
            </div>
          </div>

          {/* Skills with Solid Line Underlines & Dynamic Dots */}
          {sectionVisibility.skills && skills.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.775rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', textAlign: 'center', marginBottom: '10px', fontFamily: 'inherit' }}>
                • SKILLS •
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {skills.map(sk => (
                  <div key={sk.id} style={{ borderBottom: '2px solid #0f172a', paddingBottom: '3px', fontSize: '0.75rem', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#0f172a' }}>
                    <span>{sk.name}</span>
                    <span style={{ letterSpacing: '1px', fontSize: '0.7rem', color: accentColor }}>{getProficiencyDots(sk.proficiency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Main Column with Connected Vertical Timeline Track */}
        <div style={{ position: 'relative', paddingLeft: '24px', borderLeft: '2px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'inherit' }}>
          {sectionOrder.map(key => renderSection(key))}
        </div>
      </div>
    </div>
  );
};
