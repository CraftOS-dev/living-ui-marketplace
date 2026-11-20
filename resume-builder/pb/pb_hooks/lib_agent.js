/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — logic for the routes in agent_ops.pb.js.
 *
 * Every operation does exactly what a person can do (or see) in the app's
 * own screens, with the same data shape the UI stores in resume_state.data.
 * Each ported rule cites its UI source (paths relative to frontend/src/app).
 *
 * How the UI stores a resume (context/ResumeContext.tsx):
 *   - On load, every resume_state record whose data has a `personal` object
 *     becomes one resume; its id is the RECORD id (:112-160).
 *   - The UI saves the whole resume object into that same record, by id. A
 *     new resume (New, Duplicate, Import) gets a 15-character record id when
 *     it is made and is created at once as {id, key: id, data} (:186-238).
 *     Delete removes the record.
 *   - Agent operations read and write that record too, so an agent edit
 *     shows up exactly as stored the next time the app is opened.
 *
 * Writes pass a plain JS object to rec.set('data', obj): PocketBase then
 * marshals it exactly as it does the UI's REST saves (byte-identical; see the
 * implementation notes). Never pass a pre-stringified JSON string.
 *
 * Usage (inside a route handler):  require(`${__hooks}/lib_agent.js`).run(e, '<op name>')
 */

/* ===================================================== ported UI constants */

// data/presets.ts:3-158 (INITIAL_RESUME without updatedAt; the UI stamps it
// with the page-load time, these operations with the time of the call).
var INITIAL_RESUME_BASE = {
  "id": "resume-1",
  "title": "Senior Software Engineer CV",
  "personal": {
    "fullName": "Alex River",
    "jobTitle": "Senior Staff Frontend Architect",
    "email": "alex.river@devmail.io",
    "phone": "+1 (512) 849-2041",
    "location": "San Francisco, CA (Open to Remote)",
    "website": "https://alexriver.dev",
    "linkedin": "linkedin.com/in/alex-river-dev",
    "github": "github.com/alexriver",
    "photoUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
    "summary": "High-impact Software Architect with 8+ years experience architecting real-time collaboration engines, high-throughput micro-frontends, and design systems serving over 12M active monthly users. Passionate about developer tooling, performance engineering (<50ms initial load), and user-centric UX."
  },
  "experiences": [
    {
      "id": "exp-1",
      "company": "Apex Cloud Systems",
      "position": "Staff Frontend Engineer & Tech Lead",
      "location": "San Francisco, CA",
      "startDate": "Jan 2022",
      "endDate": "Present",
      "isCurrent": true,
      "description": "• Spearheaded architectural migration of core React Dashboard to Vite & Module Federation, reducing build times by 68% and bundle size by 1.4MB.\n• Engineered real-time collaborative canvas using WebSockets & CRDTs, boosting team productivity metrics by 42% across 350+ enterprise accounts.\n• Mentored 12 frontend engineers, established automated CI/CD performance regression gates, and maintained 99.98% uptime for customer-facing portals."
    },
    {
      "id": "exp-2",
      "company": "Pulse Analytics Inc.",
      "position": "Senior Full-Stack Engineer",
      "location": "Austin, TX",
      "startDate": "Mar 2019",
      "endDate": "Dec 2021",
      "isCurrent": false,
      "description": "• Built high-performance data visualization library in D3.js and WebGL, processing 5M+ daily event logs with sub-16ms frame rendering rates.\n• Reduced API latencies by 35% through Redis caching strategies and optimized GraphQL queries.\n• Co-authored open-source UI component library adopted across 14 internal product verticals."
    },
    {
      "id": "exp-3",
      "company": "Veloce Digital Agency",
      "position": "UI/UX Developer",
      "location": "Austin, TX",
      "startDate": "Jun 2016",
      "endDate": "Feb 2019",
      "isCurrent": false,
      "description": "• Delivered 20+ responsive web applications for Fortune 500 clients with strict accessibility (WCAG 2.1 AA) compliance.\n• Increased mobile client conversion rates by 28% through interactive prototype usability testing."
    }
  ],
  "educations": [
    {
      "id": "edu-1",
      "institution": "University of Texas at Austin",
      "degree": "B.S. in Computer Science & Human-Computer Interaction",
      "fieldOfStudy": "Computer Science",
      "startDate": "Sep 2012",
      "endDate": "May 2016",
      "gpa": "3.91 / 4.0 (Magna Cum Laude)"
    }
  ],
  "skills": [
    {
      "id": "sk-1",
      "name": "TypeScript, JavaScript & Python",
      "category": "Programming Languages",
      "proficiency": "Expert"
    },
    {
      "id": "sk-2",
      "name": "React 18, Next.js & Node.js",
      "category": "Technical Skills",
      "proficiency": "Expert"
    },
    {
      "id": "sk-3",
      "name": "GraphQL & System Architecture",
      "category": "Technical Skills",
      "proficiency": "Advanced"
    },
    {
      "id": "sk-4",
      "name": "Docker, Git, AWS & Vite",
      "category": "Programs & Tools",
      "proficiency": "Expert"
    },
    {
      "id": "sk-5",
      "name": "Team Leadership & Engineering Mentorship",
      "category": "Interpersonal Skills",
      "proficiency": "Expert"
    },
    {
      "id": "sk-6",
      "name": "Cross-Functional Collaboration",
      "category": "Interpersonal Skills",
      "proficiency": "Advanced"
    }
  ],
  "myTime": [
    {
      "id": "mt-1",
      "label": "Architecture & System Design",
      "percentage": 35,
      "color": "#6366f1"
    },
    {
      "id": "mt-2",
      "label": "Hands-on Coding & Code Reviews",
      "percentage": 30,
      "color": "#ec4899"
    },
    {
      "id": "mt-3",
      "label": "Team Mentorship & Tech Specs",
      "percentage": 20,
      "color": "#10b981"
    },
    {
      "id": "mt-4",
      "label": "Performance Optimization & R&D",
      "percentage": 15,
      "color": "#f59e0b"
    }
  ],
  "mostProudOf": [
    {
      "id": "mp-1",
      "title": "68% Build Time Cut",
      "description": "Architected modular build pipeline saving 450+ engineering hours annually across 8 product teams.",
      "icon": "rocket"
    },
    {
      "id": "mp-2",
      "title": "12M+ Active Users",
      "description": "Maintained zero critical frontend outages while serving global scale real-time traffic.",
      "icon": "trophy"
    },
    {
      "id": "mp-3",
      "title": "Open Source Advocate",
      "description": "Authored top-starred component toolkit with over 45k monthly NPM downloads.",
      "icon": "award"
    }
  ],
  "philosophy": {
    "quote": "Simplicity is prerequisite for reliability. Great frontend software hides immense complexity behind delightful micro-interactions.",
    "author": "Alex River"
  },
  "projects": [
    {
      "id": "proj-1",
      "title": "LiveCanvas Engine",
      "description": "Open-source zero-dependency collaborative state synchronization library using WebSockets and IndexedDB caching.",
      "technologies": "TypeScript, WebSockets, Web Workers",
      "link": "https://github.com/alexriver/live-canvas"
    },
    {
      "id": "proj-2",
      "title": "Aura UI Design Tokens",
      "description": "Universal design token generator compiling cross-platform styles for React, iOS Swift, and Android XML.",
      "technologies": "React, Tailwind Engine, Node CLI",
      "link": "https://aura-ui.dev"
    }
  ],
  "certifications": [
    {
      "id": "cert-1",
      "name": "AWS Certified Solutions Architect",
      "issuer": "Amazon Web Services",
      "issueDate": "2023",
      "url": "https://aws.amazon.com/verification"
    }
  ],
  "publications": [
    {
      "id": "pub-1",
      "title": "Scalable Micro-Frontends Architecture with Design Tokens",
      "publisher": "IEEE Software Tech Journal",
      "date": "2023",
      "url": "https://ieee.org/publications/micro-frontends-2023",
      "description": "Peer-reviewed research paper detailing high-performance tokenized web architectures and atomic UI component libraries."
    }
  ],
  "sectionVisibility": {
    "photo": true,
    "summary": true,
    "experience": true,
    "education": true,
    "skills": true,
    "myTime": true,
    "mostProudOf": true,
    "philosophy": true,
    "projects": true,
    "certifications": true,
    "publications": true
  },
  "sectionOrder": [
    "summary",
    "experience",
    "myTime",
    "mostProudOf",
    "skills",
    "projects",
    "education",
    "philosophy",
    "certifications",
    "publications"
  ],
  "style": {
    "templateId": "enhancv_modern",
    "fontFamily": "Outfit",
    "accentColor": "#6366f1",
    "secondaryColor": "#ec4899",
    "fontSize": "medium",
    "lineSpacing": "normal",
    "photoShape": "round",
    "showPageNumbers": false
  }
};

