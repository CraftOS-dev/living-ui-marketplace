import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';
import { Phone, Mail, MapPin, Linkedin, Github, Globe } from 'lucide-react';

export const CreativeBanner: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#ec4899';
  const secondaryColor = style.secondaryColor || '#8b5cf6';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px' }}>
              Summary
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)' }}>{personal.summary}</p>
          </div>
        ) : null;

      case 'experience':
        return sectionVisibility.experience && experiences.length > 0 ? (
          <div key="experience">
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '12px' }}>
              Work Experience
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {experiences.map(exp => (
                <div key={exp.id}>
                  <div style={{ fontWeight: 700, fontSize: '0.925rem', color: '#0f172a' }}>{exp.position}</div>
                  <div style={{ fontSize: '0.825rem', color: accentColor, fontWeight: 600, marginBottom: '4px' }}>
                    {exp.company} • ({exp.startDate} – {exp.endDate})
                  </div>
                  <div style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line' }}>{exp.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '8px' }}>
              Featured Projects
            </h3>
            {projects.map(proj => (
              <div key={proj.id} style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}</div>
                <div style={{ fontSize: '0.8rem', color: '#334155' }}>{proj.description}</div>
                  {proj.link && (
                    <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                      <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{proj.link}</a>
                    </div>
                  )}
              </div>
            ))}
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px' }}>
              My Time
            </h3>
            <MyTimeChart items={myTime} accentColor={accentColor} />
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px' }}>
              Key Highlights
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

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px' }}>
              Core Skills
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {skills.map(sk => (
                <span key={sk.id} style={{ fontSize: '0.725rem', fontWeight: 600, padding: '3px 8px', borderRadius: '12px', background: 'rgba(236, 72, 153, 0.1)', color: accentColor }}>
                  {sk.name}
                </span>
              ))}
            </div>
          </div>
        ) : null;

      case 'education':
        return sectionVisibility.education && educations.length > 0 ? (
          <div key="education">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px' }}>
              Education
            </h3>
            {educations.map(edu => (
              <div key={edu.id} style={{ fontSize: '0.8rem', marginBottom: '6px' }}>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>{edu.degree}</div>
                <div style={{ color: '#64748b' }}>{edu.institution}</div>
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
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: accentColor, marginBottom: '6px' }}>
              Certifications
            </h3>
            {certifications.map(cert => (
              <div key={cert.id} style={{ fontSize: '0.8rem', marginBottom: '6px' }}>
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

  const mainKeys = ['summary', 'experience', 'projects', 'publications'];
  const sidebarKeys = ['myTime', 'mostProudOf', 'philosophy', 'skills', 'education', 'certifications'];

  return (
    <div style={{ minHeight: '1123px' }}>
      {/* Top Banner Box */}
      <div 
        style={{ 
          backgroundColor: '#ffffff', 
          borderBottom: `3px solid ${accentColor}`,
          color: '#0f172a',
          padding: '36px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div>
          <h1 
            style={{ fontSize: '2.5rem', fontWeight: 800, lineHeight: 1.1 }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
          >
            {personal.fullName}
          </h1>
          <h2 
            style={{ fontSize: '1.2rem', fontWeight: 600, color: accentColor, marginTop: '6px' }}
            contentEditable 
            suppressContentEditableWarning 
            onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
          >
            {personal.jobTitle}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '0.8rem', opacity: 0.95, marginTop: '12px' }}>
            {personal.email && (
              <span>
                <Mail size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a>
              </span>
            )}
            {personal.phone && (
              <span>
                <Phone size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a>
              </span>
            )}
            {personal.location && <span><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />{personal.location}</span>}
            {personal.linkedin && (
              <span>
                <Linkedin size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{personal.linkedin}</a>
              </span>
            )}
            {personal.github && (
              <span>
                <Github size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{personal.github}</a>
              </span>
            )}
            {personal.website && (
              <span>
                <Globe size={12} style={{ display: 'inline', marginRight: '4px' }} />
                <a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{personal.website}</a>
              </span>
            )}
          </div>
        </div>

        {sectionVisibility.photo !== false && style.photoShape !== 'hidden' && personal.photoUrl && (
          <img 
            src={personal.photoUrl} 
            alt={personal.fullName}
            style={{
              width: '100px',
              height: '100px',
              aspectRatio: '1 / 1',
              flexShrink: 0,
              borderRadius: style.photoShape === 'square' ? '12px' : '50%',
              border: '4px solid #ffffff',
              objectFit: 'cover',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
          />
        )}
      </div>

      {/* Content Grid */}
      <div style={{ padding: '36px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '32px' }}>
        {/* Main Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {sectionOrder.filter(k => mainKeys.includes(k)).map(key => renderSection(key))}
        </div>

        {/* Sidebar Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {sectionOrder.filter(k => sidebarKeys.includes(k)).map(key => renderSection(key))}
        </div>
      </div>
    </div>
  );
};
