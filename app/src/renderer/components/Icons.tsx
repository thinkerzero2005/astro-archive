import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

const paths: Record<string, ReactNode> = {
  home: <path d="M3 10.5L12 3l9 7.5V21H3z" />,
  deepsky: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.6" transform="rotate(-28 12 12)" />
    </>
  ),
  nightscape: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M17 7h4v4" />
    </>
  ),
  night: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9h17M8 3v4M16 3v4" />
    </>
  ),
  library: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M9 9.5V20" />
    </>
  ),
  sync: <path d="M7 10l-3 3 3 3M17 10l3 3-3 3M5 13h14" />,
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3.5 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  star: <path d="M12 2.6l2.5 6.1 6.6.5-5 4.3 1.5 6.5L12 16.6 6.4 20l1.5-6.5-5-4.3 6.6-.5L12 2.6z" fill="currentColor" stroke="none" />,
  folder: (
    <>
      <path d="M3.5 7.5V6a1.5 1.5 0 011.5-1.5h4l2 2H19a1.5 1.5 0 011.5 1.5v10a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 18z" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16" />
      <path d="M4 12h16" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5V6.5A1.5 1.5 0 015.5 5h13A1.5 1.5 0 0120 6.5v7" />
      <path d="M3.5 13.5h4.2l1.5 2.6h5.6l1.5-2.6h4.2v4a1.5 1.5 0 01-1.5 1.5H5a1.5 1.5 0 01-1.5-1.5z" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  edit: (
    <>
      <path d="M4 20l4.5-1 10-10a2.1 2.1 0 00-3-3l-10 10z" />
      <path d="M14 6.5l3 3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  pin: <path d="M9 4h6l1 7-4 9-4-9z" />,
  left: <path d="M14.5 6l-6 6 6 6" />,
  right: <path d="M9.5 6l6 6-6 6" />,
  up: <path d="M5 15l7-7 7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4.5 17l5-5 4 4 3-2.5 3 3.5" />
    </>
  ),
  play: <path d="M8 5.2v13.6L19 12z" />,
  video: (
    <>
      <rect x="3" y="6" width="12" height="12" rx="2.5" />
      <path d="M15 10.5l6-3.5v10l-6-3.5z" />
    </>
  )
}

export function Icon({ name, size = 14, className }: IconProps & { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name] ?? null}
    </svg>
  )
}

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={size} height={size}>
      <path d="M12 2.6l2.5 6.1 6.6.5-5 4.3 1.5 6.5L12 16.6 6.4 20l1.5-6.5-5-4.3 6.6-.5L12 2.6z" fill="rgb(var(--accent-rgb) / 0.85)" />
      <circle cx="19" cy="5" r="1.2" fill="var(--violet)" />
    </svg>
  )
}
