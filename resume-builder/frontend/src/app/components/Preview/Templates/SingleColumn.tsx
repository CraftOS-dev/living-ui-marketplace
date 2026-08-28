import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { GroupedSkills } from '../Sections/GroupedSkills';
import { formatHref } from '../../../utils/linkUtils';
import { Phone, Mail, MapPin, Linkedin, Globe, Github } from 'lucide-react';

export const SingleColumn: React.FC = () => {
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
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
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

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '10px' }}>
              Key Achievements
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {mostProudOf.map(item => (
                <div key={item.id} className="resume-section-item" style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: '#f8fafc', border: `1px solid #cbd5e1`, borderLeft: `4px solid ${accentColor}`, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>{item.title}</div>
                  <div style={{ fontSize: '0.775rem', color: '#475569', marginTop: '2px', lineHeight: 1.4 }}>{item.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'experience':
        return sectionVisibility.experience && experiences.length > 0 ? (
          <div key="experience">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '12px' }}>
              Experience
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {experiences.map(exp => (
                <div key={exp.id} className="resume-section-item" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span 
                      style={{ fontWeight: 800, fontSize: '0.925rem', color: '#0f172a' }}
                      contentEditable 
                      suppressContentEditableWarning 
                      onBlur={(e) => updateInlineField(`experience.${exp.id}.position`, e.currentTarget.innerText)}
                    >
                      {exp.position}
                    </span>
                    <span style={{ fontSize: '0.775rem', color: '#64748b', fontWeight: 600 }}>
                      {exp.startDate} – {exp.endDate}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.825rem', fontWeight: 700, color: accentColor, marginBottom: '4px' }}>
                    {exp.company} {exp.location ? `• ${exp.location}` : ''}
                  </div>
                  <div 
                    style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line' }}
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
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Education
            </h3>
            {educations.map(edu => (
              <div key={edu.id} className="resume-section-item" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '6px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <div>
                  <strong style={{ color: '#0f172a', fontSize: '0.875rem' }}>{edu.degree}</strong> • <span style={{ color: accentColor, fontWeight: 600 }}>{edu.institution}</span>
                </div>
                <div style={{ color: '#64748b', fontWeight: 600 }}>{edu.startDate} – {edu.endDate}</div>
              </div>
            ))}
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Portfolio Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {projects.map(proj => (
                <div key={proj.id} className="resume-section-item" style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: '#f8fafc', border: `1px solid #cbd5e1`, borderLeft: `4px solid ${accentColor}`, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.875rem', color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#334155', marginTop: '2px' }}>{proj.description}</div>
                  {proj.technologies && <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', marginTop: '2px' }}>Tech: {proj.technologies}</div>}
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
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Certifications & Credentials
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                  <div>
                    <strong style={{ color: '#0f172a', fontSize: '0.875rem' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</strong> • <span style={{ color: accentColor, fontWeight: 600 }}>{cert.issuer}</span>
                  </div>
                  <div style={{ color: '#64748b', fontWeight: 600 }}>{cert.issueDate}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'publications':
        return sectionVisibility.publications && publications && publications.length > 0 ? (
          <div key="publications">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Publications & Research
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {publications.map(pub => (
                <div key={pub.id} style={{ fontSize: '0.825rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div>
                      <strong style={{ color: '#0f172a', fontSize: '0.875rem' }}>
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

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Core Competencies
            </h3>
            <GroupedSkills skills={skills} accentColor={accentColor} />
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
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

  return (
    <div style={{ padding: '40px 36px', minHeight: '1123px', color: '#0f172a', fontFamily: 'inherit' }}>
      {/* Top Header */}
      <div style={{ borderBottom: `2px solid ${accentColor}`, paddingBottom: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 
              style={{ fontSize: '2.5rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#0f172a', lineHeight: 1.1 }}
              contentEditable 
              suppressContentEditableWarning 
              onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
            >
              {personal.fullName}
            </h1>
            <h2 
              style={{ fontSize: '1.05rem', fontWeight: 700, color: accentColor, marginTop: '4px' }}
              contentEditable 
              suppressContentEditableWarning 
              onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
            >
              {personal.jobTitle}
            </h2>
          </div>

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
                    width: '95px',
                    height: '95px',
                    aspectRatio: '1 / 1',
                    flexShrink: 0,
                    objectFit: 'cover',
                    borderRadius: style.photoShape === 'square' ? '12px' : '50%',
                    border: `2px solid ${accentColor}`,
                    cursor: 'pointer'
                  }}
                />
              ) : null}
            </div>
          )}
        </div>

        {/* Contact Info Row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.775rem', color: '#475569', marginTop: '10px', fontWeight: 600 }}>
          {personal.phone && (
            <span>
              <Phone size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a>
            </span>
          )}
          {personal.email && (
            <span>
              <Mail size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a>
            </span>
          )}
          {personal.location && <span><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />{personal.location}</span>}
          {personal.linkedin && (
            <span>
              <Linkedin size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a>
            </span>
          )}
          {personal.github && (
            <span>
              <Github size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a>
            </span>
          )}
          {personal.website && (
            <span>
              <Globe size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a>
            </span>
          )}
        </div>
      </div>

      {/* Single Column Content Sections mapped to sectionOrder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
        {sectionOrder.map(key => renderSection(key))}
      </div>
    </div>
  );
};
