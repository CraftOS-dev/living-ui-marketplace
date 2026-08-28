import React, { useState, useRef } from 'react';
import { useResume } from '../context/ResumeContext';
import { Plus, Edit2, Copy, Trash2, Upload, Printer, ChevronDown, CheckCircle2, AlertTriangle, Lightbulb, Hash } from 'lucide-react';

export const Header: React.FC = () => {
  const { 
    resumes, 
    activeResumeId, 
    resume, 
    score, 
    createResume, 
    duplicateResume,
    switchResume, 
    deleteResume, 
    renameResume, 
    exportJson, 
    importJson,
    updateStyle
  } = useResume();
  
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [resumeModalMode, setResumeModalMode] = useState<'create' | 'edit' | null>(null);
  const [resumeModalInput, setResumeModalInput] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePrint = () => {
    const originalTitle = document.title;
    document.title = `${resume.personal.fullName.replace(/\s+/g, '_')}_Resume`;
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 500);
  };

  const exportWord = () => {
    const { personal, experiences, educations, skills } = resume;
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${personal.fullName} Resume</title>
      <style>
        body { font-family: Calibri, Arial, sans-serif; margin: 24pt; color: #1e293b; }
        h1 { font-size: 24pt; margin-bottom: 2pt; color: #0f172a; }
        h2 { font-size: 14pt; border-bottom: 2px solid #0f172a; padding-bottom: 3pt; margin-top: 14pt; color: #0f172a; }
        .contact { font-size: 10pt; color: #64748b; margin-bottom: 14pt; }
        .item-title { font-weight: bold; font-size: 11pt; color: #0f172a; }
        .item-date { font-style: italic; color: #64748b; font-size: 10pt; }
        p, li { font-size: 10.5pt; line-height: 1.5; color: #334155; }
      </style>
      </head>
      <body>
        <h1>${personal.fullName}</h1>
        <div class="contact">
          ${[personal.jobTitle, personal.email, personal.phone, personal.location].filter(Boolean).join(' | ')}
        </div>
        ${personal.summary ? `<h2>Profile</h2><p>${personal.summary}</p>` : ''}
        ${experiences.length > 0 ? `
          <h2>Work Experience</h2>
          ${experiences.map(exp => `
            <div style="margin-bottom: 10pt;">
              <div class="item-title">${exp.position} - ${exp.company}</div>
              <div class="item-date">${exp.startDate} - ${exp.endDate}</div>
              <p>${exp.description}</p>
            </div>
          `).join('')}
        ` : ''}
        ${educations.length > 0 ? `
          <h2>Education</h2>
          ${educations.map(edu => `
            <div style="margin-bottom: 8pt;">
              <div class="item-title">${edu.degree}, ${edu.institution}</div>
              <div class="item-date">${edu.startDate} - ${edu.endDate}</div>
            </div>
          `).join('')}
        ` : ''}
        ${skills.length > 0 ? `
          <h2>Skills</h2>
          <p>${skills.map(sk => `<b>${sk.name}</b> (${sk.proficiency || 'Advanced'})`).join(' • ')}</p>
        ` : ''}
      </body>
      </html>
    `;
    {/* Aima */}

    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = URL.createObjectURL(blob);
    downloadAnchor.download = `${personal.fullName.replace(/\s+/g, '_')}_Resume.doc`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const exportLatex = () => {
    const { personal, experiences, educations, skills } = resume;
    let tex = `\\documentclass[11pt,a4paper]{article}\n`;
    tex += `\\usepackage[utf8]{inputenc}\n`;
    tex += `\\usepackage[margin=0.75in]{geometry}\n`;
    tex += `\\usepackage{hyperref}\n\n`;
    tex += `\\begin{document}\n\n`;
    tex += `\\centerline{\\Huge \\bfseries ${personal.fullName}}\n`;
    tex += `\\vspace{4pt}\n`;
    tex += `\\centerline{${[personal.jobTitle, personal.email, personal.phone, personal.location].filter(Boolean).join(' $|$ ')}}\n`;
    tex += `\\vspace{14pt}\n\n`;

    if (personal.summary) {
      tex += `\\section*{Profile}\n${personal.summary}\n\\vspace{10pt}\n\n`;
    }

    if (experiences.length > 0) {
      tex += `\\section*{Work Experience}\n`;
      experiences.forEach(exp => {
        tex += `\\textbf{${exp.position}} \\hfill {\\small ${exp.startDate} -- ${exp.endDate}}\\\\ \n`;
        tex += `\\textit{${exp.company}}\\\\ \n`;
        tex += `${exp.description.replace(/•/g, '\\item')}\n\\vspace{8pt}\n\n`;
      });
    }

    if (educations.length > 0) {
      tex += `\\section*{Education}\n`;
      educations.forEach(edu => {
        tex += `\\textbf{${edu.degree}} -- \\textit{${edu.institution}} \\hfill {\\small ${edu.startDate} -- ${edu.endDate}}\\\\ \n`;
      });
      tex += `\\vspace{10pt}\n\n`;
    }

    if (skills.length > 0) {
      tex += `\\section*{Skills}\n`;
      tex += skills.map(sk => `\\textbf{${sk.name}} (${sk.proficiency || 'Advanced'})`).join(' • ');
      tex += `\n\n`;
    }

    tex += `\\end{document}\n`;

    const blob = new Blob([tex], { type: 'text/x-tex;charset=utf-8' });
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = URL.createObjectURL(blob);
    downloadAnchor.download = `${personal.fullName.replace(/\s+/g, '_')}_Resume.tex`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          const success = importJson(content);
          if (!success) {
            alert('Failed to import JSON file. Please ensure it is a valid resume export.');
          }
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    }
  };

  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (resumeModalInput.trim()) {
      if (resumeModalMode === 'create') {
        createResume(resumeModalInput.trim());
      } else if (resumeModalMode === 'edit') {
        renameResume(activeResumeId, resumeModalInput.trim());
      }
      setResumeModalMode(null);
    }
  };

  return (
    <>
      <header className="app-header no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Brand Name */}
          <div className="brand-logo">
            <div>
              <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>Resume</span>
              <span style={{ color: 'var(--accent-primary)', fontWeight: 800, marginLeft: '4px' }}>Maker</span>
            </div>
          </div>

          {/* Multi-Resume Selector & Management Options Next to ResumeMaker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--bg-card)', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <select
              className="select-input"
              style={{ padding: '5px 10px', fontSize: '0.825rem', fontWeight: 600, minWidth: '220px', maxWidth: '320px' }}
              value={activeResumeId}
              onChange={(e) => switchResume(e.target.value)}
              title="Select Active Resume"
            >
              {resumes.map(r => (
                <option key={r.id} value={r.id}>
                  {r.title || r.personal.fullName || 'Untitled Resume'}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ padding: '4px 8px', fontSize: '0.75rem', gap: '4px' }}
              onClick={() => {
                setResumeModalInput(`Resume #${resumes.length + 1}`);
                setResumeModalMode('create');
              }}
              title="Create New Resume"
            >
              <Plus size={13} />
              <span>New</span>
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ padding: '4px 6px' }}
              onClick={() => {
                setResumeModalInput(resume.title || 'My Resume');
                setResumeModalMode('edit');
              }}
              title="Rename Current Resume"
            >
              <Edit2 size={13} />
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ padding: '4px 6px' }}
              onClick={() => duplicateResume()}
              title="Duplicate Current Resume (Creates a copy with 'Duplicate' appended)"
            >
              <Copy size={13} />
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ padding: '4px 6px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
              onClick={() => setShowDeleteModal(true)}
              title="Delete Current Resume"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        <div className="header-actions">
          {/* Score Badge */}
          <div 
            className="score-pill" 
            onClick={() => setShowScoreModal(true)}
            title="View Resume Score & Criteria"
          >
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Score:</span>
            <span 
              className="score-number"
              style={{ color: score.score >= 80 ? '#10b981' : score.score >= 60 ? '#f59e0b' : '#ef4444' }}
            >
              {score.score}/100
            </span>
          </div>

          {/* JSON Backup Import */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".json" 
            style={{ display: 'none' }} 
          />
          <button 
            className="btn btn-outline btn-sm"
            onClick={() => fileInputRef.current?.click()}
            title="Upload JSON Resume Backup"
          >
            <Upload size={15} />
            <span>Import</span>
          </button>

          {/* Unified Export Dropdown (PDF, Word, LaTeX, JSON) */}
          <div style={{ position: 'relative', zIndex: 2000 }}>
            <button 
              className="btn btn-primary"
              onClick={() => setShowExportMenu(!showExportMenu)}
              title="Export Resume in PDF, Word, LaTeX, or JSON format"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Printer size={16} />
              <span>Export</span>
              <ChevronDown size={14} />
            </button>

            {showExportMenu && (
              <div 
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '6px',
                  backgroundColor: 'var(--bg-panel)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  zIndex: 2000,
                  minWidth: '150px',
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}
              >
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ justifyContent: 'flex-start', border: 'none', padding: '8px 12px', fontSize: '0.825rem' }}
                  onClick={() => {
                    setShowExportMenu(false);
                    handlePrint();
                  }}
                >
                  📄 PDF
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ justifyContent: 'flex-start', border: 'none', padding: '8px 12px', fontSize: '0.825rem' }}
                  onClick={() => {
                    setShowExportMenu(false);
                    exportWord();
                  }}
                >
                  📝 Word (.docx)
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ justifyContent: 'flex-start', border: 'none', padding: '8px 12px', fontSize: '0.825rem' }}
                  onClick={() => {
                    setShowExportMenu(false);
                    exportLatex();
                  }}
                >
                  ⚙️ LaTeX (.tex)
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ justifyContent: 'flex-start', border: 'none', padding: '8px 12px', fontSize: '0.825rem' }}
                  onClick={() => {
                    setShowExportMenu(false);
                    exportJson();
                  }}
                >
                  ⚙️ Backup (JSON)
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
       
          

      {/* Interactive Modal Popup for Create / Edit Resume Name */}
      {resumeModalMode && (
        <div className="modal-overlay" onClick={() => setResumeModalMode(null)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {resumeModalMode === 'create' ? 'Create New Resume' : 'Rename Resume'}
              </h3>
              <button 
                className="btn btn-outline btn-sm"
                onClick={() => setResumeModalMode(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleModalSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Resume Name / Title
                </label>
                <input
                  type="text"
                  className="form-control"
                  style={{ width: '100%', fontSize: '0.875rem', padding: '8px 12px' }}
                  value={resumeModalInput}
                  onChange={(e) => setResumeModalInput(e.target.value)}
                  placeholder="e.g. Senior Software Engineer Resume"
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setResumeModalMode(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                >
                  {resumeModalMode === 'create' ? 'Create Resume' : 'Save Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Score Details Modal (5 Groups out of 20 points each) */}
      {showScoreModal && (
        <div className="modal-overlay" onClick={() => setShowScoreModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Resume Score Breakdown ({score.score}/100)</h3>
              <button 
                className="btn btn-outline btn-sm"
                onClick={() => setShowScoreModal(false)}
              >
                ✕
              </button>
            </div>
            
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Evaluated across 5 core criteria groups (scored out of 20 points each):
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              <div className="form-card" style={{ padding: '12px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Personal & Contact</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-primary)' }}>{score.breakdown.contactCompleteness}/20</div>
              </div>
              <div className="form-card" style={{ padding: '12px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Summary Quality</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-primary)' }}>{score.breakdown.summaryQuality}/20</div>
              </div>
              <div className="form-card" style={{ padding: '12px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Experience & Verbs</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-primary)' }}>{score.breakdown.actionVerbs}/20</div>
              </div>
              <div className="form-card" style={{ padding: '12px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Metrics & Impact</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-primary)' }}>{score.breakdown.quantifiableMetrics}/20</div>
              </div>
              <div className="form-card" style={{ padding: '12px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Skills & Visuals</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-primary)' }}>{score.breakdown.visualHighlights}/20</div>
              </div>
            </div>

            <h4 style={{ fontSize: '0.9rem', marginBottom: '10px', color: 'var(--text-primary)' }}>Actionable Recommendations</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {score.suggestions.map(s => (
                <div 
                  key={s.id} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'flex-start', 
                    gap: '10px', 
                    padding: '10px 12px', 
                    borderRadius: '8px',
                    backgroundColor: s.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    border: `1px solid ${s.type === 'success' ? '#10b981' : '#f59e0b'}`
                  }}
                >
                  {s.type === 'success' ? (
                    <CheckCircle2 size={18} color="#10b981" />
                  ) : s.type === 'warning' ? (
                    <AlertTriangle size={18} color="#f59e0b" />
                  ) : (
                    <Lightbulb size={18} color="#f97316" />
                  )}
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{s.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={18} color="#ef4444" />
                </div>
                <h3 className="modal-title" style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Delete Resume</h3>
              </div>
              <button 
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowDeleteModal(false)}
              >
                ✕
              </button>
            </div>
            
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
              Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>"{resume.title || resume.personal.fullName || 'this resume'}"</strong>? This action cannot be undone.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowDeleteModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ backgroundColor: '#ef4444', color: '#ffffff', border: 'none', fontWeight: 600, padding: '6px 14px' }}
                onClick={() => {
                  deleteResume(activeResumeId);
                  setShowDeleteModal(false);
                }}
              >
                Delete Resume
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
