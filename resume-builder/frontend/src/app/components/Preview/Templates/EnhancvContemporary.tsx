import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';
import { Phone, Mail, MapPin, Linkedin, Github, Globe } from 'lucide-react';

export const EnhancvContemporary: React.FC = () => {
  const { resume, updatePersonal, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#059669';
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
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Summary
            </h3>
            <p 
              style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)' }}
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
        ) : null;

      case 'education':
        return sectionVisibility.education && educations.length > 0 ? (
          <div key="education">
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
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Key Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ marginBottom: '8px', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}</div>
                  <div style={{ fontSize: '0.775rem', color: '#334155' }}>{proj.description}</div>
                  {proj.technologies && <div style={{ fontSize: '0.725rem', color: '#64748b', fontStyle: 'italic' }}>Tech: {proj.technologies}</div>}
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
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h4 style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '3px', marginBottom: '6px' }}>
              Skills
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {skills.map(sk => (
                <span key={sk.id} style={{ fontSize: '0.725rem', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1' }}>
                  {sk.name}
                </span>
              ))}
            </div>
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h4 style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '3px', marginBottom: '6px' }}>
              Achievements
            </h4>
            <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
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

  const leftKeys = ['skills', 'mostProudOf', 'myTime', 'philosophy', 'publications'];
  const rightKeys = ['summary', 'experience', 'education', 'projects', 'certifications'];

  return (
    <div style={{ padding: '36px', minHeight: '1123px', color: '#0f172a', backgroundColor: '#ffffff', fontFamily: 'inherit' }}>
      {/* 2-Column Grid (Left Contacts + Avatar Sidebar, Right Header & Main Content) */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '28px' }}>
        {/* Left Column (Avatar + Contacts + Sidebar Sections) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Photo Avatar */}
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
                  alt={personal.fullName}
                  onClick={() => photoInputRef.current?.click()}
                  title="Click to upload photo"
                  style={{
                    width: '90px',
                    height: '90px',
                    aspectRatio: '1 / 1',
                    flexShrink: 0,
                    objectFit: 'cover',
                    borderRadius: style.photoShape === 'square' ? '12px' : '50%',
                    border: `3px solid ${accentColor}`,
                    cursor: 'pointer'
                  }}
                />
              ) : null}
            </div>
          )}

          {/* Contacts List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.775rem', color: '#475569', fontWeight: 600 }}>
            <h4 style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '3px', marginBottom: '4px' }}>
              Contacts
            </h4>
            {personal.phone && (
              <div>
                <Phone size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a>
              </div>
            )}
            {personal.email && (
              <div>
                <Mail size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none', wordBreak: 'break-all' }}>{personal.email}</a>
              </div>
            )}
            {personal.location && <div><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />{personal.location}</div>}
            {personal.linkedin && (
              <div>
                <Linkedin size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline', wordBreak: 'break-all' }}>{personal.linkedin}</a>
              </div>
            )}
            {personal.github && (
              <div>
                <Github size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline', wordBreak: 'break-all' }}>{personal.github}</a>
              </div>
            )}
            {personal.website && (
              <div>
                <Globe size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline', wordBreak: 'break-all' }}>{personal.website}</a>
              </div>
            )}
          </div>

          {/* Sidebar sections ordered by sectionOrder */}
          {sectionOrder.filter(k => leftKeys.includes(k)).map(key => renderSection(key))}
        </div>

        {/* Right Column (Header Banner & Main Content) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Header Block with Accent Banner for Job Title */}
          <div style={{ marginBottom: '4px' }}>
            <h1 
              style={{ fontSize: '2.5rem', fontWeight: 900, textTransform: 'uppercase', color: '#0f172a', lineHeight: 1.1 }}
              contentEditable 
              suppressContentEditableWarning 
              onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
            >
              {personal.fullName}
            </h1>
            <div style={{ backgroundColor: accentColor, color: '#ffffff', padding: '6px 12px', borderRadius: '4px', marginTop: '6px', display: 'inline-block' }}>
              <h2 
                style={{ fontSize: '0.875rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                contentEditable 
                suppressContentEditableWarning 
                onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
              >
                {personal.jobTitle}
              </h2>
            </div>
          </div>

          {/* Main sections ordered by sectionOrder */}
          {sectionOrder.filter(k => rightKeys.includes(k)).map(key => renderSection(key))}
        </div>
      </div>
    </div>
  );
};
