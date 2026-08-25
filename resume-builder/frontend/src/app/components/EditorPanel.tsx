import React from 'react';
import { useResume } from '../context/ResumeContext';
import { EditorTabs } from './Editor/EditorTabs';
import { PersonalForm } from './Editor/PersonalForm';
import { ExperienceForm } from './Editor/ExperienceForm';
import { EducationForm } from './Editor/EducationForm';
import { SkillsForm } from './Editor/SkillsForm';
import { MyTimeForm } from './Editor/MyTimeForm';
import { MostProudOfForm } from './Editor/MostProudOfForm';
import { PhilosophyForm } from './Editor/PhilosophyForm';
import { ProjectsForm } from './Editor/ProjectsForm';
import { CertificationsForm } from './Editor/CertificationsForm';
import { PublicationsForm } from './Editor/PublicationsForm';
import { VisibilityForm } from './Editor/VisibilityForm';

export const EditorPanel: React.FC = () => {
  const { activeTab } = useResume();

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'personal':
        return <PersonalForm />;
      case 'experience':
        return <ExperienceForm />;
      case 'education':
        return <EducationForm />;
      case 'skills':
        return <SkillsForm />;
      case 'myTime':
        return <MyTimeForm />;
      case 'mostProudOf':
        return <MostProudOfForm />;
      case 'philosophy':
        return <PhilosophyForm />;
      case 'projects':
        return <ProjectsForm />;
      case 'certifications':
        return <CertificationsForm />;
      case 'publications':
        return <PublicationsForm />;
      case 'visibility':
        return <VisibilityForm />;
      default:
        return <PersonalForm />;
    }
  };

  return (
    <aside className="editor-sidebar no-print">
      <EditorTabs />
      <div className="editor-tab-content">
        {renderActiveTab()}
      </div>
    </aside>
  );
};
