import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';
import { Phone, Mail, MapPin, Linkedin, Github, Globe } from 'lucide-react';

export const CompactTwoCol: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#059669';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              Profile Summary
            </h3>
            <p style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)' }}>{personal.summary}</p>
          </div>
        ) : null;

      case 'experience':
        return sectionVisibility.experience && experiences.length > 0 ? (
          <div key="experience">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '10px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              Work History
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {experiences.map(exp => (
                <div key={exp.id}>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>{exp.position}</div>
                  <div style={{ fontSize: '0.8rem', color: accentColor, fontWeight: 600 }}>{exp.company} ({exp.startDate} – {exp.endDate})</div>
                  <div style={{ fontSize: '0.8rem', color: '#334155', marginTop: '4px', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line' }}>{exp.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '10px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              Portfolio Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}</div>
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

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              My Time Focus
            </h3>
            <MyTimeChart items={myTime} accentColor={accentColor} />
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              Key Achievements
            </h3>
            <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
          </div>
        ) : null;

      case 'philosophy':
        return sectionVisibility.philosophy && philosophy.quote ? (
          <div key="philosophy">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              Work Philosophy
            </h3>
            <PhilosophyQuote philosophy={philosophy} accentColor={accentColor} />
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '8px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              Technical Skills
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {skills.map(sk => (
                <span key={sk.id} style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 8px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#1e293b' }}>
                  {sk.name}
                </span>
              ))}
            </div>
          </div>
        ) : null;

      case 'education':
        return sectionVisibility.education && educations.length > 0 ? (
          <div key="education">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              Education
            </h3>
            {educations.map(edu => (
              <div key={edu.id} style={{ marginBottom: '6px', fontSize: '0.8rem' }}>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>{edu.degree}</div>
                <div style={{ color: '#64748b' }}>{edu.institution} ({edu.startDate} – {edu.endDate})</div>
              </div>
            ))}
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
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '2px' }}>
              Certifications
            </h3>
            {certifications.map(cert => (
              <div key={cert.id} style={{ marginBottom: '6px', fontSize: '0.8rem' }}>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</div>
                <div style={{ color: '#64748b' }}>{cert.issuer} {cert.issueDate ? `(${cert.issueDate})` : ''}</div>
              </div>
            ))}
          </div>
        ) : null;

      default:
        return null;
    }
  };

  const leftKeys = ['summary', 'experience', 'projects', 'publications'];
  const rightKeys = ['myTime', 'mostProudOf', 'philosophy', 'skills', 'education', 'certifications'];

  return (
    <div style={{ padding: '36px', minHeight: '1123px' }}>
      {/* Top Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${accentColor}`, paddingBottom: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {sectionVisibility.photo !== false && style.photoShape !== 'hidden' && personal.photoUrl && (
            <img 
              src={personal.photoUrl} 
              alt={personal.fullName}
              style={{
                width: '80px',
                height: '80px',
                aspectRatio: '1 / 1',
                flexShrink: 0,
                borderRadius: style.photoShape === 'square' ? '12px' : '50%',
                border: `2px solid ${accentColor}`,
                objectFit: 'cover'
              }}
            />
          )}
          <div>
            <h1 
              style={{ fontSize: '2.4rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}
              contentEditable 
              suppressContentEditableWarning 
              onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
            >
              {personal.fullName}
            </h1>
            <h2 
              style={{ fontSize: '1.2rem', fontWeight: 600, color: accentColor, marginTop: '4px' }}
              contentEditable 
              suppressContentEditableWarning 
              onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
            >
              {personal.jobTitle}
            </h2>
          </div>
        </div>

        <div style={{ textAlign: 'right', fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {personal.email && (
            <div>
              <Mail size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a>
            </div>
          )}
          {personal.phone && (
            <div>
              <Phone size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a>
            </div>
          )}
          {personal.location && <div><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />{personal.location}</div>}
          {personal.linkedin && (
            <div>
              <Linkedin size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a>
            </div>
          )}
          {personal.github && (
            <div>
              <Github size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a>
            </div>
          )}
          {personal.website && (
            <div>
              <Globe size={12} style={{ display: 'inline', marginRight: '4px' }} />
              <a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a>
            </div>
          )}
        </div>
      </div>

      {/* 2-Column Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {sectionOrder.filter(k => leftKeys.includes(k)).map(key => renderSection(key))}
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {sectionOrder.filter(k => rightKeys.includes(k)).map(key => renderSection(key))}
        </div>
      </div>
    </div>
  );
};
