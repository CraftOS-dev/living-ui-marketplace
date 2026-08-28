import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';

export const Collegiate: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#334155';

  const bannerBg = '#e2e8f0'; // Solid grey banner card fill matching Collegiate template

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
                PROFESSIONAL SUMMARY
              </h3>
            </div>
            <p 
              style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)', paddingLeft: '8px', fontFamily: 'inherit' }}
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
            <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
                EMPLOYMENT HISTORY
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingLeft: '8px' }}>
              {experiences.map(exp => (
                <div key={exp.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '16px', fontFamily: 'inherit' }}>
                  <div style={{ fontSize: '0.775rem', fontWeight: 700, color: '#0f172a' }}>
                    <div>{exp.startDate} – {exp.endDate}</div>
                    {exp.location && <div style={{ fontWeight: 500, color: '#64748b' }}>{exp.location}</div>}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.875rem', color: '#0f172a' }}>
                      {exp.position}, <span style={{ color: accentColor }}>{exp.company}</span>
                    </div>
                    <div 
                      style={{ fontSize: '0.825rem', color: '#334155', marginTop: '4px', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line', fontFamily: 'inherit' }}
                      contentEditable 
                      suppressContentEditableWarning 
                      onBlur={(e) => updateInlineField(`experience.${exp.id}.description`, e.currentTarget.innerText)}
                    >
                      {exp.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'education':
        return sectionVisibility.education && educations.length > 0 ? (
          <div key="education">
            <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
                EDUCATION
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingLeft: '8px' }}>
              {educations.map(edu => (
                <div key={edu.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '16px', fontSize: '0.825rem', fontFamily: 'inherit' }}>
                  <div style={{ fontSize: '0.775rem', fontWeight: 700, color: '#0f172a' }}>
                    {edu.startDate} – {edu.endDate}
                  </div>
                  <div style={{ color: '#334155' }}>
                    <strong style={{ color: '#0f172a' }}>{edu.degree}</strong> • {edu.institution}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
                HONORS & ACHIEVEMENTS
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '8px' }}>
              {mostProudOf.map(item => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '16px', fontSize: '0.825rem', fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.775rem', color: '#0f172a' }}>{item.title}</div>
                  <div style={{ color: '#334155' }}>{item.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
                TIME BREAKDOWN
              </h3>
            </div>
            <div style={{ paddingLeft: '8px' }}>
              <MyTimeChart items={myTime} accentColor={accentColor} />
            </div>
          </div>
        ) : null;

      case 'philosophy':
        return sectionVisibility.philosophy && philosophy.quote ? (
          <div key="philosophy">
            <PhilosophyQuote philosophy={philosophy} accentColor={accentColor} />
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
                PORTFOLIO PROJECTS
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '8px' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '16px', fontSize: '0.825rem', fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.775rem', color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}</div>
                  <div style={{ color: '#334155' }}>
                    <div>{proj.description}</div>
                    {proj.technologies && <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>Tech: {proj.technologies}</div>}
                  {proj.link && (
                    <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                      <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{proj.link}</a>
                    </div>
                  )}
                  </div>
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
            <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
                CERTIFICATIONS & LICENSES
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '8px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '16px', fontSize: '0.825rem', fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.775rem', color: '#0f172a' }}>{cert.issueDate || 'Cert'}</div>
                  <div style={{ color: '#334155' }}>
                    <strong style={{ color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</strong> — {cert.issuer}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
                SKILLS & COMPETENCIES
              </h3>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingLeft: '8px', fontSize: '0.8rem', fontFamily: 'inherit' }}>
              {skills.map(sk => (
                <span key={sk.id} style={{ fontSize: '0.775rem', fontWeight: 600, padding: '2px 8px', borderRadius: '2px', backgroundColor: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1' }}>
                  {sk.name}
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
      {/* Top Header: Large Bold Title on Top Left */}
      <div style={{ marginBottom: '24px' }}>
        <h1 
          style={{ fontSize: '2.8rem', fontWeight: 900, textTransform: 'uppercase', color: '#0f172a', letterSpacing: '0.04em', lineHeight: 1.1, fontFamily: 'inherit' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>
        <h2 
          style={{ fontSize: '1rem', fontWeight: 700, textTransform: 'uppercase', color: accentColor, marginTop: '4px', letterSpacing: '0.08em', fontFamily: 'inherit' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
        >
          {personal.jobTitle}
        </h2>
      </div>

      {/* INFO Banner & Contact Details */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ backgroundColor: bannerBg, padding: '6px 12px', borderRadius: '2px', marginBottom: '10px' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', margin: 0, fontFamily: 'inherit' }}>
            INFO
          </h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 16px', fontSize: '0.8rem', color: '#334155', paddingLeft: '8px', fontFamily: 'inherit' }}>
          {personal.location && (
            <>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>Address:</div>
              <div>{personal.location}</div>
            </>
          )}
          {personal.phone && (
            <>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>Phone:</div>
              <div><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></div>
            </>
          )}
          {personal.email && (
            <>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>Email:</div>
              <div><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></div>
            </>
          )}
          {personal.linkedin && (
            <>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>LinkedIn:</div>
              <div><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></div>
            </>
          )}
          {personal.github && (
            <>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>GitHub:</div>
              <div><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></div>
            </>
          )}
          {personal.website && (
            <>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>Portfolio:</div>
              <div><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></div>
            </>
          )}
        </div>
      </div>

      {/* Main Flow Framed by Grey Banner Section Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'inherit' }}>
        {sectionOrder.map(key => renderSection(key))}
      </div>
    </div>
  );
};
