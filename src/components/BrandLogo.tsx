import { useId } from 'react';

interface BrandLogoProps {
  compact?: boolean;
  label?: string;
  size?: 'sm' | 'md';
  textClassName?: string;
}

export function BrandLogo({
  compact = false,
  label = 'NexaStudios',
  size = 'md',
  textClassName,
}: BrandLogoProps) {
  const uid = useId().replace(/:/g, '');
  const bgId = `ns-bg-${uid}`;
  const accentId = `ns-accent-${uid}`;
  const frameId = `ns-frame-${uid}`;

  const iconDimension = size === 'sm' ? 'w-7 h-7' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-sm' : 'text-lg';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className={`${iconDimension} shrink-0 drop-shadow-sm`}
      >
        <defs>
          <linearGradient id={bgId} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#141B34" />
            <stop offset="100%" stopColor="#080B14" />
          </linearGradient>
          <linearGradient id={accentId} x1="14" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6366F1" />
            <stop offset="55%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
          <linearGradient id={frameId} x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#818CF8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.45" />
          </linearGradient>
        </defs>

        <rect
          x="3"
          y="3"
          width="58"
          height="58"
          rx="15"
          fill={`url(#${bgId})`}
          stroke={`url(#${frameId})`}
          strokeWidth="2"
        />

        <path
          d="M13 20V15C13 13.8954 13.8954 13 15 13H20"
          stroke="#06B6D4"
          strokeOpacity="0.75"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M51 44V49C51 50.1046 50.1046 51 49 51H44"
          stroke="#6366F1"
          strokeOpacity="0.75"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        <path
          d="M19 46V18.5C19 17.6716 19.6716 17 20.5 17H24.6C25.25 17 25.85 17.34 26.18 17.9L37.82 37.3V18.5C37.82 17.6716 38.4916 17 39.32 17H43.5C44.3284 17 45 17.6716 45 18.5V45.5C45 46.3284 44.3284 47 43.5 47H39.4C38.75 47 38.15 46.66 37.82 46.1L26.18 26.7V46C26.18 46.8284 25.5084 47.5 24.68 47.5H20.5C19.6716 47.5 19 46.8284 19 46Z"
          fill={`url(#${accentId})`}
        />

        <circle cx="48.5" cy="15.5" r="3" fill="#06B6D4" />
      </svg>

      {!compact && (
        <span
          className={`font-display ${textSize} font-bold tracking-tight ${
            textClassName ?? 'text-slate-900 dark:text-[#F8FAFC]'
          }`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
