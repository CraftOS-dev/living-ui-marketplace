import { getPbClient, toast } from '../../kit/index.ts';
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ResumeData, ResumeScore, SectionKey, SectionVisibility, ResumeStyle } from '../types/resume';
import { INITIAL_RESUME, PRESETS } from '../data/presets';
import { calculateResumeScore } from '../utils/scoreCalculator';
import { generateRandomCandidate } from '../utils/randomCandidateGenerator';

interface ResumeContextType {
  resumes: ResumeData[];
  activeResumeId: string;
  resume: ResumeData;
  score: ResumeScore;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  createResume: (title?: string) => void;
  duplicateResume: (idToDuplicate?: string) => void;
  switchResume: (id: string) => void;
  deleteResume: (id: string) => void;
  renameResume: (id: string, newTitle: string) => void;
  updatePersonal: (data: Partial<ResumeData['personal']>) => void;
  updateStyle: (style: Partial<ResumeStyle>) => void;
  updateSectionVisibility: (key: keyof SectionVisibility, visible: boolean) => void;
  updateSectionOrder: (newOrder: SectionKey[]) => void;
  addExperience: () => void;
  updateExperience: (id: string, data: Partial<ResumeData['experiences'][0]>) => void;
  removeExperience: (id: string) => void;
  addEducation: () => void;
  updateEducation: (id: string, data: Partial<ResumeData['educations'][0]>) => void;
  removeEducation: (id: string) => void;
  addSkill: (name?: string, category?: string) => void;
  updateSkill: (id: string, data: Partial<ResumeData['skills'][0]>) => void;
  removeSkill: (id: string) => void;
  addMyTimeItem: () => void;
  updateMyTimeItem: (id: string, data: Partial<ResumeData['myTime'][0]>) => void;
  removeMyTimeItem: (id: string) => void;
  addMostProudOfItem: () => void;
  updateMostProudOfItem: (id: string, data: Partial<ResumeData['mostProudOf'][0]>) => void;
  removeMostProudOfItem: (id: string) => void;
  updatePhilosophy: (quote: string, author?: string) => void;
  addProject: () => void;
  updateProject: (id: string, data: Partial<ResumeData['projects'][0]>) => void;
  removeProject: (id: string) => void;
  addCertification: () => void;
  updateCertification: (id: string, data: Partial<ResumeData['certifications'][0]>) => void;
  removeCertification: (id: string) => void;
  addPublication: () => void;
  updatePublication: (id: string, data: Partial<ResumeData['publications'][0]>) => void;
  removePublication: (id: string) => void;
  updateInlineField: (path: string, value: string) => void;
  loadPreset: (presetKey: string) => void;
  exportJson: () => void;
  importJson: (jsonString: string) => boolean;
  resetToDefault: () => void;
}

const ResumeContext = createContext<ResumeContextType | undefined>(undefined);

const LOCAL_STORAGE_LIST_KEY = 'living_resume_maker_list_v2';
const LOCAL_STORAGE_ACTIVE_KEY = 'living_resume_maker_active_v2';