// utils/randomCandidateGenerator.ts:4-260 (CANDIDATE_POOL, verbatim).
var CANDIDATE_POOL = [
  {
    "fullName": "Julian Vance",
    "jobTitle": "Principal Cloud & DevOps Architect",
    "email": "julian.vance@cloudnative.io",
    "phone": "+1 (415) 892-1049",
    "location": "Seattle, WA (Hybrid)",
    "website": "https://julianvance.io",
    "linkedin": "linkedin.com/in/julian-vance-cloud",
    "photoUrl": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
    "summary": "Seasoned Infrastructure & Cloud Architect with 10+ years specializing in Kubernetes orchestration, zero-trust AWS security, and multi-region failover automation. Spearheaded enterprise migrations serving 25M+ active users with 99.999% uptime SLA.",
    "experiences": [
      {
        "id": "exp-1",
        "company": "Vanguard Cloud Infrastructure",
        "position": "Principal Cloud Architect",
        "location": "Seattle, WA",
        "startDate": "2022",
        "endDate": "Present",
        "isCurrent": true,
        "description": "• Architected multi-region Terraform & EKS infrastructure, reducing deployment latencies by 74%.\n• Implemented automated Chaos Engineering tests, eliminating unplanned outages across 45 microservices.\n• Managed $3.2M annual cloud infrastructure budget, cutting AWS expenses by $850k through spot instances and reserved nodes."
      },
      {
        "id": "exp-2",
        "company": "HyperScale Networks",
        "position": "Senior DevOps Engineer",
        "location": "San Francisco, CA",
        "startDate": "2018",
        "endDate": "2022",
        "isCurrent": false,
        "description": "• Built GitOps CI/CD pipelines with ArgoCD and GitHub Actions, delivering 120+ daily production builds.\n• Orchestrated Prometheus & Grafana telemetry stack handling 10B+ daily log events."
      }
    ],
    "educations": [
      {
        "id": "edu-1",
        "institution": "University of Washington",
        "degree": "B.S. in Computer Engineering & Distributed Systems",
        "startDate": "2014",
        "endDate": "2018"
      }
    ],
    "skills": [
      {
        "id": "sk-1",
        "name": "Golang, Python & Bash",
        "category": "Programming Languages",
        "proficiency": "Expert"
      },
      {
        "id": "sk-2",
        "name": "Kubernetes & GCP Architecture",
        "category": "Technical Skills",
        "proficiency": "Expert"
      },
      {
        "id": "sk-3",
        "name": "Terraform, Docker & ArgoCD",
        "category": "Programs & Tools",
        "proficiency": "Advanced"
      },
      {
        "id": "sk-4",
        "name": "Incident Management & Mentorship",
        "category": "Interpersonal Skills",
        "proficiency": "Expert"
      }
    ],
    "myTime": [
      {
        "id": "mt-1",
        "label": "Cloud Architecture & IaC",
        "percentage": 40,
        "color": "#f97316"
      },
      {
        "id": "mt-2",
        "label": "Security Audits & Compliance",
        "percentage": 25,
        "color": "#0f172a"
      },
      {
        "id": "mt-3",
        "label": "CI/CD Pipeline Optimization",
        "percentage": 20,
        "color": "#10b981"
      },
      {
        "id": "mt-4",
        "label": "Incident Response & Reliability",
        "percentage": 15,
        "color": "#8b5cf6"
      }
    ],
    "mostProudOf": [
      {
        "id": "mp-1",
        "title": "99.999% Uptime Achieved",
        "description": "Maintained zero-downtime cluster upgrades over 3 consecutive fiscal years.",
        "icon": "trophy"
      },
      {
        "id": "mp-2",
        "title": "$850k Annual Cost Savings",
        "description": "Optimized cloud footprint via serverless caching and reserved capacity.",
        "icon": "rocket"
      }
    ],
    "philosophy": {
      "quote": "Automate everything that can be automated. Resilient systems are built on simplicity and continuous observation.",
      "author": "Julian Vance"
    },
    "accentColor": "#f97316"
  },
  {
    "fullName": "Elena Rostova",
    "jobTitle": "Director of AI & Machine Learning",
    "email": "elena.rostova@neuralmind.ai",
    "phone": "+1 (212) 540-3921",
    "location": "New York, NY (Hybrid)",
    "website": "https://elenarostova.ai",
    "linkedin": "linkedin.com/in/elena-rostova-ai",
    "photoUrl": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80",
    "summary": "Visionary Machine Learning Executive with 8+ years leading AI engineering teams in PyTorch, Large Language Model (LLM) fine-tuning, and real-time computer vision applications. Published researcher with 12+ citations in NeurIPS and ICML.",
    "experiences": [
      {
        "id": "exp-1",
        "company": "Cognitive Nexus Labs",
        "position": "Director of AI Research",
        "location": "New York, NY",
        "startDate": "2021",
        "endDate": "Present",
        "isCurrent": true,
        "description": "• Led 16 ML researchers and data engineers building domain-specific LLMs, achieving 94.2% precision on biomedical entity retrieval.\n• Deployed low-latency inference pipelines on NVIDIA TensorRT, cutting per-request inference costs by 58%.\n• Partnered with C-suite stakeholders to establish ethical AI governance framework across all product lines."
      },
      {
        "id": "exp-2",
        "company": "DeepMind Research Partner",
        "position": "Staff AI Engineer",
        "location": "Boston, MA",
        "startDate": "2017",
        "endDate": "2021",
        "isCurrent": false,
        "description": "• Developed transformer-based recommendation algorithms increasing user engagement metrics by 38%.\n• Co-authored 4 patents in distributed neural network training."
      }
    ],
    "educations": [
      {
        "id": "edu-1",
        "institution": "Massachusetts Institute of Technology (MIT)",
        "degree": "Ph.D. in Artificial Intelligence & Computational Science",
        "startDate": "2013",
        "endDate": "2017"
      }
    ],
    "skills": [
      {
        "id": "sk-1",
        "name": "PyTorch & TensorFlow",
        "category": "AI/ML",
        "proficiency": "Expert"
      },
      {
        "id": "sk-2",
        "name": "LLM Fine-Tuning & RAG",
        "category": "AI/ML",
        "proficiency": "Expert"
      },
      {
        "id": "sk-3",
        "name": "Python & C++",
        "category": "Languages",
        "proficiency": "Advanced"
      },
      {
        "id": "sk-4",
        "name": "Distributed GPU Training",
        "category": "AI/ML",
        "proficiency": "Expert"
      },
      {
        "id": "sk-5",
        "name": "MLOps & Kubeflow",
        "category": "Infrastructure",
        "proficiency": "Advanced"
      }
    ],
    "myTime": [
      {
        "id": "mt-1",
        "label": "Model Architecture & Training",
        "percentage": 45,
        "color": "#8b5cf6"
      },
      {
        "id": "mt-2",
        "label": "Research Strategy & Papers",
        "percentage": 25,
        "color": "#f97316"
      },
      {
        "id": "mt-3",
        "label": "Team Leadership & Hiring",
        "percentage": 20,
        "color": "#10b981"
      },
      {
        "id": "mt-4",
        "label": "Ethics & AI Governance",
        "percentage": 10,
        "color": "#0f172a"
      }
    ],
    "mostProudOf": [
      {
        "id": "mp-1",
        "title": "NeurIPS Published Author",
        "description": "4 first-author papers on memory-efficient transformer architectures.",
        "icon": "award"
      },
      {
        "id": "mp-2",
        "title": "94.2% Retrieval Precision",
        "description": "Outperformed benchmark models on domain-specific medical NLP task.",
        "icon": "target"
      }
    ],
    "philosophy": {
      "quote": "Artificial Intelligence is not about replacing human creativity—it is about amplifying our potential.",
      "author": "Elena Rostova"
    },
    "accentColor": "#8b5cf6"
  },
  {
    "fullName": "Marcus Sterling",
    "jobTitle": "Head of Global Financial Operations",
    "email": "m.sterling@sterlingcapital.com",
    "phone": "+1 (312) 402-9182",
    "location": "Chicago, IL",
    "website": "https://sterlingcapital.com",
    "linkedin": "linkedin.com/in/marcus-sterling-fin",
    "photoUrl": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80",
    "summary": "Dynamic Finance & Corporate Strategy Executive with 12+ years directing M&A transactions, financial modeling, treasury operations, and risk mitigation for Fortune 500 financial institutions. Managed portfolios in excess of $450M.",
    "experiences": [
      {
        "id": "exp-1",
        "company": "Apex Global Financial Group",
        "position": "Head of Strategic Finance",
        "location": "Chicago, IL",
        "startDate": "2020",
        "endDate": "Present",
        "isCurrent": true,
        "description": "• Directed $120M cross-border acquisition, driving integration roadmap that realized $18M in synergies within 14 months.\n• Oversaw capital allocation strategy and quarterly earnings preparation for SEC regulatory filings.\n• Implemented automated financial modeling software, accelerating monthly close cycle from 9 days to 3 days."
      },
      {
        "id": "exp-2",
        "company": "Morgan & Chase Banking Corp",
        "position": "Vice President, Corporate Banking",
        "location": "Chicago, IL",
        "startDate": "2015",
        "endDate": "2020",
        "isCurrent": false,
        "description": "• Structured $300M+ syndicated credit facilities for middle-market enterprise clients.\n• Led 8 senior financial analysts in credit risk evaluation and asset valuation."
      }
    ],
    "educations": [
      {
        "id": "edu-1",
        "institution": "University of Chicago Booth School of Business",
        "degree": "MBA in Finance & Strategic Management",
        "startDate": "2013",
        "endDate": "2015"
      }
    ],
    "skills": [
      {
        "id": "sk-1",
        "name": "Financial Modeling & Valuation",
        "category": "Finance",
        "proficiency": "Expert"
      },
      {
        "id": "sk-2",
        "name": "M&A Due Diligence",
        "category": "Finance",
        "proficiency": "Expert"
      },
      {
        "id": "sk-3",
        "name": "Corporate Treasury & FX",
        "category": "Finance",
        "proficiency": "Advanced"
      },
      {
        "id": "sk-4",
        "name": "SEC Compliance & Reporting",
        "category": "Finance",
        "proficiency": "Expert"
      },
      {
        "id": "sk-5",
        "name": "Strategic Capital Planning",
        "category": "Leadership",
        "proficiency": "Expert"
      }
    ],
    "myTime": [
      {
        "id": "mt-1",
        "label": "Financial Modeling & M&A",
        "percentage": 40,
        "color": "#0f172a"
      },
      {
        "id": "mt-2",
        "label": "Executive Board Presentations",
        "percentage": 30,
        "color": "#f97316"
      },
      {
        "id": "mt-3",
        "label": "Treasury & Risk Management",
        "percentage": 20,
        "color": "#10b981"
      },
      {
        "id": "mt-4",
        "label": "Compliance & Audits",
        "percentage": 10,
        "color": "#8b5cf6"
      }
    ],
    "mostProudOf": [
      {
        "id": "mp-1",
        "title": "$120M M&A Execution",
        "description": "Led successful cross-border transaction with $18M realized operational synergy.",
        "icon": "trophy"
      },
      {
        "id": "mp-2",
        "title": "Close Cycle Reduced by 67%",
        "description": "Streamlined financial reporting pipeline to 3 business days.",
        "icon": "rocket"
      }
    ],
    "philosophy": {
      "quote": "Disciplined capital allocation turns strategic vision into sustainable market leadership.",
      "author": "Marcus Sterling"
    },
    "accentColor": "#0f172a"
  },
  {
    "fullName": "Sophia Al-Mansoor",
    "jobTitle": "Staff Full-Stack Product Engineer",
    "email": "sophia.mansoor@techspark.dev",
    "phone": "+1 (650) 391-0428",
    "location": "San Francisco, CA (Remote)",
    "website": "https://sophiamansoor.dev",
    "linkedin": "linkedin.com/in/sophia-al-mansoor",
    "photoUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
    "summary": "Versatile Product Engineer with 7+ years building consumer-facing web applications, real-time collaboration tools, and scalable Node.js microservices. Deeply passionate about intuitive UX, TypeScript performance, and modern React design systems.",
    "experiences": [
      {
        "id": "exp-1",
        "company": "Starlight Interactive SaaS",
        "position": "Staff Full-Stack Engineer",
        "location": "San Francisco, CA",
        "startDate": "2021",
        "endDate": "Present",
        "isCurrent": true,
        "description": "• Architected real-time multiplayer document canvas using WebSockets and Yjs CRDTs for 8M monthly active users.\n• Redesigned frontend rendering pipeline, lowering First Contentful Paint (FCP) from 2.4s to 450ms.\n• Mentored 8 junior and mid-level engineers across frontend and GraphQL API teams."
      },
      {
        "id": "exp-2",
        "company": "Nexus Creative Studio",
        "position": "Senior React Developer",
        "location": "Austin, TX",
        "startDate": "2018",
        "endDate": "2021",
        "isCurrent": false,
        "description": "• Built responsive component library with 100% test coverage using Jest and React Testing Library.\n• Integrated Stripe billing workflow processing $14M in recurring annual subscriptions."
      }
    ],
    "educations": [
      {
        "id": "edu-1",
        "institution": "Stanford University",
        "degree": "B.S. in Computer Science & Human-Computer Interaction",
        "startDate": "2014",
        "endDate": "2018"
      }
    ],
    "skills": [
      {
        "id": "sk-1",
        "name": "TypeScript & React 18",
        "category": "Frontend",
        "proficiency": "Expert"
      },
      {
        "id": "sk-2",
        "name": "Node.js & GraphQL",
        "category": "Backend",
        "proficiency": "Expert"
      },
      {
        "id": "sk-3",
        "name": "WebSockets & CRDTs",
        "category": "Core Tech",
        "proficiency": "Expert"
      },
      {
        "id": "sk-4",
        "name": "PostgreSQL & Redis",
        "category": "Database",
        "proficiency": "Advanced"
      },
      {
        "id": "sk-5",
        "name": "Next.js & Vite",
        "category": "Tools",
        "proficiency": "Expert"
      }
    ],
    "myTime": [
      {
        "id": "mt-1",
        "label": "Frontend Architecture & UI",
        "percentage": 40,
        "color": "#f97316"
      },
      {
        "id": "mt-2",
        "label": "Real-time Backend APIs",
        "percentage": 30,
        "color": "#10b981"
      },
      {
        "id": "mt-3",
        "label": "Performance Profiling",
        "percentage": 20,
        "color": "#8b5cf6"
      },
      {
        "id": "mt-4",
        "label": "Design System Governance",
        "percentage": 10,
        "color": "#0f172a"
      }
    ],
    "mostProudOf": [
      {
        "id": "mp-1",
        "title": "450ms Page Load SLA",
        "description": "Cut initial paint latency by 81% through modern code-splitting.",
        "icon": "rocket"
      },
      {
        "id": "mp-2",
        "title": "8M+ Monthly Users",
        "description": "Zero downtime during viral product launch scaling to 80k concurrent connections.",
        "icon": "trophy"
      }
    ],
    "philosophy": {
      "quote": "Great software feels magical because every micro-interaction has been crafted with intense care.",
      "author": "Sophia Al-Mansoor"
    },
    "accentColor": "#f97316"
  }
];

