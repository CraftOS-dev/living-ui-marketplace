import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { getProficiencyDots } from '../../../utils/proficiencyHelper';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';

export const BoxedManager: React.FC = () => {
  const { resume, updatePersonal, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#0f172a';
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
            <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Time Breakdown
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

      case 'certifications':
        return sectionVisibility.certifications && certifications && certifications.length > 0 ? (
          <div key="certifications">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Certifications & Licenses
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ fontFamily: 'inherit', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'publications':
        return sectionVisibility.publications && publications && publications.length > 0 ? (
          <div key="publications">
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: accentColor, borderBottom: '1px solid #cbd5e1', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Publications & Research
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {publications.map(pub => (
                <div key={pub.id} style={{ fontFamily: 'inherit', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a' }}>
                    {pub.url ? (
                      <a href={formatHref(pub.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{pub.title}</a>
                    ) : (
                      pub.title
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {pub.publisher} {pub.date ? `(${pub.date})` : ''}
                  </div>
                  {pub.description && <div style={{ fontSize: '0.775rem', color: '#334155', marginTop: '2px' }}>{pub.description}</div>}
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
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 210px) minmax(0, 1fr)', minHeight: '1123px', color: '#1e293b', backgroundColor: '#ffffff', fontFamily: 'inherit', boxSizing: 'border-box' }}>
      {/* Left Sidebar Column */}
      <div style={{ backgroundColor: '#f8fafc', padding: '20px 20px 36px 20px', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '22px', fontFamily: 'inherit' }}>
        {/* Photo Avatar at Top Left */}
        {sectionVisibility.photo !== false && style.photoShape !== 'hidden' && (
          <div style={{ textAlign: 'center', marginTop: '36px', marginBottom: '16px' }}>
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
                title="Click to upload photo"
                style={{
                  width: '115px',
                  height: '115px',
                  objectFit: 'cover',
                  borderRadius: style.photoShape === 'square' ? '12px' : '50%',
                  border: `3px solid ${accentColor}`,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  cursor: 'pointer',
                  margin: '0 auto'
                }}
              />
            ) : null}
          </div>
        )}

        {/* Details Section */}
        <div>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, borderBottom: '1.5px solid #0f172a', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
            Details
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.75rem', color: '#334155' }}>
            {personal.location && (
              <div>
                <strong style={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', color: '#64748b' }}>Address</strong>
                <span>{personal.location}</span>
              </div>
            )}
            {personal.phone && (
              <div>
                <strong style={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', color: '#64748b' }}>Phone</strong>
                <a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a>
              </div>
            )}
            {personal.email && (
              <div>
                <strong style={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', color: '#64748b' }}>Email</strong>
                <a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none', wordBreak: 'break-all' }}>{personal.email}</a>
              </div>
            )}
            {personal.linkedin && (
              <div>
                <strong style={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', color: '#64748b' }}>LinkedIn</strong>
                <a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline', wordBreak: 'break-all' }}>{personal.linkedin}</a>
              </div>
            )}
            {personal.github && (
              <div>
                <strong style={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', color: '#64748b' }}>GitHub</strong>
                <a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline', wordBreak: 'break-all' }}>{personal.github}</a>
              </div>
            )}
            {personal.website && (
              <div>
                <strong style={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', color: '#64748b' }}>Portfolio</strong>
                <a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline', wordBreak: 'break-all' }}>{personal.website}</a>
              </div>
            )}
          </div>
        </div>

        {/* Skills Section with Dynamic 5-dot rating indicators */}
        {sectionVisibility.skills && skills.length > 0 && (
          <div>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: accentColor, borderBottom: '1.5px solid #0f172a', paddingBottom: '3px', marginBottom: '10px', fontFamily: 'inherit' }}>
              Skills
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {Object.entries(
                skills.reduce((acc, sk) => {
                  const cat = sk.category && sk.category.trim() ? sk.category.trim() : 'General';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(sk);
                  return acc;
                }, {} as Record<string, typeof skills>)
              ).map(([catName, catSkills], idx, arr) => (
                <div key={catName}>
                  {(arr.length > 1 || catName !== 'General') && (
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', marginBottom: '4px' }}>
                      {catName}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {catSkills.map((sk) => (
                      <div key={sk.id} style={{ fontSize: '0.75rem' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '2px' }}>{sk.name}</div>
                        <div style={{ color: accentColor, fontSize: '0.75rem', letterSpacing: '2px' }}>
                          {getProficiencyDots(sk.proficiency)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Main Column */}
      <div style={{ padding: '20px 32px 36px 32px', display: 'flex', flexDirection: 'column', gap: '22px', fontFamily: 'inherit' }}>
        {/* Prominent Boxed Framed Header */}
        <div style={{ border: '2px solid #0f172a', padding: '24px 20px', textAlign: 'center', marginBottom: '8px' }}>
          <h1 
            style={{ fontSize: '2.2rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0f172a', lineHeight: 1.1, fontFamily: 'inherit' }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
          >
            {personal.fullName}
          </h1>
          <h2 
            style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#475569', marginTop: '6px', fontFamily: 'inherit' }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
          >
            {personal.jobTitle}
          </h2>
        </div>

        {/* Dynamic section order mapping */}
        {sectionOrder.map(key => renderSection(key))}
      </div>
    </div>
  );
};
