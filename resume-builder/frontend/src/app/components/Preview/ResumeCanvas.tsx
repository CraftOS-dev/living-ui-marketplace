import React, { useState, useRef, useEffect } from 'react';
import { useResume } from '../../context/ResumeContext';
import { getTemplateDefaultFont } from '../../types/resume';
import { BoxedManager } from './Templates/BoxedManager';
import { ExecutiveSerif } from './Templates/ExecutiveSerif';
import { DataTimeline } from './Templates/DataTimeline';
import { SystemsTech } from './Templates/SystemsTech';
import { Pure } from './Templates/Pure';
import { ExecutiveOne } from './Templates/ExecutiveOne';
import { Collegiate } from './Templates/Collegiate';
import { HighPerformer } from './Templates/HighPerformer';
import { EnhancvMinimal } from './Templates/EnhancvMinimal';
import { CrestProjects } from './Templates/CrestProjects';
import { DoubleColumnBanking } from './Templates/DoubleColumnBanking';
import { EnhancvCompact } from './Templates/EnhancvCompact';
import { TimelineTech } from './Templates/TimelineTech';
import { EnhancvClassic } from './Templates/EnhancvClassic';
import { IvyLeagueV2 } from './Templates/IvyLeagueV2';
import { IvyLeagueV3 } from './Templates/IvyLeagueV3';
import { SingleColumnV2 } from './Templates/SingleColumnV2';
import { ElegantV2 } from './Templates/ElegantV2';
import { EnhancvCreative } from './Templates/EnhancvCreative';
import { EnhancvStylish } from './Templates/EnhancvStylish';
import { EnhancvModern } from './Templates/EnhancvModern';
import { EnhancvContemporary } from './Templates/EnhancvContemporary';
import { SingleColumn } from './Templates/SingleColumn';
import { Polished } from './Templates/Polished';
import { Imprint } from './Templates/Imprint';
import { Timeline } from './Templates/Timeline';
import { DoubleColumn } from './Templates/DoubleColumn';
import { IvyLeague } from './Templates/IvyLeague';
import { Elegant } from './Templates/Elegant';
import { Crest } from './Templates/Crest';
import { ModernSplit } from './Templates/ModernSplit';
import { CompactTwoCol } from './Templates/CompactTwoCol';
import { ExecutiveClassic } from './Templates/ExecutiveClassic';
import { CreativeBanner } from './Templates/CreativeBanner';
import { Layers, Hash } from 'lucide-react';

const A4_HEIGHT_PX = 1123; // Exact standard A4 height (297mm @ 96 DPI)

