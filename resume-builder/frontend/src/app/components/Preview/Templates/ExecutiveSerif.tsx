import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { formatHref } from '../../../utils/linkUtils';
import { getProficiencyDots } from '../../../utils/proficiencyHelper';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';

export const ExecutiveSerif: React.FC = () => {
  const { resume, updatePersonal, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#b91c1c'; // Crimson Serif Accent
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

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', marginBottom: '8px', fontFamily: 'inherit' }}>
              Profile
            </h3>
            <p 
              style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.6)', fontFamily: 'inherit' }}
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
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', marginBottom: '12px', fontFamily: 'inherit' }}>
              Employment History
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {experiences.map(exp => (
                <div key={exp.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>
                    {exp.position}, <span style={{ color: accentColor }}>{exp.company}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', fontStyle: 'italic', color: '#64748b', marginBottom: '4px' }}>
                    {exp.startDate} — {exp.endDate} {exp.location ? `, ${exp.location}` : ''}
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
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              Education
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {educations.map(edu => (
                <div key={edu.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>
                    {edu.institution}, {edu.degree}
                  </div>
                  <div style={{ fontSize: '0.75rem', fontStyle: 'italic', color: '#64748b' }}>
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
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              Key Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#334155' }}>{proj.description}</div>
                  {proj.technologies && <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>{proj.technologies}</div>}
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
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', marginBottom: '10px', fontFamily: 'inherit' }}>
              Certifications & Licenses
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</div>
                  <div style={{ fontSize: '0.75rem', fontStyle: 'italic', color: '#64748b' }}>
                    {cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h3 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', marginBottom: '12px', fontFamily: 'inherit' }}>
              Skills
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {skills.map(sk => (
                <div key={sk.id} style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', fontSize: '0.775rem', color: '#334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{sk.name}</span>
                  <span style={{ color: accentColor, letterSpacing: '1px', fontSize: '0.75rem' }}>{getProficiencyDots(sk.proficiency)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', marginBottom: '12px', fontFamily: 'inherit' }}>
              Time Allocation
            </h3>
            <MyTimeChart items={myTime} accentColor={accentColor} />
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#0f172a', marginBottom: '12px', fontFamily: 'inherit' }}>
              Accomplishments
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

      default:
        return null;
    }
  };

  const leftKeys = ['summary', 'experience', 'education', 'projects', 'certifications', 'publications'];
  const rightKeys = ['skills', 'myTime', 'mostProudOf', 'philosophy'];

  return (
    <div style={{ padding: '20px 40px 40px 40px', minHeight: '1123px', color: '#1e293b', backgroundColor: '#ffffff', fontFamily: 'inherit' }}>
      {/* Top Header: Photo + Crimson Serif Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', borderBottom: '1px solid #e2e8f0', paddingBottom: '20px', marginBottom: '24px' }}>
        {sectionVisibility.photo !== false && style.photoShape !== 'hidden' && (
          <div>
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
                alt="Profile Avatar"
                onClick={() => photoInputRef.current?.click()}
                title="Click to upload photo"
                style={{ 
                  width: '80px', 
                  height: '80px', 
                  aspectRatio: '1 / 1',
                  flexShrink: 0,
                  objectFit: 'cover',
                  borderRadius: style.photoShape === 'round' ? '50%' : '4px',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer'
                }}
              />
            ) : null}
          </div>
        )}

        <div>
          <h1 
            style={{ fontSize: '2.2rem', fontWeight: 600, color: accentColor, lineHeight: 1.1, fontFamily: 'inherit' }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
          >
            {personal.fullName}, {personal.jobTitle}
          </h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.775rem', color: '#64748b', marginTop: '4px', fontFamily: 'inherit' }}>
            {personal.location && <span>{personal.location}</span>}
            {personal.phone && <span><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></span>}
            {personal.email && <span><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></span>}
            {personal.linkedin && <span><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></span>}
            {personal.github && <span><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></span>}
            {personal.website && <span><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></span>}
          </div>
        </div>
      </div>

      {/* 2-Column Split: Main Content Left (minmax), Sidebar Right (Wider 230px) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 230px)', gap: '24px', fontFamily: 'inherit' }}>
        {/* Left Main Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', fontFamily: 'inherit' }}>
          {sectionOrder.filter(k => leftKeys.includes(k)).map(key => renderSection(key))}
        </div>

        {/* Right Sidebar Column */}
        <div style={{ borderLeft: '1px solid #f1f5f9', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '22px', fontFamily: 'inherit' }}>
          {sectionOrder.filter(k => rightKeys.includes(k)).map(key => renderSection(key))}
        </div>
      </div>
    </div>
  );
};
