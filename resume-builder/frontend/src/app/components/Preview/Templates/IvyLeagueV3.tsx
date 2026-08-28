import React from 'react';
import { useResume } from '../../../context/ResumeContext';
import { MostProudOfBadges } from '../Sections/MostProudOfBadges';
import { MyTimeChart } from '../Sections/MyTimeChart';
import { PhilosophyQuote } from '../Sections/PhilosophyQuote';
import { formatHref } from '../../../utils/linkUtils';
import { Briefcase, GraduationCap } from 'lucide-react';

export const IvyLeagueV3: React.FC = () => {
  const { resume, updateInlineField } = useResume();
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects, certifications, publications = [], sectionVisibility, sectionOrder, style } = resume;
  const accentColor = style.accentColor || '#1e3a8a';

  const renderSection = (key: string) => {
    switch (key) {
      case 'summary':
        return sectionVisibility.summary && personal.summary ? (
          <div key="summary">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Summary
            </h3>
            <p 
              style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 'var(--resume-line-height, 1.55)', textAlign: 'justify' }}
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
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '12px' }}>
              Experience
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {experiences.map(exp => (
                <div key={exp.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '4px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Briefcase size={13} color={accentColor} />
                      </div>
                      <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>{exp.position}</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{exp.startDate} – {exp.endDate}</span>
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
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Education
            </h3>
            {educations.map(edu => (
              <div key={edu.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.825rem', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '24px', height: '24px', borderRadius: '4px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <GraduationCap size={13} color={accentColor} />
                  </div>
                  <div>
                    <strong style={{ color: '#0f172a' }}>{edu.degree}</strong> • <span style={{ color: accentColor }}>{edu.institution}</span>
                  </div>
                </div>
                <div style={{ color: '#64748b' }}>{edu.startDate} – {edu.endDate}</div>
              </div>
            ))}
          </div>
        ) : null;

      case 'skills':
        return sectionVisibility.skills && skills.length > 0 ? (
          <div key="skills">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Skills & Expertise
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
              {skills.map(sk => (
                <span key={sk.id} style={{ fontSize: '0.775rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', color: '#334155' }}>
                  {sk.name}
                </span>
              ))}
            </div>
          </div>
        ) : null;

      case 'projects':
        return sectionVisibility.projects && projects && projects.length > 0 ? (
          <div key="projects">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Portfolio Projects
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {projects.map(proj => (
                <div key={proj.id} style={{ fontSize: '0.825rem', fontFamily: 'inherit' }}>
                  <strong style={{ color: '#0f172a' }}>{proj.link ? <a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{proj.title}</a> : proj.title}: </strong>
                  <span>{proj.description}</span>
                  {proj.technologies && <span style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}> ({proj.technologies})</span>}{proj.link && <span style={{ marginLeft: '6px' }}><a href={formatHref(proj.link, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, fontSize: '0.75rem', textDecoration: 'underline' }}>{proj.link}</a></span>}
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
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Certifications & Credentials
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {certifications.map(cert => (
                <div key={cert.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                  <div>
                    <strong style={{ color: '#0f172a' }}>{cert.url ? <a href={formatHref(cert.url, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{cert.name}</a> : cert.name}</strong> • {cert.issuer}
                  </div>
                  <div style={{ color: '#64748b' }}>{cert.issueDate}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;

      case 'mostProudOf':
        return sectionVisibility.mostProudOf && mostProudOf.length > 0 ? (
          <div key="mostProudOf">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
              Key Achievements
            </h3>
            <MostProudOfBadges items={mostProudOf} accentColor={accentColor} />
          </div>
        ) : null;

      case 'myTime':
        return sectionVisibility.myTime && myTime.length > 0 ? (
          <div key="myTime">
            <h3 style={{ fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#0f172a', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px', marginBottom: '8px' }}>
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
    <div style={{ padding: '40px 36px', minHeight: '1123px', color: '#0f172a', backgroundColor: '#ffffff', fontFamily: 'inherit' }}>
      {/* Centered Serif Corporate Header */}
      <div style={{ textAlign: 'center', borderBottom: '1px solid #cbd5e1', paddingBottom: '16px', marginBottom: '24px' }}>
        <h1 
          style={{ fontSize: '2.5rem', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.01em' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.fullName', e.currentTarget.innerText)}
        >
          {personal.fullName}
        </h1>
        <h2 
          style={{ fontSize: '0.95rem', fontWeight: 600, fontStyle: 'italic', color: accentColor, marginTop: '4px', fontFamily: 'inherit' }}
          contentEditable 
          suppressContentEditableWarning 
          onBlur={(e) => updateInlineField('personal.jobTitle', e.currentTarget.innerText)}
        >
          {personal.jobTitle}
        </h2>

        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '12px', fontSize: '0.775rem', color: '#64748b', marginTop: '8px', fontFamily: 'inherit' }}>
          {personal.phone && <span><a href={formatHref(personal.phone, 'phone')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.phone}</a></span>}
          {personal.email && <span><a href={formatHref(personal.email, 'email')} style={{ color: 'inherit', textDecoration: 'none' }}>{personal.email}</a></span>}
          {personal.location && <span>{personal.location}</span>}
          {personal.linkedin && <span><a href={formatHref(personal.linkedin, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.linkedin}</a></span>}
          {personal.github && <span><a href={formatHref(personal.github, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.github}</a></span>}
          {personal.website && <span><a href={formatHref(personal.website, 'url')} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'underline' }}>{personal.website}</a></span>}
        </div>
      </div>

      {/* Single Column Content mapped to sectionOrder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', fontFamily: 'inherit' }}>
        {sectionOrder.map(key => renderSection(key))}
      </div>
    </div>
  );
};