// types/resume.ts:144-154 — the ten section keys, in INITIAL_RESUME.sectionOrder's key set.
var SECTION_KEYS = ['summary', 'experience', 'education', 'skills', 'myTime', 'mostProudOf', 'philosophy', 'projects', 'certifications', 'publications'];

// components/Editor/VisibilityForm.tsx:7-18 — the Layout tab's row labels.
var SECTION_LABELS = {
  summary: 'Summary / Bio',
  experience: 'Work Experience',
  education: 'Education & Degrees',
  skills: 'Skills & Competencies',
  myTime: 'My Time Breakdown',
  mostProudOf: 'Achievements Badges',
  philosophy: 'Work Philosophy & Quote',
  projects: 'Portfolio Projects',
  certifications: 'Certifications',
  publications: 'Publications & Papers',
};

// components/Toolbar.tsx:50-97 — the template dropdown, in its order and with its labels.
var TEMPLATE_GROUPS = [
  { group: 'Popular & Executive', templates: [
    ['executive_classic', 'CEO Executive'], ['executive_one', 'Executive I'], ['high_performer', 'High Performer Director'],
    ['enhancv_modern_v2', 'Modern Clean'], ['enhancv_modern', 'Modern Split Column']] },
  { group: 'Academic & Traditional', templates: [
    ['enhancv_classic', 'Auditor Classic'], ['ivy_league_v3', 'Corporate Ivy'], ['imprint', 'Imprint Serif'],
    ['ivy_league_v2', 'Ivy League Centered'], ['ivy_league', 'Ivy League Classic'], ['pure', 'Pure Academic']] },
  { group: 'Corporate & Banking', templates: [
    ['double_column_banking', 'Banking Double Column'], ['collegiate', 'Collegiate Banner'], ['crest', 'Crest Editorial'],
    ['crest_projects', 'Crest Projects'], ['executive_serif', 'Executive Serif Director'], ['single_column_v2', 'Single Column Executive']] },
  { group: 'Modern & Tech', templates: [
    ['boxed_manager', 'Boxed Framing Manager'], ['compact_two_col', 'Compact Grid'], ['enhancv_compact', 'Compact Leadership'],
    ['enhancv_contemporary', 'Contemporary Startup'], ['data_timeline', 'Data Pipeline Timeline'], ['enhancv_minimal', 'Minimal Tech'],
    ['single_column', 'Single Column Standard'], ['timeline_tech', 'Timeline Tech Developer']] },
  { group: 'Creative & Portfolio', templates: [
    ['creative_banner', 'Creative Header Banner'], ['enhancv_creative', 'Creative Portfolio'], ['double_column', 'Double Column Modern'],
    ['elegant', 'Elegant Sidebar'], ['elegant_v2', 'Elegant Timeline'], ['polished', 'Polished Sidebar'],
    ['enhancv_stylish', 'Stylish Leadership'], ['systems_tech', 'Systems Tech Highlight'], ['timeline', 'Timeline Visual']] },
];
var TEMPLATE_IDS = [];
for (var tg = 0; tg < TEMPLATE_GROUPS.length; tg++) {
  for (var tt = 0; tt < TEMPLATE_GROUPS[tg].templates.length; tt++) TEMPLATE_IDS.push(TEMPLATE_GROUPS[tg].templates[tt][0]);
}

// types/resume.ts:202-232 — getTemplateDefaultFont.
function templateDefaultFont(templateId) {
  switch (templateId) {
    case 'executive_serif': case 'pure': case 'executive_one': case 'crest': case 'crest_projects': case 'imprint': case 'ivy_league_v3':
      return 'Playfair Display';
    case 'systems_tech': case 'data_timeline': case 'boxed_manager': case 'collegiate': case 'ivy_league': case 'ivy_league_v2':
    case 'single_column': case 'single_column_v2': case 'polished': case 'timeline': case 'timeline_tech': case 'double_column_banking':
    case 'enhancv_compact': case 'enhancv_classic': case 'enhancv_minimal': case 'high_performer':
      return 'Inter';
    default:
      return 'Outfit';
  }
}

// utils/templateSections.ts:3-68 — getTemplateSupportedSections (same key order).
var ALL_SECTIONS_TEMPLATES = ['enhancv_modern', 'enhancv_classic', 'compact_two_col', 'creative_banner', 'double_column', 'double_column_banking',
  'elegant', 'elegant_v2', 'enhancv_compact', 'enhancv_contemporary', 'enhancv_creative', 'enhancv_minimal', 'enhancv_stylish',
  'executive_classic', 'executive_serif', 'boxed_manager', 'collegiate', 'crest', 'data_timeline', 'polished'];
function supportedSections(templateId) {
  var all = ALL_SECTIONS_TEMPLATES.indexOf(templateId) >= 0;
  return {
    summary: true,
    experience: true,
    education: true,
    skills: true,
    mostProudOf: true,
    myTime: all,
    philosophy: all,
    projects: true,
    certifications: true,
    publications: true,
  };
}

// components/Toolbar.tsx:8-17 — the eight accent swatches (names from its comments).
var ACCENT_COLORS = [
  ['#f97316', 'Vibrant Orange'], ['#0f172a', 'Slate Navy'], ['#0c2340', 'Deep Blue'], ['#004d40', 'Deep Teal'],
  ['#1d4ed8', 'Royal Blue'], ['#10b981', 'Emerald Tech'], ['#8b5cf6', 'Violet'], ['#d97706', 'Amber'],
];
// Toolbar.tsx:131-136, 150-152, 160-162, 177-179 — the other toolbar choices and their labels.
var FONT_OPTIONS = [['Default', 'Template Default'], ['Outfit', 'Outfit (Modern)'], ['Inter', 'Inter (Clean)'],
  ['Playfair Display', 'Playfair (Serif)'], ['Space Mono', 'Space Mono (Tech)'], ['Plus Jakarta Sans', 'Jakarta Sans']];
var FONT_SIZES = [['small', 'Small (Dense)'], ['medium', 'Medium (Standard)'], ['large', 'Large (Spacious)']];
var LINE_SPACINGS = [['compact', 'Compact Lines'], ['normal', 'Normal Lines'], ['spacious', 'Roomy Lines']];
var PHOTO_SHAPES = [['round', 'Circle'], ['square', 'Rounded Square'], ['hidden', 'Hide Photo']];

// components/Editor/MostProudOfForm.tsx:6-15 — badge icons.
var ICONS = ['trophy', 'rocket', 'target', 'star', 'award', 'zap', 'heart', 'flame'];
// components/Editor/SkillsForm.tsx:81 / types/resume.ts:83 — proficiency choices.
var PROFICIENCIES = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
// components/Editor/SkillsForm.tsx:9,38-41 — the quick-add category select (default first).
var SKILL_CATEGORIES = ['Programming Languages', 'Technical Skills', 'Programs & Tools', 'Interpersonal Skills'];
// context/ResumeContext.tsx:437 — colours given to new My Time rows, by current row count.
var MYTIME_COLORS = ['#f97316', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
// components/Editor/ExperienceForm.tsx:6-9 — the action-verb buttons.
var SUGGESTED_VERBS = ['Spearheaded', 'Engineered', 'Architected', 'Orchestrated', 'Optimized',
  'Accelerated', 'Redesigned', 'Pioneered', 'Scaled', 'Transformed'];

// Personal fields (types/resume.ts:45-56; PersonalForm.tsx). Only `summary` is a textarea.
var PERSONAL_FIELDS = { fullName: 'line', jobTitle: 'line', email: 'line', phone: 'line', location: 'line',
  linkedin: 'line', github: 'line', website: 'line', photoUrl: 'line', summary: 'multi' };

/**
 * The eight item sections. `defaults` is the object the UI's add button
 * creates (same keys, same order, id first); `top` = the UI inserts new items
 * first; `fields` = what the section's form lets a person edit.
 */
var SECTIONS = {
  // ResumeContext.tsx:342-373; ExperienceForm.tsx:34-137 (no control for `location`)
  experience: {
    key: 'experiences', prefix: 'exp', top: true,
    fields: { position: 'line', company: 'line', startDate: 'line', endDate: 'line', isCurrent: 'bool', description: 'multi' },
    defaults: function () {
      return { company: 'New Company', position: 'Role / Title', startDate: '2023', endDate: 'Present', isCurrent: true,
        description: '• Spearheaded project development, increasing performance metrics by 25%.' };
    },
  },
  // ResumeContext.tsx:375-404; EducationForm.tsx:15-83 (no control for `fieldOfStudy`)
  education: {
    key: 'educations', prefix: 'edu', top: true,
    fields: { degree: 'line', institution: 'line', startDate: 'line', endDate: 'line', gpa: 'line' },
    defaults: function () {
      return { institution: 'University Name', degree: 'B.S. Degree', startDate: '2018', endDate: '2022' };
    },
  },
  // ResumeContext.tsx:406-434; SkillsForm.tsx:11-91
  skills: {
    key: 'skills', prefix: 'sk', top: false,
    fields: { name: 'line', category: 'line', proficiency: PROFICIENCIES },
    defaults: function () {
      return { name: '', category: SKILL_CATEGORIES[0], proficiency: 'Advanced' };
    },
  },
  // ResumeContext.tsx:436-466; MyTimeForm.tsx:23-64
  mytime: {
    key: 'myTime', prefix: 'mt', top: false,
    fields: { label: 'line', percentage: 'pct', color: 'hex' },
    defaults: function (r) {
      return { label: 'New Activity Focus', percentage: 15, color: MYTIME_COLORS[r.myTime.length % MYTIME_COLORS.length] || '#f97316' };
    },
  },
  // ResumeContext.tsx:468-496; MostProudOfForm.tsx:28-82 (description is a one-line input)
  achievements: {
    key: 'mostProudOf', prefix: 'mp', top: false,
    fields: { title: 'line', description: 'line', icon: ICONS },
    defaults: function () {
      return { title: 'Key Achievement', description: 'Describe impact or quantifiable outcome achieved.', icon: 'trophy' };
    },
  },
  // ResumeContext.tsx:506-534; ProjectsForm.tsx:16-77
  projects: {
    key: 'projects', prefix: 'proj', top: false,
    fields: { title: 'line', technologies: 'line', link: 'line', description: 'multi' },
    defaults: function () {
      return { title: 'Project Title', description: 'Brief description of project goal and architectural design.', technologies: 'React, TypeScript' };
    },
  },
  // ResumeContext.tsx:536-564; CertificationsForm.tsx:15-79
  certifications: {
    key: 'certifications', prefix: 'cert', top: false,
    fields: { name: 'line', issuer: 'line', issueDate: 'line', url: 'line' },
    defaults: function () {
      return { name: 'Certification Name', issuer: 'Issuing Organization', issueDate: '2023' };
    },
  },
  // ResumeContext.tsx:566-596; PublicationsForm.tsx:15-90
  publications: {
    key: 'publications', prefix: 'pub', top: false,
    fields: { title: 'line', publisher: 'line', date: 'line', url: 'line', description: 'multi' },
    defaults: function () {
      return { title: 'Publication Title', publisher: 'Publisher / Journal', date: '2024', url: '',
        description: 'Brief description of the published work or research.' };
    },
  },
};

// resumes.get --section names → data keys (friendly names match the op modules).
var SECTION_PARAM = {
  personal: 'personal', experience: 'experiences', education: 'educations', skills: 'skills', mytime: 'myTime',
  achievements: 'mostProudOf', philosophy: 'philosophy', projects: 'projects', certifications: 'certifications',
  publications: 'publications', style: 'style', layout: 'layout',
  experiences: 'experiences', educations: 'educations', myTime: 'myTime', mostProudOf: 'mostProudOf',
};

// resume_state.data is a json field with PocketBase's default 1 MB cap (1700000000_init_resume.js:17).
var DATA_MAX_BYTES = 1048576;
// Photo files: a base64 data URL is ~4/3 of the file, so ~700 KB keeps a resume under the cap.
var PHOTO_MAX_BYTES = 700 * 1024;
// FileReader.readAsDataURL takes the MIME type from the file (PersonalForm.tsx:10-22).
var PHOTO_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };

