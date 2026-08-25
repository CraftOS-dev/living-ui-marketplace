import { ResumeData } from '../types/resume';
import { INITIAL_RESUME } from '../data/presets';

const CANDIDATE_POOL = [
  {
    fullName: 'Julian Vance',
    jobTitle: 'Principal Cloud & DevOps Architect',
    email: 'julian.vance@cloudnative.io',
    phone: '+1 (415) 892-1049',
    location: 'Seattle, WA (Hybrid)',
    website: 'https://julianvance.io',
    linkedin: 'linkedin.com/in/julian-vance-cloud',
    photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
    summary: 'Seasoned Infrastructure & Cloud Architect with 10+ years specializing in Kubernetes orchestration, zero-trust AWS security, and multi-region failover automation. Spearheaded enterprise migrations serving 25M+ active users with 99.999% uptime SLA.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Vanguard Cloud Infrastructure',
        position: 'Principal Cloud Architect',
        location: 'Seattle, WA',
        startDate: '2022',
        endDate: 'Present',
        isCurrent: true,
        description: '• Architected multi-region Terraform & EKS infrastructure, reducing deployment latencies by 74%.\n• Implemented automated Chaos Engineering tests, eliminating unplanned outages across 45 microservices.\n• Managed $3.2M annual cloud infrastructure budget, cutting AWS expenses by $850k through spot instances and reserved nodes.'
      },
      {
        id: 'exp-2',
        company: 'HyperScale Networks',
        position: 'Senior DevOps Engineer',
        location: 'San Francisco, CA',
        startDate: '2018',
        endDate: '2022',
        isCurrent: false,
        description: '• Built GitOps CI/CD pipelines with ArgoCD and GitHub Actions, delivering 120+ daily production builds.\n• Orchestrated Prometheus & Grafana telemetry stack handling 10B+ daily log events.'
      }
    ],
    educations: [
      {
        id: 'edu-1',
        institution: 'University of Washington',
        degree: 'B.S. in Computer Engineering & Distributed Systems',
        startDate: '2014',
        endDate: '2018'
      }
    ],
    skills: [
      { id: 'sk-1', name: 'Golang, Python & Bash', category: 'Programming Languages', proficiency: 'Expert' as const },
      { id: 'sk-2', name: 'Kubernetes & GCP Architecture', category: 'Technical Skills', proficiency: 'Expert' as const },
      { id: 'sk-3', name: 'Terraform, Docker & ArgoCD', category: 'Programs & Tools', proficiency: 'Advanced' as const },
      { id: 'sk-4', name: 'Incident Management & Mentorship', category: 'Interpersonal Skills', proficiency: 'Expert' as const }
    ],
    myTime: [
      { id: 'mt-1', label: 'Cloud Architecture & IaC', percentage: 40, color: '#f97316' },
      { id: 'mt-2', label: 'Security Audits & Compliance', percentage: 25, color: '#0f172a' },
      { id: 'mt-3', label: 'CI/CD Pipeline Optimization', percentage: 20, color: '#10b981' },
      { id: 'mt-4', label: 'Incident Response & Reliability', percentage: 15, color: '#8b5cf6' }
    ],
    mostProudOf: [
      { id: 'mp-1', title: '99.999% Uptime Achieved', description: 'Maintained zero-downtime cluster upgrades over 3 consecutive fiscal years.', icon: 'trophy' as const },
      { id: 'mp-2', title: '$850k Annual Cost Savings', description: 'Optimized cloud footprint via serverless caching and reserved capacity.', icon: 'rocket' as const }
    ],
    philosophy: {
      quote: 'Automate everything that can be automated. Resilient systems are built on simplicity and continuous observation.',
      author: 'Julian Vance'
    },
    accentColor: '#f97316'
  },
  {
    fullName: 'Elena Rostova',
    jobTitle: 'Director of AI & Machine Learning',
    email: 'elena.rostova@neuralmind.ai',
    phone: '+1 (212) 540-3921',
    location: 'New York, NY (Hybrid)',
    website: 'https://elenarostova.ai',
    linkedin: 'linkedin.com/in/elena-rostova-ai',
    photoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80',
    summary: 'Visionary Machine Learning Executive with 8+ years leading AI engineering teams in PyTorch, Large Language Model (LLM) fine-tuning, and real-time computer vision applications. Published researcher with 12+ citations in NeurIPS and ICML.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Cognitive Nexus Labs',
        position: 'Director of AI Research',
        location: 'New York, NY',
        startDate: '2021',
        endDate: 'Present',
        isCurrent: true,
        description: '• Led 16 ML researchers and data engineers building domain-specific LLMs, achieving 94.2% precision on biomedical entity retrieval.\n• Deployed low-latency inference pipelines on NVIDIA TensorRT, cutting per-request inference costs by 58%.\n• Partnered with C-suite stakeholders to establish ethical AI governance framework across all product lines.'
      },
      {
        id: 'exp-2',
        company: 'DeepMind Research Partner',
        position: 'Staff AI Engineer',
        location: 'Boston, MA',
        startDate: '2017',
        endDate: '2021',
        isCurrent: false,
        description: '• Developed transformer-based recommendation algorithms increasing user engagement metrics by 38%.\n• Co-authored 4 patents in distributed neural network training.'
      }
    ],
    educations: [
      {
        id: 'edu-1',
        institution: 'Massachusetts Institute of Technology (MIT)',
        degree: 'Ph.D. in Artificial Intelligence & Computational Science',
        startDate: '2013',
        endDate: '2017'
      }
    ],
    skills: [
      { id: 'sk-1', name: 'PyTorch & TensorFlow', category: 'AI/ML', proficiency: 'Expert' as const },
      { id: 'sk-2', name: 'LLM Fine-Tuning & RAG', category: 'AI/ML', proficiency: 'Expert' as const },
      { id: 'sk-3', name: 'Python & C++', category: 'Languages', proficiency: 'Advanced' as const },
      { id: 'sk-4', name: 'Distributed GPU Training', category: 'AI/ML', proficiency: 'Expert' as const },
      { id: 'sk-5', name: 'MLOps & Kubeflow', category: 'Infrastructure', proficiency: 'Advanced' as const }
    ],
    myTime: [
      { id: 'mt-1', label: 'Model Architecture & Training', percentage: 45, color: '#8b5cf6' },
      { id: 'mt-2', label: 'Research Strategy & Papers', percentage: 25, color: '#f97316' },
      { id: 'mt-3', label: 'Team Leadership & Hiring', percentage: 20, color: '#10b981' },
      { id: 'mt-4', label: 'Ethics & AI Governance', percentage: 10, color: '#0f172a' }
    ],
    mostProudOf: [
      { id: 'mp-1', title: 'NeurIPS Published Author', description: '4 first-author papers on memory-efficient transformer architectures.', icon: 'award' as const },
      { id: 'mp-2', title: '94.2% Retrieval Precision', description: 'Outperformed benchmark models on domain-specific medical NLP task.', icon: 'target' as const }
    ],
    philosophy: {
      quote: 'Artificial Intelligence is not about replacing human creativity—it is about amplifying our potential.',
      author: 'Elena Rostova'
    },
    accentColor: '#8b5cf6'
  },
  {
    fullName: 'Marcus Sterling',
    jobTitle: 'Head of Global Financial Operations',
    email: 'm.sterling@sterlingcapital.com',
    phone: '+1 (312) 402-9182',
    location: 'Chicago, IL',
    website: 'https://sterlingcapital.com',
    linkedin: 'linkedin.com/in/marcus-sterling-fin',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
    summary: 'Dynamic Finance & Corporate Strategy Executive with 12+ years directing M&A transactions, financial modeling, treasury operations, and risk mitigation for Fortune 500 financial institutions. Managed portfolios in excess of $450M.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Apex Global Financial Group',
        position: 'Head of Strategic Finance',
        location: 'Chicago, IL',
        startDate: '2020',
        endDate: 'Present',
        isCurrent: true,
        description: '• Directed $120M cross-border acquisition, driving integration roadmap that realized $18M in synergies within 14 months.\n• Oversaw capital allocation strategy and quarterly earnings preparation for SEC regulatory filings.\n• Implemented automated financial modeling software, accelerating monthly close cycle from 9 days to 3 days.'
      },
      {
        id: 'exp-2',
        company: 'Morgan & Chase Banking Corp',
        position: 'Vice President, Corporate Banking',
        location: 'Chicago, IL',
        startDate: '2015',
        endDate: '2020',
        isCurrent: false,
        description: '• Structured $300M+ syndicated credit facilities for middle-market enterprise clients.\n• Led 8 senior financial analysts in credit risk evaluation and asset valuation.'
      }
    ],
    educations: [
      {
        id: 'edu-1',
        institution: 'University of Chicago Booth School of Business',
        degree: 'MBA in Finance & Strategic Management',
        startDate: '2013',
        endDate: '2015'
      }
    ],
    skills: [
      { id: 'sk-1', name: 'Financial Modeling & Valuation', category: 'Finance', proficiency: 'Expert' as const },
      { id: 'sk-2', name: 'M&A Due Diligence', category: 'Finance', proficiency: 'Expert' as const },
      { id: 'sk-3', name: 'Corporate Treasury & FX', category: 'Finance', proficiency: 'Advanced' as const },
      { id: 'sk-4', name: 'SEC Compliance & Reporting', category: 'Finance', proficiency: 'Expert' as const },
      { id: 'sk-5', name: 'Strategic Capital Planning', category: 'Leadership', proficiency: 'Expert' as const }
    ],
    myTime: [
      { id: 'mt-1', label: 'Financial Modeling & M&A', percentage: 40, color: '#0f172a' },
      { id: 'mt-2', label: 'Executive Board Presentations', percentage: 30, color: '#f97316' },
      { id: 'mt-3', label: 'Treasury & Risk Management', percentage: 20, color: '#10b981' },
      { id: 'mt-4', label: 'Compliance & Audits', percentage: 10, color: '#8b5cf6' }
    ],
    mostProudOf: [
      { id: 'mp-1', title: '$120M M&A Execution', description: 'Led successful cross-border transaction with $18M realized operational synergy.', icon: 'trophy' as const },
      { id: 'mp-2', title: 'Close Cycle Reduced by 67%', description: 'Streamlined financial reporting pipeline to 3 business days.', icon: 'rocket' as const }
    ],
    philosophy: {
      quote: 'Disciplined capital allocation turns strategic vision into sustainable market leadership.',
      author: 'Marcus Sterling'
    },
    accentColor: '#0f172a'
  },
  {
    fullName: 'Sophia Al-Mansoor',
    jobTitle: 'Staff Full-Stack Product Engineer',
    email: 'sophia.mansoor@techspark.dev',
    phone: '+1 (650) 391-0428',
    location: 'San Francisco, CA (Remote)',
    website: 'https://sophiamansoor.dev',
    linkedin: 'linkedin.com/in/sophia-al-mansoor',
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
    summary: 'Versatile Product Engineer with 7+ years building consumer-facing web applications, real-time collaboration tools, and scalable Node.js microservices. Deeply passionate about intuitive UX, TypeScript performance, and modern React design systems.',
    experiences: [
      {
        id: 'exp-1',
        company: 'Starlight Interactive SaaS',
        position: 'Staff Full-Stack Engineer',
        location: 'San Francisco, CA',
        startDate: '2021',
        endDate: 'Present',
        isCurrent: true,
        description: '• Architected real-time multiplayer document canvas using WebSockets and Yjs CRDTs for 8M monthly active users.\n• Redesigned frontend rendering pipeline, lowering First Contentful Paint (FCP) from 2.4s to 450ms.\n• Mentored 8 junior and mid-level engineers across frontend and GraphQL API teams.'
      },
      {
        id: 'exp-2',
        company: 'Nexus Creative Studio',
        position: 'Senior React Developer',
        location: 'Austin, TX',
        startDate: '2018',
        endDate: '2021',
        isCurrent: false,
        description: '• Built responsive component library with 100% test coverage using Jest and React Testing Library.\n• Integrated Stripe billing workflow processing $14M in recurring annual subscriptions.'
      }
    ],
    educations: [
      {
        id: 'edu-1',
        institution: 'Stanford University',
        degree: 'B.S. in Computer Science & Human-Computer Interaction',
        startDate: '2014',
        endDate: '2018'
      }
    ],
    skills: [
      { id: 'sk-1', name: 'TypeScript & React 18', category: 'Frontend', proficiency: 'Expert' as const },
      { id: 'sk-2', name: 'Node.js & GraphQL', category: 'Backend', proficiency: 'Expert' as const },
      { id: 'sk-3', name: 'WebSockets & CRDTs', category: 'Core Tech', proficiency: 'Expert' as const },
      { id: 'sk-4', name: 'PostgreSQL & Redis', category: 'Database', proficiency: 'Advanced' as const },
      { id: 'sk-5', name: 'Next.js & Vite', category: 'Tools', proficiency: 'Expert' as const }
    ],
    myTime: [
      { id: 'mt-1', label: 'Frontend Architecture & UI', percentage: 40, color: '#f97316' },
      { id: 'mt-2', label: 'Real-time Backend APIs', percentage: 30, color: '#10b981' },
      { id: 'mt-3', label: 'Performance Profiling', percentage: 20, color: '#8b5cf6' },
      { id: 'mt-4', label: 'Design System Governance', percentage: 10, color: '#0f172a' }
    ],
    mostProudOf: [
      { id: 'mp-1', title: '450ms Page Load SLA', description: 'Cut initial paint latency by 81% through modern code-splitting.', icon: 'rocket' as const },
      { id: 'mp-2', title: '8M+ Monthly Users', description: 'Zero downtime during viral product launch scaling to 80k concurrent connections.', icon: 'trophy' as const }
    ],
    philosophy: {
      quote: 'Great software feels magical because every micro-interaction has been crafted with intense care.',
      author: 'Sophia Al-Mansoor'
    },
    accentColor: '#f97316'
  }
];

