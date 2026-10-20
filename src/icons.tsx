import type { ReactNode } from 'react';

/** Line icon (24px unless `size` says) that takes the text color, so tabs tint it with their active/inactive color. */
function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const PlanIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Icon>
);

export const PacksIcon = () => (
  <Icon>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
    <path d="M12 8v13" />
    <path d="M12 8c-1.5-3-5-4-5.5-2S9 8 12 8c3 0 6-0.5 5.5-2S13.5 5 12 8" />
  </Icon>
);

export const CardsIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="8" y="3" width="12" height="16" rx="2" />
    <path d="M5 6.5v12A2.5 2.5 0 0 0 7.5 21H15" />
    <path d="M14 8l1.5 3L14 14l-1.5-3z" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);

export const TowerIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    {/* Separate merlons, 4 units apart: notches cut into one outline close up under a 2-unit stroke at 18px. */}
    <path d="M6 21V6h12v15" />
    <path d="M6 6V3M10 6V3M14 6V3M18 6V3" />
    <path d="M4 21h16" />
    <path d="M10 21v-4a2 2 0 0 1 4 0v4" />
  </Icon>
);

export const TrophyIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M8 21h8" />
    <path d="M12 16v5" />
    <path d="M7 4h10v6a5 5 0 0 1-10 0z" />
    <path d="M17 6h3v1a4 4 0 0 1-3 4" />
    <path d="M7 6H4v1a4 4 0 0 0 3 4" />
  </Icon>
);
