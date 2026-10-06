/** App icons (inline SVG, currentColor — theme-safe). */
interface P {
  size?: number;
}

function Svg({ size = 16, children }: P & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const ShieldIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
  </Svg>
);
export const GaugeIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 14l4-4" />
    <path d="M3.3 17a9 9 0 1 1 17.4 0" />
  </Svg>
);
export const GlobeIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Svg>
);
export const AlertIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 3l9 16H3l9-16z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);
export const RadarIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 12l6-6" />
  </Svg>
);
export const SlidersIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);
export const UsersIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
  </Svg>
);
export const ArrowLeftIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const FlameIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z" />
  </Svg>
);
export const ActivityIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Svg>
);
export const WrenchIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.4-.4-2.1 2.5-2.5z" />
  </Svg>
);
export const LaptopIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="11" rx="1" />
    <path d="M2 19h20" />
  </Svg>
);
export const ServerIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="7" rx="1" />
    <rect x="3" y="13" width="18" height="7" rx="1" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </Svg>
);
export const DatabaseIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </Svg>
);
export const LockIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="1" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
);
export const MailIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="1" />
    <path d="M3 7l9 6 9-6" />
  </Svg>
);
export const WifiIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0" />
    <path d="M12 19.5h.01" />
  </Svg>
);
export const CloudIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z" />
  </Svg>
);
export const CodeIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" />
  </Svg>
);
export const UserIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
);
export const CalendarIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="16" rx="1" />
    <path d="M4 10h16M8 3v4M16 3v4" />
  </Svg>
);
export const CheckCircleIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </Svg>
);
export const SparklesIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
  </Svg>
);
export const ListCheckIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9" />
  </Svg>
);
export const ThumbUpIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7 11v9H4v-9h3zM7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7" />
  </Svg>
);
export const PlusIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const SquareIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </Svg>
);
export const SquareCheckIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 12l3 3 5-6" />
  </Svg>
);
export const BellIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4" />
  </Svg>
);
export const ChevronRightIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const EyeIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const ClockIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const TerminalIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 17l6-5-6-5M12 19h8" />
  </Svg>
);
export const FilmIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </Svg>
);
export const DownloadIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);
export const HouseIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />
  </Svg>
);
export const FolderIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);
export const BriefcaseIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
  </Svg>
);
export const BoxIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />
  </Svg>
);
export const FileIcon = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
);
