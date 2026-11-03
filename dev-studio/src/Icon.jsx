/**
 * The app's icon set (AGENT-OWNED): one consistent inline-SVG set (16px grid,
 * stroke-based). Icons are decorative beside their text label, so they are
 * aria-hidden; icon-only buttons carry an aria-label instead.
 */
const ICON_PATHS = {
  folder: "M1.5 5V3.5h5l1.5 2h6.5v7H1.5V5Zm0 1h13",
  files: "M6 1.5h5l3 3v9H6v-12ZM11 1.5v3h3M3 4H1.5v10.5H10",
  search: "M10.8 10.8 14 14M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  branch:
    "M4 5v6m0-4h5a3 3 0 0 0 3-3M6 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm0 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm8-11a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  work: "M3 3.5h10v11H3v-11ZM6 1.5h4v4H6v-4Zm-.5 7h5m-5 3h3",
  settings:
    "M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0-3.5v2m0 9v2M1.5 8h2m9 0h2M3.4 3.4l1.4 1.4m6.4 6.4 1.4 1.4m0-9.2-1.4 1.4m-6.4 6.4-1.4 1.4",
  code: "m5 4-4 4 4 4m6-8 4 4-4 4M9.5 2l-3 12",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  chevronRight: "m6 3 5 5-5 5",
  chevronDown: "m3 6 5 5 5-5",
  replace: "M2 3h9m-3-2 3 2-3 2M14 13H5m3-2-3 2 3 2M4 7v2m8-2v2",
  check: "M3 8.5 6.5 12 13 4.5",
  trash:
    "M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5m2.5 0V13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5",
  alert: "M8 5.5V9m0 2.5v.01M8 1.5 1.5 13.5h13L8 1.5Z",
  info: "M8 7.5V11m0-5.5v-.01M14.5 8a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
  inbox:
    "M1.5 9.5h3l1 2h5l1-2h3M2.5 3.5h11l1 6v3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-3l1-6Z",
  refresh: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6",
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
    >
      <path
        d={ICON_PATHS[name] ?? ICON_PATHS.info}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
