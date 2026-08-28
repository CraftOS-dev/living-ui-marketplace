import type { ResumeData } from '../types/resume';

export const INITIAL_RESUME: ResumeData = {
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
    summary: 'High-impact Software Architect with 8+ years experience architecting real-time collaboration engines, high-throughput micro-frontends, and design systems serving over 12M active monthly users. Passionate about developer tooling, performance engineering (<50ms initial load), and user-centric UX.',
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
      description: '• Spearheaded architectural migration of core React Dashboard to Vite & Module Federation, reducing build times by 68% and bundle size by 1.4MB.\n• Engineered real-time collaborative canvas using WebSockets & CRDTs, boosting team productivity metrics by 42% across 350+ enterprise accounts.\n• Mentored 12 frontend engineers, established automated CI/CD performance regression gates, and maintained 99.98% uptime for customer-facing portals.',
    },
    {
      id: 'exp-2',
      company: 'Pulse Analytics Inc.',
      position: 'Senior Full-Stack Engineer',
      location: 'Austin, TX',
      startDate: 'Mar 2019',
      endDate: 'Dec 2021',
      isCurrent: false,
      description: '• Built high-performance data visualization library in D3.js and WebGL, processing 5M+ daily event logs with sub-16ms frame rendering rates.\n• Reduced API latencies by 35% through Redis caching strategies and optimized GraphQL queries.\n• Co-authored open-source UI component library adopted across 14 internal product verticals.',
    },
    {
      id: 'exp-3',
      company: 'Veloce Digital Agency',
      position: 'UI/UX Developer',
      location: 'Austin, TX',
      startDate: 'Jun 2016',
      endDate: 'Feb 2019',
      isCurrent: false,
      description: '• Delivered 20+ responsive web applications for Fortune 500 clients with strict accessibility (WCAG 2.1 AA) compliance.\n• Increased mobile client conversion rates by 28% through interactive prototype usability testing.',
    }
  ],
  educations: [
    {
      id: 'edu-1',
      institution: 'University of Texas at Austin',
      degree: 'B.S. in Computer Science & Human-Computer Interaction',
      fieldOfStudy: 'Computer Science',
      startDate: 'Sep 2012',
      endDate: 'May 2016',
      gpa: '3.91 / 4.0 (Magna Cum Laude)',
    }
  ],
  skills: [
    { id: 'sk-1', name: 'TypeScript, JavaScript & Python', category: 'Programming Languages', proficiency: 'Expert' },
    { id: 'sk-2', name: 'React 18, Next.js & Node.js', category: 'Technical Skills', proficiency: 'Expert' },
    { id: 'sk-3', name: 'GraphQL & System Architecture', category: 'Technical Skills', proficiency: 'Advanced' },
    { id: 'sk-4', name: 'Docker, Git, AWS & Vite', category: 'Programs & Tools', proficiency: 'Expert' },
    { id: 'sk-5', name: 'Team Leadership & Engineering Mentorship', category: 'Interpersonal Skills', proficiency: 'Expert' },
    { id: 'sk-6', name: 'Cross-Functional Collaboration', category: 'Interpersonal Skills', proficiency: 'Advanced' }
  ],
  myTime: [
    { id: 'mt-1', label: 'Architecture & System Design', percentage: 35, color: '#6366f1' },
    { id: 'mt-2', label: 'Hands-on Coding & Code Reviews', percentage: 30, color: '#ec4899' },
    { id: 'mt-3', label: 'Team Mentorship & Tech Specs', percentage: 20, color: '#10b981' },
    { id: 'mt-4', label: 'Performance Optimization & R&D', percentage: 15, color: '#f59e0b' }
  ],
  mostProudOf: [
    {
      id: 'mp-1',
      title: '68% Build Time Cut',
      description: 'Architected modular build pipeline saving 450+ engineering hours annually across 8 product teams.',
      icon: 'rocket'
    },
    {
      id: 'mp-2',
      title: '12M+ Active Users',
      description: 'Maintained zero critical frontend outages while serving global scale real-time traffic.',
      icon: 'trophy'
    },
    {
      id: 'mp-3',
      title: 'Open Source Advocate',
      description: 'Authored top-starred component toolkit with over 45k monthly NPM downloads.',
      icon: 'award'
    }
  ],
  philosophy: {
    quote: "Simplicity is prerequisite for reliability. Great frontend software hides immense complexity behind delightful micro-interactions.",
    author: "Alex River"
  },
  projects: [
    {
      id: 'proj-1',
      title: 'LiveCanvas Engine',
      description: 'Open-source zero-dependency collaborative state synchronization library using WebSockets and IndexedDB caching.',
      technologies: 'TypeScript, WebSockets, Web Workers',
      link: 'https://github.com/alexriver/live-canvas'
    },
    {
      id: 'proj-2',
      title: 'Aura UI Design Tokens',
      description: 'Universal design token generator compiling cross-platform styles for React, iOS Swift, and Android XML.',
      technologies: 'React, Tailwind Engine, Node CLI',
      link: 'https://aura-ui.dev'
    }
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
  publications: [
    {
      id: 'pub-1',
      title: 'Scalable Micro-Frontends Architecture with Design Tokens',
      publisher: 'IEEE Software Tech Journal',
      date: '2023',
      url: 'https://ieee.org/publications/micro-frontends-2023',
      description: 'Peer-reviewed research paper detailing high-performance tokenized web architectures and atomic UI component libraries.'
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
  },
  updatedAt: new Date().toISOString()
};

export const PRESETS: Record<string, { label: string; role: string; data: ResumeData }> = {
  software_engineer: {
    label: 'Senior Software Engineer',
    role: 'Frontend / Full-Stack Lead',
    data: INITIAL_RESUME
  },
  product_manager: {
    label: 'Principal Product Manager',
    role: 'SaaS & Enterprise Growth',
    data: {
      ...INITIAL_RESUME,
      id: 'resume-pm',
      title: 'Principal Product Manager CV',
      personal: {
        ...INITIAL_RESUME.personal,
        fullName: 'Elena Rostova',
        jobTitle: 'Principal Product Lead - Enterprise Platform',
        email: 'elena.rostova@productmind.io',
        phone: '+1 (415) 920-3310',
        location: 'New York, NY',
        photoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80',
        summary: 'Strategic Product Executive with 9+ years experience driving enterprise SaaS product roadmap from 0 to $45M ARR. Expert in user-centric discovery, pricing optimization, retention funnels, and managing multi-squad engineering organizations.',
      },
      myTime: [
        { id: 'mt-1', label: 'User Research & Customer Interviews', percentage: 30, color: '#059669' },
        { id: 'mt-2', label: 'Roadmap & Stakeholder Alignment', percentage: 35, color: '#6366f1' },
        { id: 'mt-3', label: 'Data Analytics & Funnel Experiments', percentage: 20, color: '#f59e0b' },
        { id: 'mt-4', label: 'Sprint Specs & Go-to-Market', percentage: 15, color: '#dc2626' }
      ],
      mostProudOf: [
        { id: 'mp-1', title: '$45M ARR Scaled', description: 'Grew enterprise product line from seed phase to multi-million ARR in 36 months.', icon: 'trophy' },
        { id: 'mp-2', title: '+34% NRR Boost', description: 'Redesigned onboarding workflow, elevating Net Revenue Retention significantly.', icon: 'rocket' },
        { id: 'mp-3', title: 'Top 10 SaaS Leader', description: 'Awarded SaaS Product Innovator of the Year by Product School.', icon: 'star' }
      ],
      philosophy: {
        quote: "Fall in love with the customer's problem, not your solution. True product magic lives in data-informed empathy.",
        author: "Elena Rostova"
      },
      style: {
        ...INITIAL_RESUME.style,
        templateId: 'compact_two_col',
        accentColor: '#059669',
        secondaryColor: '#f59e0b',
        fontFamily: 'Inter'
      }
    }
  },
  ux_designer: {
    label: 'Lead Product Designer',
    role: 'UI/UX & Design Systems',
    data: {
      ...INITIAL_RESUME,
      id: 'resume-ux',
      title: 'Lead Product Designer Portfolio CV',
      personal: {
        ...INITIAL_RESUME.personal,
        fullName: 'Marcus Vance',
        jobTitle: 'Head of Visual & UX Design',
        email: 'marcus@vancedesign.co',
        phone: '+1 (312) 509-4412',
        location: 'Chicago, IL',
        photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
        summary: 'Award-winning Product Designer with 7+ years shaping intuitive digital experiences, design tokens, and web interfaces. Specializing in glassmorphic aesthetics, micro-animations, motion design, and WCAG accessibility standards.',
      },
      myTime: [
        { id: 'mt-1', label: 'UI Prototyping & Figma Systems', percentage: 40, color: '#ec4899' },
        { id: 'mt-2', label: 'Usability Testing & Personas', percentage: 25, color: '#8b5cf6' },
        { id: 'mt-3', label: 'Design Tokens & Engineer Handoff', percentage: 20, color: '#06b6d4' },
        { id: 'mt-4', label: 'Creative Direction & Motion', percentage: 15, color: '#f43f5e' }
      ],
      mostProudOf: [
        { id: 'mp-1', title: 'Red Dot Design Award', description: 'Received international acclaim for redesign of consumer banking mobile experience.', icon: 'award' },
        { id: 'mp-2', title: 'Figma Community 100k+', description: 'Created top-trending UI kit used by 100,000+ designers globally.', icon: 'star' }
      ],
      philosophy: {
        quote: "Good design is invisible. Great design leaves a subtle feeling of effortless delight.",
        author: "Marcus Vance"
      },
      style: {
        ...INITIAL_RESUME.style,
        templateId: 'creative_banner',
        accentColor: '#ec4899',
        secondaryColor: '#8b5cf6',
        fontFamily: 'Outfit'
      }
    }
  }
};
