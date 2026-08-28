import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { User, Briefcase, GraduationCap, Code2, PieChart, Trophy, Quote, FolderGit2, Award, BookOpen, Eye } from 'lucide-react';

const TABS = [
  { id: 'personal', label: 'Personal', icon: User },
  { id: 'experience', label: 'Experience', icon: Briefcase },
  { id: 'education', label: 'Education', icon: GraduationCap },
  { id: 'skills', label: 'Skills', icon: Code2 },
  { id: 'myTime', label: 'My Time', icon: PieChart },
  { id: 'mostProudOf', label: 'Achievements', icon: Trophy },
  { id: 'philosophy', label: 'Philosophy', icon: Quote },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'certifications', label: 'Certs', icon: Award },
  { id: 'publications', label: 'Papers', icon: BookOpen },
  { id: 'visibility', label: 'Layout', icon: Eye },
];

export const EditorTabs: React.FC = () => {
  const { activeTab, setActiveTab } = useResume();

  return (
    <div className="editor-tabs no-print">
      {TABS.map(tab => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            className={`editor-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <Icon size={14} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