export const ResumeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [resumes, setResumes] = useState<ResumeData[]>(() => {
    const savedList = localStorage.getItem(LOCAL_STORAGE_LIST_KEY);
    if (savedList) {
      try {
        const parsed = JSON.parse(savedList);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(r => ({
            ...INITIAL_RESUME,
            ...r,
            personal: { ...INITIAL_RESUME.personal, ...(r.personal || {}) },
            experiences: Array.isArray(r.experiences) ? r.experiences : INITIAL_RESUME.experiences,
            educations: Array.isArray(r.educations) ? r.educations : INITIAL_RESUME.educations,
            skills: Array.isArray(r.skills) ? r.skills : INITIAL_RESUME.skills,
            myTime: Array.isArray(r.myTime) ? r.myTime : INITIAL_RESUME.myTime,
            mostProudOf: Array.isArray(r.mostProudOf) ? r.mostProudOf : INITIAL_RESUME.mostProudOf,
            philosophy: r.philosophy && typeof r.philosophy === 'object' ? { ...INITIAL_RESUME.philosophy, ...r.philosophy } : INITIAL_RESUME.philosophy,
            projects: Array.isArray(r.projects) ? r.projects : INITIAL_RESUME.projects,
            certifications: Array.isArray(r.certifications) ? r.certifications : INITIAL_RESUME.certifications,
            publications: Array.isArray(r.publications) ? r.publications : (INITIAL_RESUME.publications || []),
            sectionVisibility: { ...INITIAL_RESUME.sectionVisibility, ...(r.sectionVisibility || {}) },
            sectionOrder: Array.isArray(r.sectionOrder) ? r.sectionOrder : INITIAL_RESUME.sectionOrder,
            style: { ...INITIAL_RESUME.style, ...(r.style || {}), showPageNumbers: false }
          }));
        }
      } catch (e) {
        console.error('Failed to parse cached resumes list', e);
      }
    }
    return [{ ...INITIAL_RESUME, id: 'resume-1', title: 'Software Engineer Resume' }];
  });

  // Load from PocketBase on mount
  useEffect(() => {
    let active = true;
    const fetchPbResumes = async () => {
      try {
        const records = await getPbClient().call((pb) =>
          pb.collection('resume_state').getFullList({ sort: '-created' })
        );
        if (!active || !records || records.length === 0) return;
        
        const loaded: ResumeData[] = [];
        for (const rec of records) {
          if (rec.data && typeof rec.data === 'object' && rec.data.personal) {
            loaded.push({
              ...INITIAL_RESUME,
              ...rec.data,
              personal: { ...INITIAL_RESUME.personal, ...(rec.data.personal || {}) },
              experiences: Array.isArray(rec.data.experiences) ? rec.data.experiences : INITIAL_RESUME.experiences,
              educations: Array.isArray(rec.data.educations) ? rec.data.educations : INITIAL_RESUME.educations,
              skills: Array.isArray(rec.data.skills) ? rec.data.skills : INITIAL_RESUME.skills,
              myTime: Array.isArray(rec.data.myTime) ? rec.data.myTime : INITIAL_RESUME.myTime,
              mostProudOf: Array.isArray(rec.data.mostProudOf) ? rec.data.mostProudOf : INITIAL_RESUME.mostProudOf,
              philosophy: rec.data.philosophy && typeof rec.data.philosophy === 'object' ? { ...INITIAL_RESUME.philosophy, ...rec.data.philosophy } : INITIAL_RESUME.philosophy,
              projects: Array.isArray(rec.data.projects) ? rec.data.projects : INITIAL_RESUME.projects,
              certifications: Array.isArray(rec.data.certifications) ? rec.data.certifications : INITIAL_RESUME.certifications,
              publications: Array.isArray(rec.data.publications) ? rec.data.publications : (INITIAL_RESUME.publications || []),
              sectionVisibility: { ...INITIAL_RESUME.sectionVisibility, ...(rec.data.sectionVisibility || {}) },
              sectionOrder: Array.isArray(rec.data.sectionOrder) ? rec.data.sectionOrder : INITIAL_RESUME.sectionOrder,
              style: { ...INITIAL_RESUME.style, ...(rec.data.style || {}) },
              id: rec.id,
              title: rec.title || rec.data.title || 'Resume'
            });
          }
        }
        if (loaded.length > 0) {
          setResumes(loaded);
          if (!loaded.some(r => r.id === activeResumeId)) {
            setActiveResumeId(loaded[0]!.id);
          }
        }
      } catch {
        // Fallback to localStorage / initial data
      }
    };
    void fetchPbResumes();
    return () => { active = false; };
  }, []);

  const [activeResumeId, setActiveResumeId] = useState<string>(() => {
    const savedActive = localStorage.getItem(LOCAL_STORAGE_ACTIVE_KEY);
    if (savedActive && resumes.some(r => r.id === savedActive)) {
      return savedActive;
    }
    return resumes[0]?.id || 'resume-1';
  });

  const [activeTab, setActiveTab] = useState<string>('personal');

  // Derive active resume
  const activeResume = resumes.find(r => r.id === activeResumeId) || resumes[0] || INITIAL_RESUME;

  // Auto-save resumes list to localStorage
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_LIST_KEY, JSON.stringify(resumes));
  }, [resumes]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_ACTIVE_KEY, activeResumeId);
  }, [activeResumeId]);

  // Sync active resume changes to PocketBase (debounced)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!activeResume || !activeResume.id) return;
      try {
        await getPbClient().call(async (pb) => {
          try {
            // Update by key or id
            const existing = await pb.collection('resume_state').getFirstListItem(`key = "${activeResume.id}"`);
            await pb.collection('resume_state').update(existing.id, {
              data: activeResume
            });
          } catch {
            // Create if missing
            await pb.collection('resume_state').create({
              key: activeResume.id,
              data: activeResume
            });
          }
        }, { silent: true });
      } catch {}
    }, 600);
    return () => clearTimeout(timer);
  }, [activeResume]);


  const score = calculateResumeScore(activeResume);

  const updateActiveResume = (updater: (prev: ResumeData) => ResumeData) => {
    setResumes(prevList =>
      prevList.map(item =>
        item.id === activeResumeId ? updater(item) : item
      )
    );
  };

  const createResume = (customTitle?: string) => {
    const newResume = generateRandomCandidate(customTitle);
    setResumes(prev => [...prev, newResume]);
    setActiveResumeId(newResume.id);
  };

  const switchResume = (id: string) => {
    if (resumes.some(r => r.id === id)) {
      setActiveResumeId(id);
    }
  };

  const deleteResume = (id: string) => {
    if (resumes.length <= 1) {
      // If deleting the last resume, replace with clean default instance
      const defaultResume = { ...INITIAL_RESUME, id: `resume-${Date.now()}`, title: 'Software Engineer Resume' };
      setResumes([defaultResume]);
      setActiveResumeId(defaultResume.id);
      return;
    }

    const remaining = resumes.filter(r => r.id !== id);
    setResumes(remaining);
    if (activeResumeId === id) {
      setActiveResumeId(remaining[0]?.id || '');
    }
  };

  const renameResume = (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    setResumes(prev =>
      prev.map(r => (r.id === id ? { ...r, title: newTitle.trim(), updatedAt: new Date().toISOString() } : r))
    );
  };

  const duplicateResume = (idToDuplicate?: string) => {
    const targetId = idToDuplicate || activeResumeId;
    const targetResume = resumes.find(r => r.id === targetId) || activeResume;
    if (!targetResume) return;

    const baseTitle = targetResume.title || targetResume.personal.fullName || 'Resume';
    const newTitle = `${baseTitle} Duplicate`;
    const newId = `resume-${Date.now()}`;

    const newResume: ResumeData = {
      ...JSON.parse(JSON.stringify(targetResume)),
      id: newId,
      title: newTitle,
      updatedAt: new Date().toISOString()
    };

    setResumes(prev => [...prev, newResume]);
    setActiveResumeId(newId);
  };

  const updatePersonal = (data: Partial<ResumeData['personal']>) => {
    updateActiveResume(prev => ({
      ...prev,
      personal: { ...prev.personal, ...data },
      updatedAt: new Date().toISOString()
    }));
  };

  const updateStyle = (style: Partial<ResumeStyle>) => {
    updateActiveResume(prev => ({
      ...prev,
      style: { ...prev.style, ...style },
      updatedAt: new Date().toISOString()
    }));
  };

  const updateSectionVisibility = (key: keyof SectionVisibility, visible: boolean) => {
    updateActiveResume(prev => ({
      ...prev,
      sectionVisibility: { ...prev.sectionVisibility, [key]: visible },
      updatedAt: new Date().toISOString()
    }));
  };

  const updateSectionOrder = (newOrder: SectionKey[]) => {
    updateActiveResume(prev => ({
      ...prev,
      sectionOrder: newOrder,
      updatedAt: new Date().toISOString()
    }));
  };

  const addExperience = () => {
    const newExp = {
      id: `exp-${Date.now()}`,
      company: 'New Company',
      position: 'Role / Title',
      startDate: '2023',
      endDate: 'Present',
      isCurrent: true,
      description: '• Spearheaded project development, increasing performance metrics by 25%.'
    };
    updateActiveResume(prev => ({
      ...prev,
      experiences: [newExp, ...prev.experiences],
      updatedAt: new Date().toISOString()
    }));
  };

  const updateExperience = (id: string, data: Partial<ResumeData['experiences'][0]>) => {
    updateActiveResume(prev => ({
      ...prev,
      experiences: prev.experiences.map(item => item.id === id ? { ...item, ...data } : item),
      updatedAt: new Date().toISOString()
    }));
  };

  const removeExperience = (id: string) => {
    updateActiveResume(prev => ({
      ...prev,
      experiences: prev.experiences.filter(item => item.id !== id),
      updatedAt: new Date().toISOString()
    }));
  };

  const addEducation = () => {
    const newEdu = {
      id: `edu-${Date.now()}`,
      institution: 'University Name',
      degree: 'B.S. Degree',
      startDate: '2018',
      endDate: '2022'
    };
    updateActiveResume(prev => ({
      ...prev,
      educations: [newEdu, ...prev.educations],
      updatedAt: new Date().toISOString()
    }));
  };

  const updateEducation = (id: string, data: Partial<ResumeData['educations'][0]>) => {
    updateActiveResume(prev => ({
      ...prev,
      educations: prev.educations.map(item => item.id === id ? { ...item, ...data } : item),
      updatedAt: new Date().toISOString()
    }));
  };

  const removeEducation = (id: string) => {
    updateActiveResume(prev => ({
      ...prev,
      educations: prev.educations.filter(item => item.id !== id),
      updatedAt: new Date().toISOString()
    }));
  };

  const addSkill = (name = 'New Skill', category = 'General') => {
    const newSkill = {
      id: `sk-${Date.now()}`,
      name,
      category,
      proficiency: 'Advanced' as const
    };
    updateActiveResume(prev => ({
      ...prev,
      skills: [...prev.skills, newSkill],
      updatedAt: new Date().toISOString()
    }));
  };

  const updateSkill = (id: string, data: Partial<ResumeData['skills'][0]>) => {
    updateActiveResume(prev => ({
      ...prev,
      skills: prev.skills.map(item => item.id === id ? { ...item, ...data } : item),
      updatedAt: new Date().toISOString()
    }));
  };

  const removeSkill = (id: string) => {
    updateActiveResume(prev => ({
      ...prev,
      skills: prev.skills.filter(item => item.id !== id),
      updatedAt: new Date().toISOString()
    }));
  };

  const addMyTimeItem = () => {
    const defaultColors = ['#f97316', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
    const color = defaultColors[activeResume.myTime.length % defaultColors.length] || '#f97316';
    const newItem = {
      id: `mt-${Date.now()}`,
      label: 'New Activity Focus',
      percentage: 15,
      color
    };
    updateActiveResume(prev => ({
      ...prev,
      myTime: [...prev.myTime, newItem],
      updatedAt: new Date().toISOString()
    }));
  };

  const updateMyTimeItem = (id: string, data: Partial<ResumeData['myTime'][0]>) => {
    updateActiveResume(prev => ({
      ...prev,
      myTime: prev.myTime.map(item => item.id === id ? { ...item, ...data } : item),
      updatedAt: new Date().toISOString()
    }));
  };

  const removeMyTimeItem = (id: string) => {
    updateActiveResume(prev => ({
      ...prev,
      myTime: prev.myTime.filter(item => item.id !== id),
      updatedAt: new Date().toISOString()
    }));
  };

  const addMostProudOfItem = () => {
    const newItem = {
      id: `mp-${Date.now()}`,
      title: 'Key Achievement',
      description: 'Describe impact or quantifiable outcome achieved.',
      icon: 'trophy' as const
    };
    updateActiveResume(prev => ({
      ...prev,
      mostProudOf: [...prev.mostProudOf, newItem],
      updatedAt: new Date().toISOString()
    }));
  };

  const updateMostProudOfItem = (id: string, data: Partial<ResumeData['mostProudOf'][0]>) => {
    updateActiveResume(prev => ({
      ...prev,
      mostProudOf: prev.mostProudOf.map(item => item.id === id ? { ...item, ...data } : item),
      updatedAt: new Date().toISOString()
    }));
  };

  const removeMostProudOfItem = (id: string) => {
    updateActiveResume(prev => ({
      ...prev,
      mostProudOf: prev.mostProudOf.filter(item => item.id !== id),
      updatedAt: new Date().toISOString()
    }));
  };

  const updatePhilosophy = (quote: string, author?: string) => {
    updateActiveResume(prev => ({
      ...prev,
      philosophy: { quote, author: author || prev.personal.fullName },
      updatedAt: new Date().toISOString()
    }));
  };

  const addProject = () => {
    const newProj = {
      id: `proj-${Date.now()}`,
      title: 'Project Title',
      description: 'Brief description of project goal and architectural design.',
      technologies: 'React, TypeScript'
    };
    updateActiveResume(prev => ({
      ...prev,
      projects: [...prev.projects, newProj],
      updatedAt: new Date().toISOString()
    }));
  };

  const updateProject = (id: string, data: Partial<ResumeData['projects'][0]>) => {
    updateActiveResume(prev => ({
      ...prev,
      projects: prev.projects.map(item => item.id === id ? { ...item, ...data } : item),
      updatedAt: new Date().toISOString()
    }));
  };

  const removeProject = (id: string) => {
    updateActiveResume(prev => ({
      ...prev,
      projects: prev.projects.filter(item => item.id !== id),
      updatedAt: new Date().toISOString()
    }));
  };

  const addCertification = () => {
    const newCert = {
      id: `cert-${Date.now()}`,
      name: 'Certification Name',
      issuer: 'Issuing Organization',
      issueDate: '2023'
    };
    updateActiveResume(prev => ({
      ...prev,
      certifications: [...prev.certifications, newCert],
      updatedAt: new Date().toISOString()
    }));
  };

  const updateCertification = (id: string, data: Partial<ResumeData['certifications'][0]>) => {
    updateActiveResume(prev => ({
      ...prev,
      certifications: prev.certifications.map(item => item.id === id ? { ...item, ...data } : item),
      updatedAt: new Date().toISOString()
    }));
  };

  const removeCertification = (id: string) => {
    updateActiveResume(prev => ({
      ...prev,
      certifications: prev.certifications.filter(item => item.id !== id),
      updatedAt: new Date().toISOString()
    }));
  };

  const addPublication = () => {
    const newPub = {
      id: `pub-${Date.now()}`,
      title: 'Publication Title',
      publisher: 'Publisher / Journal',
      date: '2024',
      url: '',
      description: 'Brief description of the published work or research.'
    };
    updateActiveResume(prev => ({
      ...prev,
      publications: [...(prev.publications || []), newPub],
      updatedAt: new Date().toISOString()
    }));
  };

  const updatePublication = (id: string, data: Partial<ResumeData['publications'][0]>) => {
    updateActiveResume(prev => ({
      ...prev,
      publications: (prev.publications || []).map(item => item.id === id ? { ...item, ...data } : item),
      updatedAt: new Date().toISOString()
    }));
  };

  const removePublication = (id: string) => {
    updateActiveResume(prev => ({
      ...prev,
      publications: (prev.publications || []).filter(item => item.id !== id),
      updatedAt: new Date().toISOString()
    }));
  };

  // Generic direct in-canvas editor helper
  const updateInlineField = (path: string, value: string) => {
    const parts = path.split('.');
    const p0 = parts[0] ?? '';
    const p1 = parts[1] ?? '';
    const p2 = parts[2] ?? '';
    if (p0 === 'personal' && p1) {
      updatePersonal({ [p1]: value });
    } else if (p0 === 'philosophy') {
      updatePhilosophy(p1 === 'quote' ? value : activeResume.philosophy.quote, p1 === 'author' ? value : activeResume.philosophy.author);
    } else if (p0 === 'experience' && p1 && p2) {
      updateExperience(p1, { [p2]: value });
    } else if (p0 === 'education' && p1 && p2) {
      updateEducation(p1, { [p2]: value });
    } else if (p0 === 'mostProudOf' && p1 && p2) {
      updateMostProudOfItem(p1, { [p2]: value });
    } else if (p0 === 'myTime' && p1 && p2) {
      updateMyTimeItem(p1, { [p2]: p2 === 'percentage' ? Number(value) : value });
    } else if (p0 === 'project' && p1 && p2) {
      updateProject(p1, { [p2]: value });
    } else if (p0 === 'publication' && p1 && p2) {
      updatePublication(p1, { [p2]: value });
    }
  };

  const loadPreset = (presetKey: string) => {
    const targetPreset = PRESETS[presetKey];
    if (targetPreset) {
      updateActiveResume(prev => ({ ...prev, ...targetPreset.data, updatedAt: new Date().toISOString() }));
    }
  };

  const exportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeResume, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${activeResume.personal.fullName.replace(/\s+/g, '_')}_Resume.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const importJson = (jsonString: string): boolean => {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && (parsed.personal || parsed.experiences || parsed.title)) {
        const newId = `resume-${Date.now()}`;
        const importedTitle = parsed.title || (parsed.personal?.fullName ? `${parsed.personal.fullName} Resume` : 'Imported Resume');
        
        const newResume: ResumeData = {
          ...INITIAL_RESUME,
          ...parsed,
          id: newId,
          title: importedTitle,
          updatedAt: new Date().toISOString()
        };

        setResumes(prev => [...prev, newResume]);
        setActiveResumeId(newId);
        return true;
      }
    } catch (e) {
      console.error('Import invalid JSON format', e);
    }
    return false;
  };

  const resetToDefault = () => {
    updateActiveResume(() => ({ ...INITIAL_RESUME, id: activeResumeId }));
  };

  return (
    <ResumeContext.Provider
      value={{
        resumes,
        activeResumeId,
        resume: activeResume,
        score,
        activeTab,
        setActiveTab,
        createResume,
        duplicateResume,
        switchResume,
        deleteResume,
        renameResume,
        updatePersonal,
        updateStyle,
        updateSectionVisibility,
        updateSectionOrder,
        addExperience,
        updateExperience,
        removeExperience,
        addEducation,
        updateEducation,
        removeEducation,
        addSkill,
        updateSkill,
        removeSkill,
        addMyTimeItem,
        updateMyTimeItem,
        removeMyTimeItem,
        addMostProudOfItem,
        updateMostProudOfItem,
        removeMostProudOfItem,
        updatePhilosophy,
        addProject,
        updateProject,
        removeProject,
        addCertification,
        updateCertification,
        removeCertification,
        addPublication,
        updatePublication,
        removePublication,
        updateInlineField,
        loadPreset,
        exportJson,
        importJson,
        resetToDefault,
      }}
    >
      {children}
    </ResumeContext.Provider>
  );
};

export const useResume = () => {
  const context = useContext(ResumeContext);
  if (!context) {
    throw new Error('useResume must be used within a ResumeProvider');
  }
  return context;
};