/* ================================================================ helpers */

function OpError(status, code, message, field) {
  this.__op = true;
  this.status = status;
  this.code = code;
  this.message = message;
  this.field = field || null;
}
function fail(status, code, message, field) {
  throw new OpError(status, code, message, field);
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
function nowIso() {
  return new Date().toISOString();
}
function has(p, k) {
  return p[k] !== undefined && p[k] !== null;
}

/** Params: query (GET) merged with the JSON body (POST); the body wins. */
function readParams(e) {
  var out = {};
  var info = null;
  try {
    info = e.requestInfo();
  } catch (_) {
    info = null;
  }
  if (!info) return out;
  var q = info.query || {};
  for (var k in q) out[k] = q[k];
  var b = info.body || {};
  for (var k2 in b) out[k2] = b[k2];
  return out;
}

/** The UI's PB load accepts a record iff data is an object with a truthy `personal` (ResumeContext.tsx:123). */
function isUiResume(data) {
  return !!(data && typeof data === 'object' && !Array.isArray(data) && data.personal);
}

function readData(rec) {
  var raw = '';
  try {
    raw = rec.getString('data');
  } catch (_) {
    raw = '';
  }
  if (!raw || raw === 'null') return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/** INITIAL_RESUME with a fresh updatedAt (presets.ts:158). */
function initialResume() {
  var r = clone(INITIAL_RESUME_BASE);
  r.updatedAt = nowIso();
  return r;
}

/**
 * Exactly the UI's normalization on load (ResumeContext.tsx:125-142): missing
 * or malformed parts are filled from INITIAL_RESUME, the id becomes the
 * record id, the title falls back to 'Resume'.
 */
function normalize(recId, d) {
  var I = initialResume();
  var r = Object.assign({}, I, d);
  r.personal = Object.assign({}, I.personal, d.personal || {});
  r.experiences = Array.isArray(d.experiences) ? d.experiences : I.experiences;
  r.educations = Array.isArray(d.educations) ? d.educations : I.educations;
  r.skills = Array.isArray(d.skills) ? d.skills : I.skills;
  r.myTime = Array.isArray(d.myTime) ? d.myTime : I.myTime;
  r.mostProudOf = Array.isArray(d.mostProudOf) ? d.mostProudOf : I.mostProudOf;
  r.philosophy = d.philosophy && typeof d.philosophy === 'object' ? Object.assign({}, I.philosophy, d.philosophy) : I.philosophy;
  r.projects = Array.isArray(d.projects) ? d.projects : I.projects;
  r.certifications = Array.isArray(d.certifications) ? d.certifications : I.certifications;
  r.publications = Array.isArray(d.publications) ? d.publications : I.publications || [];
  r.sectionVisibility = Object.assign({}, I.sectionVisibility, d.sectionVisibility || {});
  r.sectionOrder = Array.isArray(d.sectionOrder) ? d.sectionOrder : I.sectionOrder;
  r.style = Object.assign({}, I.style, d.style || {});
  r.id = recId;
  r.title = d.title || 'Resume';
  return r;
}

/** Output copy: a data-URL photo (an uploaded file) is summarised, never dumped into agent context. */
function forOutput(value) {
  var v = clone(value);
  var shrink = function (p) {
    if (p && typeof p.photoUrl === 'string' && p.photoUrl.indexOf('data:') === 0) {
      var comma = p.photoUrl.indexOf(',');
      var head = comma > 0 ? p.photoUrl.slice(0, comma + 1) : 'data:';
      p.photoUrl = head + '... (' + Math.round(p.photoUrl.length / 1024) + ' KB uploaded image, elided)';
    }
  };
  if (v && v.personal) shrink(v.personal);
  else shrink(v);
  return v;
}

function utf8Length(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function base64(bytes) {
  // Goja has no btoa/Buffer; $os.readFile returns an array of byte values.
  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = [];
  var n = bytes.length;
  for (var i = 0; i < n; i += 3) {
    var b0 = bytes[i] & 255;
    var b1 = i + 1 < n ? bytes[i + 1] & 255 : 0;
    var b2 = i + 2 < n ? bytes[i + 2] & 255 : 0;
    var t = (b0 << 16) | (b1 << 8) | b2;
    out.push(A.charAt((t >> 18) & 63) + A.charAt((t >> 12) & 63) + (i + 1 < n ? A.charAt((t >> 6) & 63) : '=') + (i + 2 < n ? A.charAt(t & 63) : '='));
  }
  return out.join('');
}

/* ---------------------------------------------------------- value checks */

function asText(v, field) {
  if (typeof v === 'number' && isFinite(v)) return String(v);
  if (typeof v !== 'string') fail(400, 'invalid_param', field + ' must be text.', field);
  return v;
}
/** One-line inputs (<input type=text>) cannot hold line breaks. */
function lineValue(v, field) {
  var s = asText(v, field);
  if (/[\r\n]/.test(s)) fail(400, 'invalid_param', field + ' is a one-line field in the app; remove the line breaks.', field);
  return s;
}
/** Textareas store line breaks as \n. */
function multiValue(v, field) {
  return asText(v, field).replace(/\r\n?/g, '\n');
}
function boolValue(v, field) {
  if (v === true || v === false) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fail(400, 'invalid_param', field + ' must be true or false.', field);
}
function enumValue(v, values, field) {
  var s = typeof v === 'string' ? v : String(v);
  if (values.indexOf(s) < 0) fail(400, 'invalid_param', field + ' must be one of: ' + values.join(', ') + '.', field);
  return s;
}
/** My Time percentage: <input type=number min=1 max=100>, stored via Number() (MyTimeForm.tsx:54-58); clearing it stores 0. */
function pctValue(v, field) {
  var n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!isFinite(n) || n < 0 || n > 100) fail(400, 'invalid_param', field + ' must be a number from 0 to 100.', field);
  return n;
}
/** <input type=color> yields lowercase #rrggbb (MyTimeForm.tsx:36-40). */
function hexValue(v, field) {
  var s = asText(v, field);
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) fail(400, 'invalid_param', field + ' must be a colour like #1d4ed8.', field);
  return s.toLowerCase();
}
function fieldValue(kind, v, field) {
  if (Array.isArray(kind)) return enumValue(v, kind, field);
  if (kind === 'line') return lineValue(v, field);
  if (kind === 'multi') return multiValue(v, field);
  if (kind === 'bool') return boolValue(v, field);
  if (kind === 'pct') return pctValue(v, field);
  if (kind === 'hex') return hexValue(v, field);
  return fail(500, 'operation_failed', 'unknown field kind for ' + field);
}

var NO_CONTROL_HINT = {
  location: 'experience location has no control in the app; only a JSON import (resumes.import) sets it.',
  fieldOfStudy: 'education fieldOfStudy has no control in the app; only a JSON import (resumes.import) sets it.',
  secondaryColor: 'secondaryColor has no control in the app; only a JSON import (resumes.import) sets it.',
  showPageNumbers: 'showPageNumbers has no control in the app; only a JSON import (resumes.import) sets it.',
  templateId: 'change the template with style.set-template (it also resets the font and section visibility, as the app does).',
  template: 'change the template with style.set-template (it also resets the font and section visibility, as the app does).',
  id: 'item ids are set by the app; pass the item to change as --item.',
};

/** Validate the field params an op accepts; refuse anything else (never guess). */
function readFields(p, fields, control) {
  var out = {};
  var count = 0;
  for (var k in p) {
    if (control.indexOf(k) >= 0) continue;
    if (!Object.prototype.hasOwnProperty.call(fields, k)) {
      var hint = NO_CONTROL_HINT[k] || 'allowed fields: ' + Object.keys(fields).join(', ') + '.';
      fail(400, 'unknown_param', 'Unknown parameter "' + k + '": ' + hint, k);
    }
    if (p[k] === undefined || p[k] === null) continue;
    out[k] = fieldValue(fields[k], p[k], k);
    count++;
  }
  return { values: out, count: count };
}

function resumeIdParam(p, allowIdAlias) {
  var id = has(p, 'resume') ? p.resume : allowIdAlias && has(p, 'id') ? p.id : '';
  id = String(id || '').trim();
  if (!id) fail(400, 'invalid_param', 'resume is required: the record id from resumes.list.', 'resume');
  return id;
}

/* ------------------------------------------------------------ record access */

/**
 * Older versions of the app saved a person's edits into a second record whose
 * `key` is the id of the resume they had open. Such a leftover copy is an
 * ordinary resume now; this names the resume it was copied from.
 */
function shadowOf(app, rec) {
  var key = rec.getString('key');
  if (!/^[a-z0-9]{15}$/.test(key) || key === rec.id) return null;
  try {
    var other = app.findRecordById('resume_state', key);
    return isUiResume(readData(other)) ? key : null;
  } catch (_) {
    return null;
  }
}

function loadResume(app, id) {
  var rec = null;
  try {
    rec = app.findRecordById('resume_state', id);
  } catch (_) {
    fail(404, 'not_found', 'No resume with id ' + id + '. Run resumes.list for the ids.', 'resume');
  }
  var data = readData(rec);
  if (!isUiResume(data)) {
    fail(404, 'not_a_resume', 'Record ' + id + ' is not a resume the app shows (its data has no personal section).', 'resume');
  }
  var resume = normalize(rec.id, data);
  return { rec: rec, data: data, resume: resume, shadowOf: shadowOf(app, rec) };
}

/** Store a resume object (plain object, never a string). */
function storeResume(app, rec, resume) {
  var bytes = utf8Length(JSON.stringify(resume));
  if (bytes > DATA_MAX_BYTES) {
    fail(400, 'too_large', 'The resume would be ' + Math.round(bytes / 1024) + ' KB; the app stores at most 1024 KB per resume (usually a large photo).');
  }
  rec.set('data', resume);
  try {
    app.save(rec);
  } catch (err) {
    fail(400, 'save_rejected', 'PocketBase refused the save: ' + (err && err.message ? err.message : err));
  }
}

/**
 * Read-modify-write one resume inside a transaction (serializes concurrent
 * agent calls). `mutate(resume, ctx)` changes the normalized resume in place
 * and returns the op's result. The stored id is the record id and updatedAt
 * is stamped, as every UI save does (ResumeContext.tsx:192-212, 310-596).
 */
function withResume(app, p, mutate) {
  var id = resumeIdParam(p, false);
  var out = null;
  var failure = null;
  app.runInTransaction(function (tx) {
    try {
      var ctx = loadResume(tx, id);
      var r = ctx.resume;
      var result = mutate(r, ctx) || {};
      r.updatedAt = nowIso();
      storeResume(tx, ctx.rec, r);
      out = { resume: { id: ctx.rec.id, title: r.title, updatedAt: r.updatedAt } };
      for (var k in result) out[k] = result[k];
    } catch (err) {
      failure = err;
    }
  });
  if (failure) throw failure;
  return out;
}

/** A new resume record: record id = key = the resume's own id, as the UI creates it (ResumeContext.tsx:199). */
function createResumeRecord(app, resume) {
  var collection = app.findCollectionByNameOrId('resume_state');
  var rec = new Record(collection);
  rec.set('id', resume.id);
  rec.set('key', resume.id);
  storeResume(app, rec, resume);
  return rec;
}

/** A free record id for a new resume: 15 × a-z0-9, as the UI makes them (ResumeContext.tsx:65-68). */
function newResumeId(app) {
  for (;;) {
    var id = $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789');
    try {
      app.findRecordById('resume_state', id);
    } catch (_) {
      return id;
    }
  }
}

/** `<prefix>-<ms>` as the UI's add buttons make, bumped while taken in this section. */
function newItemId(prefix, list) {
  var ts = Date.now();
  var used = {};
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) used[String(list[i].id)] = true;
  while (used[prefix + '-' + ts]) ts++;
  return prefix + '-' + ts;
}

