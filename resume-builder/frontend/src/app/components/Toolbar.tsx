import React from 'react';
import { useResume } from '../context/ResumeContext';
import type { TemplateId, FontFamily, FontSize, LineSpacing, PhotoShape, SectionVisibility } from '../types/resume';
import { getTemplateDefaultFont } from '../types/resume';
import { getTemplateSupportedSections } from '../utils/templateSections';
import { Palette, Type, Layout, User, Hash } from 'lucide-react';

const ACCENT_COLORS = [
  '#f97316', // Vibrant Orange
  '#0f172a', // Slate Navy
  '#0c2340', // Deep Blue
  '#004d40', // Deep Teal
  '#1d4ed8', // Royal Blue
  '#10b981', // Emerald Tech
  '#8b5cf6', // Violet
  '#d97706'  // Amber
];

export const Toolbar: React.FC = () => {
  const { resume, updateStyle, updateSectionVisibility } = useResume();
  const { style } = resume;

  const handleTemplateChange = (newTemplateId: TemplateId) => {
    // Reset font to 'Default' and set section visibility matching template capabilities
    updateStyle({ 
      templateId: newTemplateId,
      fontFamily: 'Default'
    });

    const supported = getTemplateSupportedSections(newTemplateId);
    Object.entries(supported).forEach(([key, isSupported]) => {
      updateSectionVisibility(key as keyof SectionVisibility, isSupported);
    });
  };

  const defaultFontName = getTemplateDefaultFont(style.templateId);

  return (
    <div className="app-toolbar no-print">
      {/* Template Selector with Categorized Groups */}
      <div className="toolbar-group">
        <Layout size={15} color="var(--text-muted)" />
        <span className="toolbar-label">Template:</span>
        <select 
          className="select-input"
          value={style.templateId}
          onChange={(e) => handleTemplateChange(e.target.value as TemplateId)}
          style={{ maxWidth: '230px', fontWeight: 600 }}
        >
          <optgroup label="⭐ Popular & Executive">
            <option value="executive_classic">CEO Executive</option>
            <option value="executive_one">Executive I</option>
            <option value="high_performer">High Performer Director</option>
            <option value="enhancv_modern_v2">Modern Clean</option>
            <option value="enhancv_modern">Modern Split Column</option>
          </optgroup>

          <optgroup label="🏛️ Academic & Traditional">
            <option value="enhancv_classic">Auditor Classic</option>
            <option value="ivy_league_v3">Corporate Ivy</option>
            <option value="imprint">Imprint Serif</option>
            <option value="ivy_league_v2">Ivy League Centered</option>
            <option value="ivy_league">Ivy League Classic</option>
            <option value="pure">Pure Academic</option>
          </optgroup>

          <optgroup label="💼 Corporate & Banking">
            <option value="double_column_banking">Banking Double Column</option>
            <option value="collegiate">Collegiate Banner</option>
            <option value="crest">Crest Editorial</option>
            <option value="crest_projects">Crest Projects</option>
            <option value="executive_serif">Executive Serif Director</option>
            <option value="single_column_v2">Single Column Executive</option>
          </optgroup>

          <optgroup label="⚡ Modern & Tech">
            <option value="boxed_manager">Boxed Framing Manager</option>
            <option value="compact_two_col">Compact Grid</option>
            <option value="enhancv_compact">Compact Leadership</option>
            <option value="enhancv_contemporary">Contemporary Startup</option>
            <option value="data_timeline">Data Pipeline Timeline</option>
            <option value="enhancv_minimal">Minimal Tech</option>
            <option value="single_column">Single Column Standard</option>
            <option value="timeline_tech">Timeline Tech Developer</option>
          </optgroup>

          <optgroup label="🎨 Creative & Portfolio">
            <option value="creative_banner">Creative Header Banner</option>
            <option value="enhancv_creative">Creative Portfolio</option>
            <option value="double_column">Double Column Modern</option>
            <option value="elegant">Elegant Sidebar</option>
            <option value="elegant_v2">Elegant Timeline</option>
            <option value="polished">Polished Sidebar</option>
            <option value="enhancv_stylish">Stylish Leadership</option>
            <option value="systems_tech">Systems Tech Highlight</option>
            <option value="timeline">Timeline Visual</option>
          </optgroup>
        </select>
      </div>

      <div style={{ height: '20px', width: '1px', backgroundColor: 'var(--border-color)' }} />

      {/* Color Palette */}
      <div className="toolbar-group">
        <Palette size={15} color="var(--text-muted)" />
        <span className="toolbar-label">Accent:</span>
        <div className="swatch-picker">
          {ACCENT_COLORS.map(color => (
            <button
              key={color}
              className={`swatch-btn ${style.accentColor === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => updateStyle({ accentColor: color })}
              title={`Accent ${color}`}
            />
          ))}
        </div>
      </div>

      <div style={{ height: '20px', width: '1px', backgroundColor: 'var(--border-color)' }} />

      {/* Font Family (Includes Template Default) */}
      <div className="toolbar-group">
        <Type size={15} color="var(--text-muted)" />
        <span className="toolbar-label">Font:</span>
        <select 
          className="select-input"
          value={style.fontFamily}
          onChange={(e) => updateStyle({ fontFamily: e.target.value as FontFamily })}
        >
          <option value="Default">Template Default ({defaultFontName})</option>
          <option value="Outfit">Outfit (Modern)</option>
          <option value="Inter">Inter (Clean)</option>
          <option value="Playfair Display">Playfair (Serif)</option>
          <option value="Space Mono">Space Mono (Tech)</option>
          <option value="Plus Jakarta Sans">Jakarta Sans</option>
        </select>
      </div>

      <div style={{ height: '20px', width: '1px', backgroundColor: 'var(--border-color)' }} />

      {/* Font Size & Spacing */}
      <div className="toolbar-group">
        <span className="toolbar-label">Scale:</span>
        <select 
          className="select-input"
          value={style.fontSize}
          onChange={(e) => updateStyle({ fontSize: e.target.value as FontSize })}
        >
          <option value="small">Small (Dense)</option>
          <option value="medium">Medium (Standard)</option>
          <option value="large">Large (Spacious)</option>
        </select>

        <select 
          className="select-input"
          value={style.lineSpacing}
          onChange={(e) => updateStyle({ lineSpacing: e.target.value as LineSpacing })}
        >
          <option value="compact">Compact Lines</option>
          <option value="normal">Normal Lines</option>
          <option value="spacious">Roomy Lines</option>
        </select>
      </div>

      <div style={{ height: '20px', width: '1px', backgroundColor: 'var(--border-color)' }} />

      {/* Photo Shape */}
      <div className="toolbar-group">
        <User size={15} color="var(--text-muted)" />
        <span className="toolbar-label">Avatar:</span>
        <select 
          className="select-input"
          value={style.photoShape}
          onChange={(e) => updateStyle({ photoShape: e.target.value as PhotoShape })}
        >
          <option value="round">Circle</option>
          <option value="square">Rounded Square</option>
          <option value="hidden">Hide Photo</option>
        </select>
      </div>
    </div>
  );
};
