/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed initial resume data so state is available on first launch.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId('resume_state');
  const record = new Record(collection);
  record.set('key', 'default_resume');
  record.set('data', {
    id: 'resume-1',
    title: 'Senior Software Engineer CV',
    personal: {
      fullName: 'Alex River',
      jobTitle: 'Senior Staff Frontend Architect',
      email: 'alex.river@devmail.io',
      phone: '+1 (512) 849-2041',
      location: 'San Francisco, CA (Open to Remote)',
      website: 'https://alexriver.dev',
      linkedin: 'linkedin.com/in/alex-river-dev',
      github: 'github.com/alexriver',
      photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
      summary: 'High-impact Software Architect with 8+ years experience architecting real-time collaboration engines, high-throughput micro-frontends, and design systems serving over 12M active monthly users.'
    },
    experiences: [
      {
        id: 'exp-1',
        company: 'Apex Cloud Systems',
        position: 'Staff Frontend Engineer & Tech Lead',
        location: 'San Francisco, CA',
        startDate: 'Jan 2022',
        endDate: 'Present',
        isCurrent: true,
        description: '• Spearheaded architectural migration of core React Dashboard to Vite & Module Federation, reducing build times by 68% and bundle size by 1.4MB.\n• Engineered real-time collaborative canvas using WebSockets & CRDTs, boosting team productivity metrics by 42% across 350+ enterprise accounts.'
      }
    ],
    educations: [
      {
        id: 'edu-1',
        institution: 'University of Texas at Austin',
        degree: 'B.S. in Computer Science',
        startDate: 'Sep 2012',
        endDate: 'May 2016',
        gpa: '3.91 / 4.0'
      }
    ],
    skills: [
      { id: 'sk-1', name: 'TypeScript & JavaScript', category: 'Programming Languages', proficiency: 'Expert' },
      { id: 'sk-2', name: 'React 18 & Node.js', category: 'Technical Skills', proficiency: 'Expert' }
    ],
    certifications: [
      {
        id: 'cert-1',
        name: 'AWS Certified Solutions Architect',
        issuer: 'Amazon Web Services',
        issueDate: '2023',
        url: 'https://aws.amazon.com/verification'
      }
    ],
    projects: [
      {
        id: 'proj-1',
        title: 'LiveCanvas Engine',
        description: 'Open-source state synchronization library using WebSockets and IndexedDB caching.',
        technologies: 'TypeScript, WebSockets, Web Workers',
        link: 'https://github.com/alexriver/live-canvas'
      }
    ],
    sectionVisibility: {
      photo: true,
      summary: true,
      experience: true,
      education: true,
      skills: true,
      myTime: true,
      mostProudOf: true,
      philosophy: true,
      projects: true,
      certifications: true,
      publications: true
    },
    sectionOrder: ['summary', 'experience', 'myTime', 'mostProudOf', 'skills', 'projects', 'education', 'philosophy', 'certifications', 'publications'],
    style: {
      templateId: 'enhancv_modern',
      fontFamily: 'Outfit',
      accentColor: '#6366f1',
      secondaryColor: '#ec4899',
      fontSize: 'medium',
      lineSpacing: 'normal',
      photoShape: 'round',
      showPageNumbers: false
    }
  });

  app.save(record);
}, (app) => {
  try {
    const records = app.findRecordsByFilter('resume_state', 'key = "default_resume"');
    for (let record of records) {
      app.delete(record);
    }
  } catch {}
});