function visibleResumes(app) {
  var rows = Array.from(app.findRecordsByFilter('resume_state', 'id != ""', '-created', 0, 0));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var data = readData(rows[i]);
    if (isUiResume(data)) out.push({ rec: rows[i], data: data });
  }
  return out;
}

/* ===================================================== score + exports */

// utils/scoreCalculator.ts:3-7 (verbatim).
var ACTION_VERBS = [
  'spearheaded', 'engineered', 'architected', 'led', 'scaled', 'built', 'redesigned',
  'accelerated', 'optimized', 'pioneered', 'transformed', 'delivered', 'launched',
  'implemented', 'championed', 'orchestrated', 'streamlined', 'cut', 'grew', 'doubled'
];

// utils/scoreCalculator.ts:9-110 (verbatim port of calculateResumeScore).
function calculateResumeScore(resume) {
  var personal = resume.personal, experiences = resume.experiences, skills = resume.skills, myTime = resume.myTime,
    mostProudOf = resume.mostProudOf, philosophy = resume.philosophy, projects = resume.projects;

  var contactScore = 0;
  if (personal.fullName) contactScore += 4;
  if (personal.jobTitle) contactScore += 4;
  if (personal.email) contactScore += 4;
  if (personal.phone) contactScore += 3;
  if (personal.location) contactScore += 3;
  if (personal.linkedin || personal.github || personal.website) contactScore += 2;
  var contactCompleteness = Math.min(20, contactScore);

  var summaryScore = 0;
  var summaryText = personal.summary || '';
  var wordCount = summaryText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 15) summaryScore += 10;
  if (wordCount >= 30) summaryScore += 6;
  if (wordCount >= 45) summaryScore += 4;
  var summaryQuality = Math.min(20, summaryScore);

  var verbScore = 0;
  if (experiences.length >= 1) verbScore += 5;
  var actionVerbCount = 0;
  var expText = experiences.map(function (e) { return e.description.toLowerCase(); }).join(' ');
  ACTION_VERBS.forEach(function (verb) {
    if (expText.includes(verb)) actionVerbCount++;
  });
  verbScore += Math.min(15, actionVerbCount * 5);
  var actionVerbs = Math.min(20, verbScore);

  var metricRegex = /(\d+%\b|\$\d+|\d+M\b|\d+k\b|\b\d+\+\b|\b\d{2,}\b)/g;
  var metricMatches = (expText.match(metricRegex) || []).length;
  var quantifiableMetrics = Math.min(20, metricMatches * 5);

  var visualScore = 0;
  if (skills.length >= 3) visualScore += 7;
  if ((myTime && myTime.length >= 2) || (mostProudOf && mostProudOf.length >= 2)) visualScore += 7;
  if ((projects && projects.length >= 1) || (philosophy && philosophy.quote)) visualScore += 6;
  var visualHighlights = Math.min(20, visualScore);

  var totalScore = contactCompleteness + summaryQuality + actionVerbs + quantifiableMetrics + visualHighlights;

  var suggestions = [];
  if (quantifiableMetrics < 15) {
    suggestions.push({ id: 'metric-tip', type: 'warning',
      message: 'Add quantifiable metrics (percentages %, dollar amounts $, or numbers) to prove impact in Work Experience.' });
  }
  if (actionVerbs < 15) {
    suggestions.push({ id: 'verb-tip', type: 'warning',
      message: 'Use strong action verbs (e.g. Spearheaded, Engineered, Architected, Scaled) to start experience bullets.' });
  }
  if (myTime.length < 2 || mostProudOf.length < 2) {
    suggestions.push({ id: 'visual-tip', type: 'tip',
      message: 'Fill out "My Time" pie graph and "Most Proud Of" badges to make your resume stand out with visual highlights.' });
  }
  if (wordCount < 30) {
    suggestions.push({ id: 'summary-tip', type: 'tip',
      message: 'Expand your Summary section to 30+ words highlighting key value prop & total years experience.' });
  }
  if (totalScore >= 85) {
    suggestions.push({ id: 'all-good', type: 'success', message: 'Awesome job! Your resume scores high across all 5 core criteria!' });
  }

  return {
    score: totalScore,
    breakdown: {
      contactCompleteness: contactCompleteness,
      summaryQuality: summaryQuality,
      actionVerbs: actionVerbs,
      quantifiableMetrics: quantifiableMetrics,
      visualHighlights: visualHighlights,
    },
    suggestions: suggestions,
  };
}