export function generateRandomCandidate(title?: string): ResumeData {
  // Pick random candidate persona
  const randomPersona = CANDIDATE_POOL[Math.floor(Math.random() * CANDIDATE_POOL.length)];
  const timestamp = Date.now();

  return {
    ...INITIAL_RESUME,
    id: `resume-${timestamp}`,
    title: title || `${randomPersona.fullName} Resume`,
    personal: {
      fullName: randomPersona.fullName,
      jobTitle: randomPersona.jobTitle,
      email: randomPersona.email,
      phone: randomPersona.phone,
      location: randomPersona.location,
      website: randomPersona.website,
      linkedin: randomPersona.linkedin,
      github: `github.com/${randomPersona.fullName.toLowerCase().replace(/\s+/g, '')}`,
      photoUrl: randomPersona.photoUrl,
      summary: randomPersona.summary
    },
    experiences: randomPersona.experiences.map((exp, i) => ({ ...exp, id: `exp-${timestamp}-${i}` })),
    educations: randomPersona.educations.map((edu, i) => ({ ...edu, id: `edu-${timestamp}-${i}` })),
    skills: randomPersona.skills.map((sk, i) => ({ ...sk, id: `sk-${timestamp}-${i}` })),
    myTime: randomPersona.myTime.map((mt, i) => ({ ...mt, id: `mt-${timestamp}-${i}` })),
    mostProudOf: randomPersona.mostProudOf.map((mp, i) => ({ ...mp, id: `mp-${timestamp}-${i}` })),
    philosophy: { ...randomPersona.philosophy },
    certifications: [
      {
        id: `cert-${timestamp}-0`,
        name: 'AWS Certified Solutions Architect (Professional)',
        issuer: 'Amazon Web Services',
        issueDate: '2023',
        url: 'https://aws.amazon.com/verification'
      },
      {
        id: `cert-${timestamp}-1`,
        name: 'Certified Kubernetes Administrator (CKA)',
        issuer: 'Linux Foundation / CNCF',
        issueDate: '2024',
        url: 'https://cncf.io/certification/cka'
      }
    ],
    publications: [
      {
        id: `pub-${timestamp}-0`,
        title: 'Scalable Micro-Frontends Architecture with Design Tokens',
        publisher: 'IEEE Software Tech Journal',
        date: '2023',
        url: 'https://ieee.org/publications/micro-frontends-2023',
        description: 'Peer-reviewed research paper detailing high-performance tokenized web architectures and atomic UI component libraries.'
      }
    ],
    style: {
      ...INITIAL_RESUME.style,
      accentColor: '#0f172a' // Accent No. 2 (Slate Navy)
    },
    updatedAt: new Date(timestamp).toISOString()
  };
}