export const ResumeCanvas: React.FC = () => {
  const { resume, updateStyle } = useResume();
  const { style } = resume;
  const sheetMeasureRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState<number>(1);

  // Measure template scroll height & dynamically adjust screen page breaks for subsection items
  useEffect(() => {
    if (!sheetMeasureRef.current) return;

    const adjustPageBreaks = () => {
      const container = sheetMeasureRef.current;
      if (!container) return;

      // 1. Reset all previous margin-top adjustments
      const selectors = [
        '.resume-section-item',
        '.badge-card',
        '.skill-category-block',
        '.mytime-bar-wrapper',
        '[data-section-item="true"]',
        'h2', 'h3', 'h4',
        'div[key] > div',
        'div[key] > div > div',
        '.resume-experience-entry',
        '.resume-project-entry',
        '.resume-education-entry'
      ].join(', ');

      const candidateElements = Array.from(
        container.querySelectorAll<HTMLElement>(selectors)
      );

      // Filter out container/column wrappers or tiny inline elements
      const items = candidateElements.filter(el => {
        if (!el || el === container) return false;
        const h = el.offsetHeight;
        return h > 12 && h < 750;
      });

      items.forEach(item => {
        item.style.marginTop = '';
      });

      // 2. Measure container bounding box
      const pageHeight = A4_HEIGHT_PX;

      // Perform two sequential passes in DOM top-to-bottom order to handle cumulative layout shifts
      for (let pass = 0; pass < 2; pass++) {
        const containerRect = container.getBoundingClientRect();

        // Sort items by relative top offset
        const sortedItems = [...items].sort((a, b) => {
          return (a.getBoundingClientRect().top - containerRect.top) - (b.getBoundingClientRect().top - containerRect.top);
        });

        sortedItems.forEach(item => {
          const itemRect = item.getBoundingClientRect();
          const relativeTop = itemRect.top - containerRect.top;
          const relativeBottom = relativeTop + itemRect.height;

          const pageIndex = Math.floor(relativeTop / pageHeight);
          const boundary = (pageIndex + 1) * pageHeight;

          // If item starts before page boundary and extends into or beyond boundary (cut off at page end)
          if (relativeTop < boundary && relativeBottom > boundary - 10) {
            const currentMargin = parseFloat(item.style.marginTop || '0');
            const pushDownMargin = currentMargin + (boundary - relativeTop) + 40;
            item.style.marginTop = `${pushDownMargin}px`;
          }
        });
      }

      // 3. Re-calculate overall page count after push down
      const newHeight = container.scrollHeight;
      const pages = Math.max(1, Math.ceil(newHeight / pageHeight));
      setPageCount(pages);
    };

    const timer = setTimeout(adjustPageBreaks, 60);
    const observer = new ResizeObserver(adjustPageBreaks);
    observer.observe(sheetMeasureRef.current);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [resume, style]);

  const getFontFamilyCss = (font: string) => {
    let resolvedFont = font;
    if (resolvedFont === 'Default') {
      resolvedFont = getTemplateDefaultFont(style.templateId);
    }
    switch (resolvedFont) {
      case 'Outfit':
        return "'Outfit', sans-serif";
      case 'Inter':
        return "'Inter', sans-serif";
      case 'Playfair Display':
        return "'Playfair Display', serif";
      case 'Space Mono':
        return "'Space Mono', monospace";
      case 'Plus Jakarta Sans':
        return "'Plus Jakarta Sans', sans-serif";
      default:
        return "'Outfit', sans-serif";
    }
  };

  const getFontSizeScale = (size: string) => {
    switch (size) {
      case 'small':
        return '0.92';
      case 'large':
        return '1.08';
      case 'medium':
      default:
        return '1';
    }
  };

  const getLineHeightCss = (spacing: string) => {
    switch (spacing) {
      case 'compact':
        return '1.25';
      case 'spacious':
        return '1.8';
      case 'normal':
      default:
        return '1.5';
    }
  };

  const renderTemplate = () => {
    switch (style.templateId) {
      case 'boxed_manager':
        return <BoxedManager />;
      case 'executive_serif':
        return <ExecutiveSerif />;
      case 'data_timeline':
        return <DataTimeline />;
      case 'systems_tech':
        return <SystemsTech />;
      case 'pure':
        return <Pure />;
      case 'executive_one':
        return <ExecutiveOne />;
      case 'collegiate':
        return <Collegiate />;
      case 'high_performer':
        return <HighPerformer />;
      case 'enhancv_minimal':
        return <EnhancvMinimal />;
      case 'crest_projects':
        return <CrestProjects />;
      case 'double_column_banking':
        return <DoubleColumnBanking />;
      case 'enhancv_compact':
        return <EnhancvCompact />;
      case 'timeline_tech':
        return <TimelineTech />;
      case 'enhancv_classic':
        return <EnhancvClassic />;
      case 'ivy_league_v2':
        return <IvyLeagueV2 />;
      case 'ivy_league_v3':
        return <IvyLeagueV3 />;
      case 'single_column_v2':
        return <SingleColumnV2 />;
      case 'elegant_v2':
        return <ElegantV2 />;
      case 'enhancv_creative':
        return <EnhancvCreative />;
      case 'enhancv_stylish':
        return <EnhancvStylish />;
      case 'enhancv_modern_v2':
        return <EnhancvModern />;
      case 'enhancv_contemporary':
        return <EnhancvContemporary />;
      case 'single_column':
        return <SingleColumn />;
      case 'polished':
        return <Polished />;
      case 'imprint':
        return <Imprint />;
      case 'timeline':
        return <Timeline />;
      case 'double_column':
        return <DoubleColumn />;
      case 'ivy_league':
        return <IvyLeague />;
      case 'elegant':
        return <Elegant />;
      case 'crest':
        return <Crest />;
      case 'enhancv_modern':
        return <ModernSplit />;
      case 'compact_two_col':
        return <CompactTwoCol />;
      case 'executive_classic':
        return <ExecutiveClassic />;
      case 'creative_banner':
        return <CreativeBanner />;
      default:
        return <BoxedManager />;
    }
  };

  const fontCss = getFontFamilyCss(style.fontFamily);
  const fontScale = getFontSizeScale(style.fontSize);
  const lineHeightValue = getLineHeightCss(style.lineSpacing);

  const calculatedMinHeight = `${Math.max(1, pageCount) * A4_HEIGHT_PX}px`;

  return (
    <div className="preview-canvas-container">
      {/* Top Document Page Badge Indicator (Screen Only) */}
      <div 
        className="no-print"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px',
          borderRadius: '20px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-secondary)',
          fontSize: '0.8rem',
          marginBottom: '20px',
          fontWeight: 600
        }}
      >
        <Layers size={15} color="var(--accent-primary)" />
        <span>Document Layout:</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
          {pageCount} {pageCount === 1 ? 'A4 Page' : 'A4 Pages'}
        </span>
      </div>

      {/* 1. SCREEN VIEW: Dynamic White Paper Sheet */}
      <div 
        ref={sheetMeasureRef}
        className="a4-sheet no-print"
        style={{
          width: '794px',
          minHeight: calculatedMinHeight,
          height: 'max-content',
          backgroundColor: '#ffffff',
          color: '#1e293b',
          boxShadow: 'var(--shadow-sheet)',
          borderRadius: '4px',
          fontFamily: fontCss,
          zoom: fontScale,
          lineHeight: lineHeightValue,
          ['--resume-line-height' as any]: lineHeightValue,
          position: 'relative',
          paddingBottom: '30px'
        }}
      >
        {renderTemplate()}

        {/* Clean Dotted Page Break Indicator Lines (Screen View) */}
        {Array.from({ length: Math.max(0, pageCount - 1) }).map((_, i) => (
          <div
            key={`break-${i}`}
            className="no-print"
            style={{
              position: 'absolute',
              top: `${(i + 1) * A4_HEIGHT_PX}px`,
              left: 0,
              right: 0,
              height: 0,
              borderTop: '2px dotted #94a3b8',
              pointerEvents: 'none',
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <span
              style={{
                backgroundColor: '#ffffff',
                color: '#64748b',
                fontSize: '0.675rem',
                fontWeight: 700,
                padding: '2px 10px',
                borderRadius: '10px',
                border: '1px dotted #94a3b8',
                transform: 'translateY(-50%)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
              }}
            >
              Page {i + 1} / Page {i + 2} Break
            </span>
          </div>
        ))}

        {/* Page Numbering Footer (Screen View - Positioned Right Before Page Ends) */}
        {style.showPageNumbers && Array.from({ length: pageCount }).map((_, i) => (
          <div
            key={i}
            className="no-print"
            style={{
              position: 'absolute',
              top: `${(i + 1) * A4_HEIGHT_PX - 44}px`,
              right: '32px',
              fontSize: '0.825rem',
              color: '#334155',
              fontWeight: 700,
              letterSpacing: '0.03em',
              pointerEvents: 'none',
              background: '#f1f5f9',
              padding: '3px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              zIndex: 25
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* 2. PRINT VIEW: Full Multi-Page Document (Only Visible during Browser Print/Export) */}
      <div 
        className="print-only-container"
        style={{ display: 'none' }}
      >
        <div 
          className="a4-sheet-print"
          style={{
            width: '794px',
            fontFamily: fontCss,
            zoom: fontScale,
            lineHeight: lineHeightValue,
            ['--resume-line-height' as any]: lineHeightValue,
            backgroundColor: '#ffffff',
            color: '#1e293b',
            position: 'relative'
          }}
        >
          {renderTemplate()}

          {style.showPageNumbers && (
            <div
              className="print-page-number-footer"
              style={{
                textAlign: 'right',
                paddingTop: '16px',
                paddingRight: '24px',
                fontSize: '0.8rem',
                color: '#475569',
                fontWeight: 700
              }}
            >
              1
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