// components/Header.tsx:37-93 — exportWord. The lines below are copied
// verbatim from Header.tsx:38-83 (template whitespace included) so the file
// is byte-identical to the app's download; the Blob gets a '﻿' prefix (:86).
function exportWordContent(resume) {
    const { personal, experiences, educations, skills } = resume;
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${personal.fullName} Resume</title>
      <style>
        body { font-family: Calibri, Arial, sans-serif; margin: 24pt; color: #1e293b; }
        h1 { font-size: 24pt; margin-bottom: 2pt; color: #0f172a; }
        h2 { font-size: 14pt; border-bottom: 2px solid #0f172a; padding-bottom: 3pt; margin-top: 14pt; color: #0f172a; }
        .contact { font-size: 10pt; color: #64748b; margin-bottom: 14pt; }
        .item-title { font-weight: bold; font-size: 11pt; color: #0f172a; }
        .item-date { font-style: italic; color: #64748b; font-size: 10pt; }
        p, li { font-size: 10.5pt; line-height: 1.5; color: #334155; }
      </style>
      </head>
      <body>
        <h1>${personal.fullName}</h1>
        <div class="contact">
          ${[personal.jobTitle, personal.email, personal.phone, personal.location].filter(Boolean).join(' | ')}
        </div>
        ${personal.summary ? `<h2>Profile</h2><p>${personal.summary}</p>` : ''}
        ${experiences.length > 0 ? `
          <h2>Work Experience</h2>
          ${experiences.map(exp => `
            <div style="margin-bottom: 10pt;">
              <div class="item-title">${exp.position} - ${exp.company}</div>
              <div class="item-date">${exp.startDate} - ${exp.endDate}</div>
              <p>${exp.description}</p>
            </div>
          `).join('')}
        ` : ''}
        ${educations.length > 0 ? `
          <h2>Education</h2>
          ${educations.map(edu => `
            <div style="margin-bottom: 8pt;">
              <div class="item-title">${edu.degree}, ${edu.institution}</div>
              <div class="item-date">${edu.startDate} - ${edu.endDate}</div>
            </div>
          `).join('')}
        ` : ''}
        ${skills.length > 0 ? `
          <h2>Skills</h2>
          <p>${skills.map(sk => `<b>${sk.name}</b> (${sk.proficiency || 'Advanced'})`).join(' • ')}</p>
        ` : ''}
      </body>
      </html>
    `;
  return '﻿' + htmlContent;
}

// components/Header.tsx:95-143 — exportLatex. Lines copied verbatim from Header.tsx:96-134.
function exportLatexContent(resume) {
    const { personal, experiences, educations, skills } = resume;
    let tex = `\\documentclass[11pt,a4paper]{article}\n`;
    tex += `\\usepackage[utf8]{inputenc}\n`;
    tex += `\\usepackage[margin=0.75in]{geometry}\n`;
    tex += `\\usepackage{hyperref}\n\n`;
    tex += `\\begin{document}\n\n`;
    tex += `\\centerline{\\Huge \\bfseries ${personal.fullName}}\n`;
    tex += `\\vspace{4pt}\n`;
    tex += `\\centerline{${[personal.jobTitle, personal.email, personal.phone, personal.location].filter(Boolean).join(' $|$ ')}}\n`;
    tex += `\\vspace{14pt}\n\n`;

    if (personal.summary) {
      tex += `\\section*{Profile}\n${personal.summary}\n\\vspace{10pt}\n\n`;
    }

    if (experiences.length > 0) {
      tex += `\\section*{Work Experience}\n`;
      experiences.forEach(exp => {
        tex += `\\textbf{${exp.position}} \\hfill {\\small ${exp.startDate} -- ${exp.endDate}}\\\\ \n`;
        tex += `\\textit{${exp.company}}\\\\ \n`;
        tex += `${exp.description.replace(/•/g, '\\item')}\n\\vspace{8pt}\n\n`;
      });
    }

    if (educations.length > 0) {
      tex += `\\section*{Education}\n`;
      educations.forEach(edu => {
        tex += `\\textbf{${edu.degree}} -- \\textit{${edu.institution}} \\hfill {\\small ${edu.startDate} -- ${edu.endDate}}\\\\ \n`;
      });
      tex += `\\vspace{10pt}\n\n`;
    }

    if (skills.length > 0) {
      tex += `\\section*{Skills}\n`;
      tex += skills.map(sk => `\\textbf{${sk.name}} (${sk.proficiency || 'Advanced'})`).join(' • ');
      tex += `\n\n`;
    }

    tex += `\\end{document}\n`;
  return tex;
}

/* ================================================== import shape check */

var ITEM_SPECS = {
  // types/resume.ts:58-128 — required (req) and optional (opt) item fields.
  experiences: { req: { id: 's', company: 's', position: 's', startDate: 's', endDate: 's', isCurrent: 'b', description: 's' }, opt: { location: 's' } },
  educations: { req: { id: 's', institution: 's', degree: 's', startDate: 's', endDate: 's' }, opt: { fieldOfStudy: 's', gpa: 's' } },
  skills: { req: { id: 's', name: 's' }, opt: { category: 's', proficiency: PROFICIENCIES } },
  myTime: { req: { id: 's', label: 's', percentage: 'n', color: 's' }, opt: {} },
  mostProudOf: { req: { id: 's', title: 's', description: 's', icon: ICONS }, opt: {} },
  projects: { req: { id: 's', title: 's', description: 's', technologies: 's' }, opt: { link: 's' } },
  certifications: { req: { id: 's', name: 's', issuer: 's', issueDate: 's' }, opt: { url: 's' } },
  publications: { req: { id: 's', title: 's' }, opt: { publisher: 's', date: 's', url: 's', description: 's' } },
};

function typeOk(kind, v) {
  if (Array.isArray(kind)) return typeof v === 'string' && kind.indexOf(v) >= 0;
  if (kind === 's') return typeof v === 'string';
  if (kind === 'b') return typeof v === 'boolean';
  if (kind === 'n') return typeof v === 'number' && isFinite(v);
  return false;
}
function kindName(kind) {
  if (Array.isArray(kind)) return 'one of ' + kind.join('|');
  return kind === 's' ? 'text' : kind === 'b' ? 'true/false' : 'a number';
}
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Shape check on top of the UI's own import test: everything the templates,
 * the score and the exports read must have the type the app's own data has
 * (types/resume.ts), so an imported document can never crash the app on load
 * (the templates render these values directly; a non-string description
 * breaks the score in scoreCalculator.ts:35).
 */
function shapeProblems(doc) {
  var problems = [];
  var add = function (s) { if (problems.length < 12) problems.push(s); };
  if (doc.title !== undefined && typeof doc.title !== 'string') add('title must be text');
  if (doc.personal !== undefined) {
    if (!isPlainObject(doc.personal)) add('personal must be an object');
    else {
      for (var pk in PERSONAL_FIELDS) {
        if (doc.personal[pk] !== undefined && typeof doc.personal[pk] !== 'string') add('personal.' + pk + ' must be text');
      }
    }
  }
  for (var listKey in ITEM_SPECS) {
    if (doc[listKey] === undefined) continue;
    var list = doc[listKey];
    if (!Array.isArray(list)) {
      add(listKey + ' must be a list');
      continue;
    }
    var spec = ITEM_SPECS[listKey];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var where = listKey + '[' + i + ']';
      if (!isPlainObject(item)) {
        add(where + ' must be an object');
        continue;
      }
      for (var rk in spec.req) {
        if (!typeOk(spec.req[rk], item[rk])) add(where + '.' + rk + ' is required and must be ' + kindName(spec.req[rk]));
      }
      for (var ok in spec.opt) {
        if (item[ok] !== undefined && !typeOk(spec.opt[ok], item[ok])) add(where + '.' + ok + ' must be ' + kindName(spec.opt[ok]));
      }
      if (typeof item.id === 'string') {
        if (!item.id) add(where + '.id must not be empty');
        else if (seen[item.id]) add(where + '.id "' + item.id + '" is used twice in ' + listKey);
        seen[item.id] = true;
      }
    }
  }
  if (doc.philosophy !== undefined) {
    if (!isPlainObject(doc.philosophy)) add('philosophy must be an object');
    else {
      if (doc.philosophy.quote !== undefined && typeof doc.philosophy.quote !== 'string') add('philosophy.quote must be text');
      if (doc.philosophy.author !== undefined && typeof doc.philosophy.author !== 'string') add('philosophy.author must be text');
    }
  }
  if (doc.sectionVisibility !== undefined) {
    if (!isPlainObject(doc.sectionVisibility)) add('sectionVisibility must be an object');
    else {
      for (var vk in doc.sectionVisibility) {
        if (typeof doc.sectionVisibility[vk] !== 'boolean') add('sectionVisibility.' + vk + ' must be true or false');
      }
    }
  }
  if (doc.sectionOrder !== undefined) {
    if (!Array.isArray(doc.sectionOrder)) add('sectionOrder must be a list');
    else {
      var seenS = {};
      for (var s = 0; s < doc.sectionOrder.length; s++) {
        var key = doc.sectionOrder[s];
        if (SECTION_KEYS.indexOf(key) < 0) add('sectionOrder[' + s + '] must be one of ' + SECTION_KEYS.join('|'));
        else if (seenS[key]) add('sectionOrder lists ' + key + ' twice');
        seenS[key] = true;
      }
    }
  }
  if (doc.style !== undefined) {
    if (!isPlainObject(doc.style)) add('style must be an object');
    else {
      var st = doc.style;
      var enumOf = function (pairs) { return pairs.map(function (x) { return x[0]; }); };
      if (st.templateId !== undefined && TEMPLATE_IDS.indexOf(st.templateId) < 0) add('style.templateId must be one of the 34 template ids (style.options)');
      if (st.fontFamily !== undefined && enumOf(FONT_OPTIONS).indexOf(st.fontFamily) < 0) add('style.fontFamily must be one of ' + enumOf(FONT_OPTIONS).join('|'));
      if (st.fontSize !== undefined && enumOf(FONT_SIZES).indexOf(st.fontSize) < 0) add('style.fontSize must be one of ' + enumOf(FONT_SIZES).join('|'));
      if (st.lineSpacing !== undefined && enumOf(LINE_SPACINGS).indexOf(st.lineSpacing) < 0) add('style.lineSpacing must be one of ' + enumOf(LINE_SPACINGS).join('|'));
      if (st.photoShape !== undefined && enumOf(PHOTO_SHAPES).indexOf(st.photoShape) < 0) add('style.photoShape must be one of ' + enumOf(PHOTO_SHAPES).join('|'));
      if (st.accentColor !== undefined && typeof st.accentColor !== 'string') add('style.accentColor must be text');
      if (st.secondaryColor !== undefined && typeof st.secondaryColor !== 'string') add('style.secondaryColor must be text');
      if (st.showPageNumbers !== undefined && typeof st.showPageNumbers !== 'boolean') add('style.showPageNumbers must be true or false');
    }
  }
  return problems;
}

/* ============================================================ operations */

function opGuide() {
  var sections = {};
  for (var name in SECTIONS) {
    var s = SECTIONS[name];
    sections[name] = {
      dataKey: s.key,
      newItemsGo: s.top ? 'first' : 'last',
      fields: Object.keys(s.fields).map(function (f) {
        var k = s.fields[f];
        return f + (Array.isArray(k) ? ' (' + k.join('|') + ')' : k === 'multi' ? ' (multi-line)' : k === 'bool' ? ' (true|false)' : k === 'pct' ? ' (0-100)' : k === 'hex' ? ' (#rrggbb)' : '');
      }),
      defaultsWhenAdded: s.defaults({ myTime: [] }),
    };
  }
  sections.skills.defaultsWhenAdded.name = '(required)';
  return {
    guide: {
      app: 'Resume Maker: several resumes, each edited section by section and shown in one of 34 templates.',
      addressing: 'Every operation on a resume takes --resume {id}: the record id from resumes.list. Items inside a section are addressed by --item {item id} (from resumes.get or the add result).',
      reload: 'The app reads the database only when it is opened. After you change something, ask the person to reload the app to see it. An editor that is already open keeps showing the old version until then. An edit the person made while the app could not reach its database is saved when they next open it, over your change to that resume.',
      duplicateCopies: 'The app saves a person\'s edits, and their deletes, into the record they opened, the same record these operations use. Older versions of the app saved edits into a second record whose key is the id of the resume that was open; resumes.list marks such a leftover copy with shadowOf (the original\'s id). It is an ordinary resume with the same title and possibly newer edits: ask the person which one to keep before deleting either.',
      sampleContent: 'resumes.create fills the new resume with a random sample person, like the New button: replace every section afterwards. resumes.import keeps the app\'s sample (Alex River) for each section or personal field the document lacks; check filledFromSample in its result.',
      text: 'One-line fields refuse line breaks; multi-line fields are personal summary, experience/project/publication description and the philosophy quote. Bullets are lines starting with "• " joined by line breaks (what the Enter key and the action-verb buttons produce). The app\'s action-verb buttons: ' + SUGGESTED_VERBS.join(', ') + '.',
      sections: sections,
      layout: 'layout.set-visibility shows or hides a section; layout.move moves it one step. Templates that omit a section (style.options, omits) never show it.',
      style: 'style.set-template also resets the font to the template default and re-applies the template\'s section visibility, as the app does. style.update sets accent (8 swatches), font, size, line spacing and photo shape.',
      limits: 'PDF export and printing happen in the browser only: ask the person to use Export, then PDF. resumes.export returns the JSON backup, Word and LaTeX files. Items cannot be reordered inside a section in the app: remove and re-add them. Experience location, education field of study, secondary colour and page numbers have no control in the app; only resumes.import sets them.',
      examples: [
        'a2app <app> resumes resumes.list',
        'a2app <app> resumes resumes.get --resume {id} --section experience',
        'a2app <app> experience experience.add --resume {id} --position "CTO" --company "Acme" --startDate "2019" --isCurrent false --endDate "2023" --description "• Led the platform team of 12"',
        'a2app <app> skills skills.add --resume {id} --name "Python" --category "Programming Languages" --proficiency Expert',
        'a2app <app> style style.set-template --resume {id} --template ivy_league',
        'a2app <app> resumes resumes.score --resume {id}',
      ],
    },
  };
}

// Header.tsx:189-201 (dropdown) from ResumeContext.tsx:116-152 (load, newest first).
function opList(app) {
  var rows = visibleResumes(app);
  var ids = {};
  for (var i = 0; i < rows.length; i++) ids[rows[i].rec.id] = true;
  var out = [];
  for (var j = 0; j < rows.length; j++) {
    var rec = rows[j].rec;
    var r = normalize(rec.id, rows[j].data);
    var key = rec.getString('key');
    out.push({
      id: rec.id,
      key: key,
      title: r.title,
      fullName: r.personal.fullName,
      jobTitle: r.personal.jobTitle,
      templateId: r.style.templateId,
      updatedAt: typeof rows[j].data.updatedAt === 'string' ? rows[j].data.updatedAt : '',
      created: rec.getString('created'),
      updated: rec.getString('updated'),
      shadowOf: key !== rec.id && ids[key] ? key : null,
    });
  }
  return { count: out.length, resumes: out };
}

function layoutRows(r) {
  var supported = supportedSections(r.style.templateId);
  var sv = r.sectionVisibility;
  // VisibilityForm.tsx:54-56 — a row is shown iff visible and supported by the template.
  return r.sectionOrder.map(function (key) {
    var sup = supported[key] !== false;
    return { section: key, label: SECTION_LABELS[key] || key, visible: sv[key] !== false, supportedByTemplate: sup, shown: sv[key] !== false && sup };
  });
}

function myTimeTotal(list) {
  // MyTimeForm.tsx:9 — the form's total and its "recommended to equal 100%" hint.
  var t = list.reduce(function (sum, item) { return sum + Number(item.percentage || 0); }, 0);
  return { total: t, totalIs100: t === 100 };
}

// What the editor and preview show: ResumeContext.tsx:123-142, 175.
function opGet(app, p) {
  var ctx = loadResume(app, resumeIdParam(p, true));
  var r = ctx.resume;
  var meta = { key: ctx.rec.getString('key'), created: ctx.rec.getString('created'), updated: ctx.rec.getString('updated'), shadowOf: ctx.shadowOf };
  if (has(p, 'section') && String(p.section) !== '') {
    var section = String(p.section);
    var dataKey = SECTION_PARAM[section];
    if (!dataKey) fail(400, 'invalid_param', 'section must be one of: personal, experience, education, skills, mytime, achievements, philosophy, projects, certifications, publications, style, layout.', 'section');
    var out = { id: ctx.rec.id, title: r.title, section: dataKey };
    if (dataKey === 'layout') {
      out.value = { sectionOrder: r.sectionOrder, rows: layoutRows(r) };
    } else {
      out.value = forOutput(r[dataKey]);
      if (dataKey === 'myTime') {
        var tot = myTimeTotal(r.myTime);
        out.total = tot.total;
        out.totalIs100 = tot.totalIs100;
      }
    }
    return out;
  }
  var res = { resume: forOutput(r) };
  for (var k in meta) res[k] = meta[k];
  return res;
}

// Header.tsx:254-266, 421-490; ResumeContext.tsx:241.
function opScore(app, p) {
  var ctx = loadResume(app, resumeIdParam(p, true));
  var s = calculateResumeScore(ctx.resume);
  s.id = ctx.rec.id;
  s.title = ctx.resume.title;
  return s;
}

// Header.tsx:285-363 (Export menu); PDF is window.print() and stays in the browser.
function opExport(app, p) {
  var ctx = loadResume(app, resumeIdParam(p, true));
  var r = ctx.resume; // the UI's active resume: id = record id (ResumeContext.tsx:140)
  var format = has(p, 'format') ? String(p.format) : '';
  var base = r.personal.fullName.replace(/\s+/g, '_') + '_Resume';
  if (format === 'json') {
    // ResumeContext.tsx:630-638
    return { format: 'json', filename: base + '.json', mimeType: 'text/json;charset=utf-8', content: JSON.stringify(r, null, 2) };
  }
  if (format === 'word') {
    // Header.tsx:86-89 — the menu says .docx; the app downloads HTML as .doc.
    return { format: 'word', filename: base + '.doc', mimeType: 'application/msword', content: exportWordContent(r) };
  }
  if (format === 'latex') {
    // Header.tsx:136-139
    return { format: 'latex', filename: base + '.tex', mimeType: 'text/x-tex;charset=utf-8', content: exportLatexContent(r) };
  }
  if (format === 'pdf') {
    fail(400, 'browser_only', 'PDF export uses the browser\'s print dialog; ask the person to click Export, then PDF.', 'format');
  }
  return fail(400, 'invalid_param', 'format must be one of: json, word, latex.', 'format');
}

// utils/randomCandidateGenerator.ts:262-321 (generateRandomCandidate, with the timestamp passed in).
function generateRandomCandidate(title, timestamp) {
  var randomPersona = CANDIDATE_POOL[Math.floor(Math.random() * CANDIDATE_POOL.length)] || CANDIDATE_POOL[0];
  var I = initialResume();
  var withId = function (list, prefix) {
    return list.map(function (x, i) { return Object.assign({}, x, { id: prefix + '-' + timestamp + '-' + i }); });
  };
  return Object.assign({}, I, {
    id: 'resume-' + timestamp,
    title: title || randomPersona.fullName + ' Resume',
    personal: {
      fullName: randomPersona.fullName,
      jobTitle: randomPersona.jobTitle,
      email: randomPersona.email,
      phone: randomPersona.phone,
      location: randomPersona.location,
      website: randomPersona.website,
      linkedin: randomPersona.linkedin,
      github: 'github.com/' + randomPersona.fullName.toLowerCase().replace(/\s+/g, ''),
      photoUrl: randomPersona.photoUrl,
      summary: randomPersona.summary,
    },
    experiences: withId(randomPersona.experiences, 'exp'),
    educations: withId(randomPersona.educations, 'edu'),
    skills: withId(randomPersona.skills, 'sk'),
    myTime: withId(randomPersona.myTime, 'mt'),
    mostProudOf: withId(randomPersona.mostProudOf, 'mp'),
    philosophy: Object.assign({}, randomPersona.philosophy),
    certifications: [
      { id: 'cert-' + timestamp + '-0', name: 'AWS Certified Solutions Architect (Professional)', issuer: 'Amazon Web Services', issueDate: '2023', url: 'https://aws.amazon.com/verification' },
      { id: 'cert-' + timestamp + '-1', name: 'Certified Kubernetes Administrator (CKA)', issuer: 'Linux Foundation / CNCF', issueDate: '2024', url: 'https://cncf.io/certification/cka' },
    ],
    publications: [
      { id: 'pub-' + timestamp + '-0', title: 'Scalable Micro-Frontends Architecture with Design Tokens', publisher: 'IEEE Software Tech Journal', date: '2023',
        url: 'https://ieee.org/publications/micro-frontends-2023',
        description: 'Peer-reviewed research paper detailing high-performance tokenized web architectures and atomic UI component libraries.' },
    ],
    style: Object.assign({}, I.style, { accentColor: '#0f172a' }),
    updatedAt: new Date(timestamp).toISOString(),
  });
}

// New button: Header.tsx:203-215 (modal prefilled "Resume #N", 163-172 trims, refuses empty);
// ResumeContext.tsx:251-256 → generateRandomCandidate(title) with a new record id.
function opCreate(app, p) {
  var out = null;
  var failure = null;
  app.runInTransaction(function (tx) {
    try {
      var title;
      if (has(p, 'title')) {
        title = lineValue(p.title, 'title').trim();
        if (!title) fail(400, 'invalid_param', 'title must not be empty (the New Resume dialog does not submit an empty name).', 'title');
      } else {
        title = 'Resume #' + (visibleResumes(tx).length + 1);
      }
      var r = generateRandomCandidate(title, Date.now());
      r.id = newResumeId(tx);
      var rec = createResumeRecord(tx, r);
      out = { resume: { id: rec.id, key: r.id, title: r.title }, samplePerson: r.personal.fullName,
        note: 'Filled with a random sample person, like the New button. Replace each section with the real content next.' };
    } catch (err) {
      failure = err;
    }
  });
  if (failure) throw failure;
  return out;
}

// Import: Header.tsx:145-161 (file picker, accept=.json, alert on failure); ResumeContext.tsx:640-664.
function opImport(app, p) {
  var IMPORT_FAILED = 'Failed to import JSON file. Please ensure it is a valid resume export.'; // Header.tsx:154
  var hasJson = has(p, 'json');
  var hasPath = has(p, 'path') && String(p.path) !== '';
  if (hasJson === hasPath) fail(400, 'invalid_param', 'Pass exactly one of json (the backup text) or path (an absolute path to a .json file).', hasJson ? 'path' : 'json');
  var parsed;
  if (hasPath) {
    var path = String(p.path);
    if (!/\.json$/i.test(path)) fail(400, 'invalid_param', 'path must be a .json file (the app\'s import picker accepts .json).', 'path');
    var text = '';
    try {
      text = toString($os.readFile(path));
    } catch (_) {
      fail(400, 'invalid_param', 'Cannot read ' + path + '.', 'path');
    }
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      fail(400, 'not_a_resume_export', IMPORT_FAILED, 'path');
    }
  } else if (typeof p.json === 'string') {
    try {
      parsed = JSON.parse(p.json);
    } catch (_) {
      fail(400, 'not_a_resume_export', IMPORT_FAILED, 'json');
    }
  } else {
    parsed = clone(p.json);
  }
  // The UI's own test (ResumeContext.tsx:643).
  if (!(parsed && (parsed.personal || parsed.experiences || parsed.title))) fail(400, 'not_a_resume_export', IMPORT_FAILED, hasPath ? 'path' : 'json');
  if (!isPlainObject(parsed)) fail(400, 'not_a_resume_export', IMPORT_FAILED, hasPath ? 'path' : 'json');
  var problems = shapeProblems(parsed);
  if (problems.length) {
    fail(400, 'invalid_shape', 'The document does not have the shape the app needs (it could break the app): ' + problems.join('; ') + '.', hasPath ? 'path' : 'json');
  }

  var out = null;
  var failure = null;
  app.runInTransaction(function (tx) {
    try {
      var newId = newResumeId(tx);
      var importedTitle = parsed.title || (parsed.personal && parsed.personal.fullName ? parsed.personal.fullName + ' Resume' : 'Imported Resume');
      var r = Object.assign({}, initialResume(), parsed, { id: newId, title: importedTitle, updatedAt: nowIso() });
      var rec = createResumeRecord(tx, r);
      // What will show the app's sample content (A4 normalization / the INITIAL_RESUME merge above).
      var filled = [];
      var known = Object.keys(INITIAL_RESUME_BASE);
      for (var i = 0; i < known.length; i++) {
        var k = known[i];
        if (k === 'id' || k === 'title') continue;
        if (parsed[k] === undefined) filled.push(k);
      }
      if (isPlainObject(parsed.personal)) {
        for (var pk in INITIAL_RESUME_BASE.personal) if (parsed.personal[pk] === undefined) filled.push('personal.' + pk);
      }
      if (isPlainObject(parsed.philosophy)) {
        for (var hk in INITIAL_RESUME_BASE.philosophy) if (parsed.philosophy[hk] === undefined) filled.push('philosophy.' + hk);
      }
      var unknown = [];
      for (var uk in parsed) if (known.indexOf(uk) < 0 && uk !== 'updatedAt') unknown.push(uk);
      out = { resume: { id: rec.id, key: newId, title: importedTitle }, filledFromSample: filled };
      if (unknown.length) out.unknownKeys = unknown;
    } catch (err) {
      failure = err;
    }
  });
  if (failure) throw failure;
  return out;
}

// Duplicate button: Header.tsx:230-238; ResumeContext.tsx:289-308.
function opDuplicate(app, p) {
  var id = resumeIdParam(p, true);
  var out = null;
  var failure = null;
  app.runInTransaction(function (tx) {
    try {
      var ctx = loadResume(tx, id);
      var target = ctx.resume; // in-memory resume: id = record id
      var baseTitle = target.title || target.personal.fullName || 'Resume';
      var copy = Object.assign(clone(target), { id: newResumeId(tx), title: baseTitle + ' Duplicate', updatedAt: nowIso() });
      var rec = createResumeRecord(tx, copy);
      out = { resume: { id: rec.id, key: copy.id, title: copy.title }, source: ctx.rec.id };
    } catch (err) {
      failure = err;
    }
  });
  if (failure) throw failure;
  return out;
}

// Rename: Header.tsx:217-228, 163-172; ResumeContext.tsx:282-287 (trimmed, empty ignored).
function opRename(app, p) {
  if (!has(p, 'resume') && has(p, 'id')) p.resume = p.id;
  var title = has(p, 'title') ? lineValue(p.title, 'title').trim() : '';
  if (!title) fail(400, 'invalid_param', 'title is required and must not be empty (the app ignores an empty name).', 'title');
  return withResume(app, p, function (r) {
    r.title = title;
    return {};
  });
}

// Delete: Header.tsx:240-248 + confirmation modal 492-538; ResumeContext.tsx:264-280
// (deleting the last resume leaves a fresh default one, :266-273).
function opDelete(app, p) {
  var id = resumeIdParam(p, true);
  var out = null;
  var failure = null;
  app.runInTransaction(function (tx) {
    try {
      var ctx = loadResume(tx, id);
      var title = ctx.resume.title;
      tx.delete(ctx.rec);
      out = { deleted: { id: id, title: title } };
      if (visibleResumes(tx).length === 0) {
        var fresh = Object.assign(initialResume(), { id: newResumeId(tx), title: 'Software Engineer Resume' });
        var rec = createResumeRecord(tx, fresh);
        out.replacement = { id: rec.id, key: fresh.id, title: fresh.title,
          note: 'It was the last resume, so the app\'s default sample resume took its place (as the app does).' };
      }
    } catch (err) {
      failure = err;
    }
  });
  if (failure) throw failure;
  return out;
}

// Toolbar.tsx:44-181 + types/resume.ts:202-232 + templateSections.ts:3-68.
function opStyleOptions() {
  var templates = [];
  for (var g = 0; g < TEMPLATE_GROUPS.length; g++) {
    for (var t = 0; t < TEMPLATE_GROUPS[g].templates.length; t++) {
      var id = TEMPLATE_GROUPS[g].templates[t][0];
      var sup = supportedSections(id);
      var omits = SECTION_KEYS.filter(function (k) { return sup[k] === false; });
      templates.push({ id: id, label: TEMPLATE_GROUPS[g].templates[t][1], group: TEMPLATE_GROUPS[g].group, defaultFont: templateDefaultFont(id), omits: omits });
    }
  }
  var pairs = function (list) { return list.map(function (x) { return { value: x[0], label: x[1] }; }); };
  return {
    templates: templates,
    accentColors: pairs(ACCENT_COLORS),
    fonts: pairs(FONT_OPTIONS),
    fontSizes: pairs(FONT_SIZES),
    lineSpacings: pairs(LINE_SPACINGS),
    photoShapes: pairs(PHOTO_SHAPES),
    note: 'fontFamily "Default" uses the template\'s own font (defaultFont). Accent colours are the app\'s 8 swatches.',
  };
}

// Template select: Toolbar.tsx:23-34 — template + font 'Default' + the template's section visibility.
function opSetTemplate(app, p) {
  var t = has(p, 'template') ? p.template : has(p, 'templateId') ? p.templateId : '';
  t = enumValue(t, TEMPLATE_IDS, 'template');
  return withResume(app, p, function (r) {
    r.style = Object.assign({}, r.style, { templateId: t, fontFamily: 'Default' });
    var supported = supportedSections(t);
    r.sectionVisibility = Object.assign({}, r.sectionVisibility);
    for (var k in supported) r.sectionVisibility[k] = supported[k];
    return { style: r.style, sectionVisibility: r.sectionVisibility, omits: SECTION_KEYS.filter(function (k2) { return supported[k2] === false; }) };
  });
}

// Accent swatches, font, scale, spacing, avatar: Toolbar.tsx:104-181; ResumeContext.tsx:318-324.
function opStyleUpdate(app, p) {
  var vals = function (pairs) { return pairs.map(function (x) { return x[0]; }); };
  var f = readFields(p, {
    accentColor: vals(ACCENT_COLORS),
    fontFamily: vals(FONT_OPTIONS),
    fontSize: vals(FONT_SIZES),
    lineSpacing: vals(LINE_SPACINGS),
    photoShape: vals(PHOTO_SHAPES),
  }, ['resume']);
  if (!f.count) fail(400, 'invalid_param', 'Give at least one of accentColor, fontFamily, fontSize, lineSpacing, photoShape.');
  return withResume(app, p, function (r) {
    r.style = Object.assign({}, r.style, f.values);
    return { style: r.style };
  });
}

// Layout tab eye button: VisibilityForm.tsx:25-27, 101; ResumeContext.tsx:326-332.
function opSetVisibility(app, p) {
  var section = enumValue(has(p, 'section') ? p.section : '', SECTION_KEYS, 'section');
  if (!has(p, 'visible')) fail(400, 'invalid_param', 'visible is required (true or false).', 'visible');
  var visible = boolValue(p.visible, 'visible');
  return withResume(app, p, function (r) {
    // The tab lists only the sections in sectionOrder (VisibilityForm.tsx:54).
    if (r.sectionOrder.indexOf(section) < 0) fail(400, 'refused', 'The Layout tab of this resume has no ' + section + ' row.', 'section');
    r.sectionVisibility = Object.assign({}, r.sectionVisibility);
    r.sectionVisibility[section] = visible;
    var row = layoutRows(r).filter(function (x) { return x.section === section; })[0];
    return { section: section, visible: visible, supportedByTemplate: row.supportedByTemplate, shown: row.shown };
  });
}

// Layout tab arrows: VisibilityForm.tsx:29-41, disabled at the ends (:85, :93); ResumeContext.tsx:334-340.
function opMove(app, p) {
  var section = enumValue(has(p, 'section') ? p.section : '', SECTION_KEYS, 'section');
  var direction = enumValue(has(p, 'direction') ? p.direction : '', ['up', 'down'], 'direction');
  return withResume(app, p, function (r) {
    var order = r.sectionOrder.slice();
    var index = order.indexOf(section);
    if (index < 0) fail(400, 'refused', 'The Layout tab of this resume has no ' + section + ' row.', 'section');
    var target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= order.length) {
      fail(400, 'refused', section + ' is already ' + (direction === 'up' ? 'first' : 'last') + ' (the app disables that arrow).', 'direction');
    }
    var a = order[index];
    order[index] = order[target];
    order[target] = a;
    r.sectionOrder = order;
    return { sectionOrder: order };
  });
}

// Personal tab + canvas inline edits: PersonalForm.tsx:30-189; ResumeContext.tsx:310-316, 599-605.
function opPersonalUpdate(app, p) {
  var f = readFields(p, PERSONAL_FIELDS, ['resume']);
  if (!f.count) fail(400, 'invalid_param', 'Give at least one of: ' + Object.keys(PERSONAL_FIELDS).join(', ') + '.');
  return withResume(app, p, function (r) {
    r.personal = Object.assign({}, r.personal, f.values);
    return { personal: forOutput(r.personal) };
  });
}

// "Upload Image File" / click the avatar: PersonalForm.tsx:10-22, 147-154 (FileReader.readAsDataURL).
function opSetPhoto(app, p) {
  var path = has(p, 'path') ? String(p.path) : '';
  if (!/^([A-Za-z]:[\\/]|\/)/.test(path)) fail(400, 'invalid_param', 'path must be the absolute path of an image file.', 'path');
  var m = /\.([A-Za-z0-9]+)$/.exec(path);
  var mime = m ? PHOTO_MIME[m[1].toLowerCase()] : null;
  if (!mime) fail(400, 'invalid_param', 'path must be an image (' + Object.keys(PHOTO_MIME).join(', ') + ').', 'path');
  var size = -1;
  try {
    var st = $os.stat(path);
    if (st.isDir()) fail(400, 'invalid_param', path + ' is a folder.', 'path');
    size = st.size();
  } catch (err) {
    if (err && err.__op) throw err;
    fail(400, 'invalid_param', 'Cannot read ' + path + '.', 'path');
  }
  if (size > PHOTO_MAX_BYTES) fail(400, 'too_large', 'The image is ' + Math.round(size / 1024) + ' KB; use one under ' + Math.round(PHOTO_MAX_BYTES / 1024) + ' KB (the app stores at most 1 MB per resume).', 'path');
  var bytes = $os.readFile(path);
  var dataUrl = 'data:' + mime + ';base64,' + base64(bytes);
  return withResume(app, p, function (r) {
    r.personal = Object.assign({}, r.personal, { photoUrl: dataUrl });
    return { photo: forOutput({ photoUrl: dataUrl }).photoUrl };
  });
}

// Philosophy tab: PhilosophyForm.tsx:26, 37; ResumeContext.tsx:498-504 (empty author → the person's name).
function opPhilosophy(app, p) {
  var f = readFields(p, { quote: 'multi', author: 'line' }, ['resume']);
  if (!f.count) fail(400, 'invalid_param', 'Give quote and/or author.');
  return withResume(app, p, function (r) {
    var quote = f.values.quote !== undefined ? f.values.quote : r.philosophy.quote;
    var author = f.values.author !== undefined ? f.values.author : r.philosophy.author;
    r.philosophy = { quote: quote, author: author || r.personal.fullName };
    return { philosophy: r.philosophy };
  });
}

/* ---------------------------------------------------------- item sections */

/**
 * Apply validated field values to one item the way the form's inputs do.
 * Experience: the Current checkbox sets endDate to 'Present' / '' (ExperienceForm.tsx:103)
 * and the End Date input is disabled while Current is ticked (:93).
 */
function applyFields(sectionName, item, values) {
  var keys = Object.keys(values);
  if (sectionName === 'experience' && values.isCurrent !== undefined) {
    item.isCurrent = values.isCurrent;
    item.endDate = values.isCurrent ? 'Present' : '';
  }
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (sectionName === 'experience' && k === 'isCurrent') continue;
    if (sectionName === 'experience' && k === 'endDate' && item.isCurrent && values.endDate !== item.endDate) {
      fail(400, 'refused', 'endDate cannot be changed while isCurrent is true (the app disables End Date); send isCurrent false with it.', 'endDate');
    }
    item[k] = values[k];
  }
}

function itemResult(sectionName, r, extra) {
  var spec = SECTIONS[sectionName];
  extra.count = r[spec.key].length;
  if (sectionName === 'mytime') {
    var t = myTimeTotal(r.myTime);
    extra.total = t.total;
    extra.totalIs100 = t.totalIs100;
  }
  return extra;
}

// Add buttons (see SECTIONS for each section's source lines).
function opItemAdd(sectionName) {
  return function (app, p) {
    var spec = SECTIONS[sectionName];
    var f = readFields(p, spec.fields, ['resume']);
    if (sectionName === 'skills') {
      // SkillsForm.tsx:11-17 — the quick-add form needs a name and trims it.
      var nm = f.values.name !== undefined ? f.values.name.trim() : '';
      if (!nm) fail(400, 'invalid_param', 'name is required (the app\'s quick-add form needs a skill name).', 'name');
      f.values.name = nm;
    }
    return withResume(app, p, function (r) {
      var list = Array.isArray(r[spec.key]) ? r[spec.key] : [];
      var item = Object.assign({ id: newItemId(spec.prefix, list) }, spec.defaults(r));
      applyFields(sectionName, item, f.values);
      r[spec.key] = spec.top ? [item].concat(list) : list.concat([item]);
      return itemResult(sectionName, r, { item: item, position: spec.top ? 'first' : 'last' });
    });
  };
}

// Inputs on an item card: { ...item, ...patch } for every item with that id (ResumeContext.tsx:359-365 and siblings).
function opItemUpdate(sectionName) {
  return function (app, p) {
    var spec = SECTIONS[sectionName];
    var itemId = has(p, 'item') ? String(p.item) : '';
    if (!itemId) fail(400, 'invalid_param', 'item is required: the item id from resumes.get.', 'item');
    var f = readFields(p, spec.fields, ['resume', 'item']);
    if (!f.count) fail(400, 'invalid_param', 'Give at least one of: ' + Object.keys(spec.fields).join(', ') + '.');
    return withResume(app, p, function (r) {
      var list = r[spec.key];
      var found = null;
      var next = list.map(function (it) {
        if (!it || it.id !== itemId) return it;
        var copy = Object.assign({}, it);
        applyFields(sectionName, copy, f.values);
        if (!found) found = copy;
        return copy;
      });
      if (!found) fail(404, 'not_found', 'No ' + sectionName + ' item ' + itemId + ' in this resume.', 'item');
      r[spec.key] = next;
      return itemResult(sectionName, r, { item: found });
    });
  };
}

// Trash button on an item card (no confirmation in the app): filter by id (ResumeContext.tsx:367-373 and siblings).
function opItemRemove(sectionName) {
  return function (app, p) {
    var spec = SECTIONS[sectionName];
    var itemId = has(p, 'item') ? String(p.item) : '';
    if (!itemId) fail(400, 'invalid_param', 'item is required: the item id from resumes.get.', 'item');
    readFields(p, {}, ['resume', 'item']);
    return withResume(app, p, function (r) {
      var list = r[spec.key];
      var removed = list.filter(function (it) { return it && it.id === itemId; });
      if (!removed.length) fail(404, 'not_found', 'No ' + sectionName + ' item ' + itemId + ' in this resume.', 'item');
      r[spec.key] = list.filter(function (it) { return !(it && it.id === itemId); });
      return itemResult(sectionName, r, { removed: removed[0] });
    });
  };
}

/* ============================================================== dispatch */

var HANDLERS = {
  'app.guide': opGuide,
  'resumes.list': opList,
  'resumes.get': opGet,
  'resumes.score': opScore,
  'resumes.export': opExport,
  'resumes.create': opCreate,
  'resumes.import': opImport,
  'resumes.duplicate': opDuplicate,
  'resumes.rename': opRename,
  'resumes.delete': opDelete,
  'style.options': opStyleOptions,
  'style.set-template': opSetTemplate,
  'style.update': opStyleUpdate,
  'layout.set-visibility': opSetVisibility,
  'layout.move': opMove,
  'personal.update': opPersonalUpdate,
  'personal.set-photo': opSetPhoto,
  'philosophy.update': opPhilosophy,
};
for (var sectionName in SECTIONS) {
  HANDLERS[sectionName + '.add'] = opItemAdd(sectionName);
  HANDLERS[sectionName + '.update'] = opItemUpdate(sectionName);
  HANDLERS[sectionName + '.remove'] = opItemRemove(sectionName);
}

/**
 * Route entry point. Success: e.json(200, { success: true, ...result })
 * (the app's ops.pb.js convention); refusals: e.json(status, { error, code, field }).
 * `extra(result)` adds fields a route has always answered (ops.pb.js).
 */
function run(e, name, extra) {
  var handler = HANDLERS[name];
  if (!handler) return e.json(404, { error: 'Unknown operation ' + name + '.', code: 'not_found' });
  try {
    var result = handler(e.app, readParams(e)) || {};
    var body = { success: true };
    for (var k in result) body[k] = result[k];
    if (extra) {
      var more = extra(result);
      for (var m in more) body[m] = more[m];
    }
    return e.json(200, body);
  } catch (err) {
    if (err && err.__op) {
      var b = { error: err.message, code: err.code };
      if (err.field) b.field = err.field;
      return e.json(err.status, b);
    }
    var msg = err && err.message ? err.message : String(err);
    console.error('[agent_ops] ' + name + ' failed: ' + msg);
    return e.json(500, { error: 'Operation ' + name + ' failed: ' + msg, code: 'operation_failed' });
  }
}

module.exports = {
  run: run,
  // Pure helpers, exported for the parity tests (no PocketBase globals needed).
  _pure: {
    INITIAL_RESUME_BASE: INITIAL_RESUME_BASE,
    CANDIDATE_POOL: CANDIDATE_POOL,
    TEMPLATE_GROUPS: TEMPLATE_GROUPS,
    TEMPLATE_IDS: TEMPLATE_IDS,
    templateDefaultFont: templateDefaultFont,
    supportedSections: supportedSections,
    normalize: normalize,
    calculateResumeScore: calculateResumeScore,
    generateRandomCandidate: generateRandomCandidate,
    exportWordContent: exportWordContent,
    exportLatexContent: exportLatexContent,
    shapeProblems: shapeProblems,
    base64: base64,
    HANDLER_NAMES: Object.keys(HANDLERS),
  },
};
