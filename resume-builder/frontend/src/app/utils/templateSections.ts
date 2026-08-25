import { TemplateId, SectionKey } from '../types/resume';

export function getTemplateSupportedSections(templateId: TemplateId): Record<SectionKey, boolean> {
  switch (templateId) {
    // 1. Templates that support all sections including MyTime & Philosophy
    case 'enhancv_modern':
    case 'enhancv_classic':
    case 'compact_two_col':
    case 'creative_banner':
    case 'double_column':
    case 'double_column_banking':
    case 'elegant':
    case 'elegant_v2':
    case 'enhancv_compact':
    case 'enhancv_contemporary':
    case 'enhancv_creative':
    case 'enhancv_minimal':
    case 'enhancv_stylish':
    case 'executive_classic':
    case 'executive_serif':
    case 'boxed_manager':
    case 'collegiate':
    case 'crest':
    case 'data_timeline':
    case 'polished':
      return {
        summary: true,
        experience: true,
        education: true,
        skills: true,
        mostProudOf: true,
        myTime: true,
        philosophy: true,
        projects: true,
        certifications: true,
        publications: true
      };

    // 2. Traditional single-column & tech templates that omit MyTime & Philosophy by design
    // (Shows with crossed eye icon by default in Layout)
    case 'pure':
    case 'executive_one':
    case 'ivy_league':
    case 'ivy_league_v2':
    case 'ivy_league_v3':
    case 'imprint':
    case 'single_column':
    case 'single_column_v2':
    case 'systems_tech':
    case 'high_performer':
    case 'timeline':
    case 'timeline_tech':
    case 'crest_projects':
    default:
      return {
        summary: true,
        experience: true,
        education: true,
        skills: true,
        mostProudOf: true,
        myTime: false,       // Omitted -> Red Cross Eye by default
        philosophy: false,   // Omitted -> Red Cross Eye by default
        projects: true,      // Included in ALL templates
        certifications: true, // Included in ALL templates
        publications: true   // Included in ALL templates
      };
  }
}
