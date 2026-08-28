export type TemplateId = 
  | 'boxed_manager'
  | 'executive_serif'
  | 'data_timeline'
  | 'systems_tech'
  | 'pure'
  | 'executive_one'
  | 'collegiate'
  | 'high_performer'
  | 'enhancv_minimal'
  | 'crest_projects'
  | 'double_column_banking'
  | 'enhancv_compact'
  | 'timeline_tech'
  | 'enhancv_classic'
  | 'ivy_league_v2'
  | 'ivy_league_v3'
  | 'single_column_v2'
  | 'elegant_v2'
  | 'enhancv_creative'
  | 'enhancv_stylish'
  | 'enhancv_modern_v2'
  | 'enhancv_contemporary'
  | 'single_column'
  | 'polished'
  | 'imprint'
  | 'timeline'
  | 'double_column' 
  | 'ivy_league' 
  | 'elegant' 
  | 'crest' 
  | 'enhancv_modern' 
  | 'compact_two_col' 
  | 'executive_classic' 
  | 'creative_banner';

export type FontFamily = 'Default' | 'Inter' | 'Outfit' | 'Playfair Display' | 'Space Mono' | 'Plus Jakarta Sans';

export type FontSize = 'small' | 'medium' | 'large';

export type LineSpacing = 'compact' | 'normal' | 'spacious';

export type PhotoShape = 'square' | 'round' | 'hidden';

export interface PersonalInfo {
  fullName: string;
  jobTitle: string;
  email: string;
  phone: string;
  location: string;
  website?: string;
  linkedin?: string;
  github?: string;
  photoUrl?: string;
  summary: string;
}

export interface WorkExperience {
  id: string;
  company: string;
  position: string;
  location?: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  startDate: string;
  endDate: string;
  gpa?: string;
}

export interface Skill {
  id: string;
  name: string;
  category?: string;
  proficiency?: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
}

export interface MyTimeItem {
  id: string;
  label: string;
  percentage: number;
  color: string;
}

export interface MostProudOfItem {
  id: string;
  title: string;
  description: string;
  icon: 'trophy' | 'rocket' | 'target' | 'star' | 'award' | 'zap' | 'heart' | 'flame';
}

export interface PhilosophyItem {
  quote: string;
  author: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  technologies: string;
  link?: string;
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  url?: string;
}

export interface Publication {
  id: string;
  title: string;
  publisher?: string;
  date?: string;
  url?: string;
  description?: string;
}

export interface SectionVisibility {
  photo: boolean;
  summary: boolean;
  experience: boolean;
  education: boolean;
  skills: boolean;
  myTime: boolean;
  mostProudOf: boolean;
  philosophy: boolean;
  projects: boolean;
  certifications: boolean;
  publications: boolean;
}

export type SectionKey = 
  | 'summary' 
  | 'experience' 
  | 'education' 
  | 'skills' 
  | 'myTime' 
  | 'mostProudOf' 
  | 'philosophy' 
  | 'projects' 
  | 'certifications'
  | 'publications';

export interface ResumeStyle {
  templateId: TemplateId;
  fontFamily: FontFamily;
  accentColor: string;
  secondaryColor: string;
  fontSize: FontSize;
  lineSpacing: LineSpacing;
  photoShape: PhotoShape;
  showPageNumbers?: boolean;
}

export interface ResumeData {
  id: string;
  title: string;
  personal: PersonalInfo;
  experiences: WorkExperience[];
  educations: Education[];
  skills: Skill[];
  myTime: MyTimeItem[];
  mostProudOf: MostProudOfItem[];
  philosophy: PhilosophyItem;
  projects: Project[];
  certifications: Certification[];
  publications: Publication[];
  sectionVisibility: SectionVisibility;
  sectionOrder: SectionKey[];
  style: ResumeStyle;
  updatedAt: string;
}

export interface ResumeScore {
  score: number; // 0 to 100
  breakdown: {
    contactCompleteness: number; // out of 20
    summaryQuality: number; // out of 20
    actionVerbs: number; // out of 20
    quantifiableMetrics: number; // out of 20
    visualHighlights: number; // out of 20
  };
  suggestions: {
    id: string;
    type: 'warning' | 'tip' | 'success';
    message: string;
  }[];
}

export function getTemplateDefaultFont(templateId: TemplateId): 'Inter' | 'Outfit' | 'Playfair Display' {
  switch (templateId) {
    case 'executive_serif':
    case 'pure':
    case 'executive_one':
    case 'crest':
    case 'crest_projects':
    case 'imprint':
    case 'ivy_league_v3':
      return 'Playfair Display';
    case 'systems_tech':
    case 'data_timeline':
    case 'boxed_manager':
    case 'collegiate':
    case 'ivy_league':
    case 'ivy_league_v2':
    case 'single_column':
    case 'single_column_v2':
    case 'polished':
    case 'timeline':
    case 'timeline_tech':
    case 'double_column_banking':
    case 'enhancv_compact':
    case 'enhancv_classic':
    case 'enhancv_minimal':
    case 'high_performer':
      return 'Inter';
    default:
      return 'Outfit';
  }
}
