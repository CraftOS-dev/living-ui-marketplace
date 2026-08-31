import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';
import { Phone, Mail, MapPin, Linkedin, Github, Landmark, Globe } from 'lucide-react';

export const DoubleColumnBanking: React.FC = () => {
  const { resume, updatePersonal, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#1d4ed8';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Summary
            </h3>
            <p 
              style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)' }}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '4px', backgroundColor: '#eff6ff', border: `1px solid ${accentColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Landmark size={13} color={accentColor} />
                      </div>
                      <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>{exp.position}</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{exp.startDate} – {exp.endDate}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: accentColor, marginLeft: '32px', marginBottom: '4px' }}>
                    {exp.company} {exp.location ? `• ${exp.location}` : ''}
                  </div>
                  <div 
                    style={{ fontSize: '0.8rem', color: '#334155', marginLeft: '32px', lineHeight: 'var(--resume-line-height, 1.55)', whiteSpace: 'pre-line' }}
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
                <div key={proj.id} style={{ fontSize: '0.8rem' }}>
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

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Strengths & Accomplishments
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {mostProudOf.map((item, idx) => (
                <div key={item.id} style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: `4px solid ${accentColor}` }}>
                  <div style={{ fontWeight: 800, fontSize: '0.8rem', color: accentColor }}>{idx + 1}. {item.title}</div>
                  <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '2px' }}>{item.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Skills
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {skills.map(sk => (
                <span key={sk.id} style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 8px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1' }}>
                  {sk.name}
                </span>
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

      case 'publications':
        return sectionVisibility.publications && publications && publications.length > 0 ? (
          <div key="publications">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor, borderBottom: `2px solid ${accentColor}`, paddingBottom: '4px', marginBottom: '8px' }}>
              Publications & Research
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {publications.map(pub => (
                <div key={pub.id} style={{ fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a' }}>
                    {pub.url ? (
                      <a href={formatHref(pub.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{pub.title}</a>
                    ) : (
                      pub.title
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{pub.publisher} {pub.date ? `(${pub.date})` : ''}</div>
                  {pub.description && <div style={{ fontSize: '0.775rem', color: '#334155', marginTop: '2px' }}>{pub.description}</div>}
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'philosophy':
        return sectionVisibility.philosophy && philosophy.quote ? (
          <div key="philosophy">
            <PhilosophyQuote philosophy={philosophy} accentColor={accentColor} />
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <MyTimeChart items={myTime} accentColor={accentColor} />
          </div>
        ) : null;

      default:
        return null;
    }
  };

  const leftKeys = ['summary', 'experience', 'education', 'projects', 'publications'];
  const rightKeys = ['mostProudOf', 'skills', 'certifications', 'philosophy', 'myTime'];

  return (
    <div style={{ padding: '36px', minHeight: '1123px', color: '#0f172a', backgroundColor: '#ffffff', fontFamily: 'inherit' }}>
      {/* Top Header */}
      <div style={{ borderBottom: `2px solid ${accentColor}`, paddingBottom: '16px', marginBottom: '24px' }}>
        <h1 
          style={{ fontSize: '2.5rem', fontWeight: 900, textTransform: 'uppercase', color: accentColor, lineHeight: 1.1 }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>
        <h2 
          style={{ fontSize: '1rem', fontWeight: 700, color: '#334155', marginTop: '4px' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
        >
          {personal.jobTitle}
        </h2>

        {/* Contact Line */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.775rem', color: '#64748b', marginTop: '10px', fontWeight: 600 }}>
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

      {/* 2-Column Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '28px' }}>
        {/* Left Main Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {sectionOrder.filter(k => leftKeys.includes(k)).map(key => renderSection(key))}
        </div>

        {/* Right Sidebar Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {sectionOrder.filter(k => rightKeys.includes(k)).map(key => renderSection(key))}
        </div>
      </div>
    </div>
  );
};
