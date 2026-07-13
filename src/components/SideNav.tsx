import type { ReactNode } from 'react';

export type NavTarget = 'study' | 'ranges' | 'article' | 'stats' | 'settings';

interface SideNavProps {
  active: NavTarget;
  onSelect: (target: NavTarget) => void;
}

const items: Array<{ id: NavTarget; label: string; icon: ReactNode }> = [
  { id: 'study', label: '複習', icon: <CardsIcon /> },
  { id: 'ranges', label: '範圍', icon: <LayersIcon /> },
  { id: 'article', label: '文章', icon: <ArticleIcon /> },
  { id: 'stats', label: '記錄', icon: <ChartIcon /> },
  { id: 'settings', label: '設定', icon: <SettingsIcon /> },
];

export function SideNav({ active, onSelect }: SideNavProps) {
  return (
    <nav className="side-nav" aria-label="主要功能">
      <button className="brand-mark" type="button" onClick={() => onSelect('study')}>
        <span aria-hidden="true">m</span>
        <span className="sr-only">回到複習</span>
      </button>
      <div className="side-nav-items">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="side-nav-button"
            aria-current={active === item.id ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <p className="side-nav-version">P1 · LOCAL</p>
    </nav>
  );
}

function CardsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5.5h11.5A1.5 1.5 0 0 1 19 7v11.5H7.5A1.5 1.5 0 0 1 6 17V5.5Z" />
      <path d="M6 8H4.5A1.5 1.5 0 0 0 3 9.5V19a2 2 0 0 0 2 2h9.5a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}

function ArticleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5M8 12h7M8 16h7" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.58 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.95a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.58 1.7 1.7 0 0 0 10 3h4v.08A1.7 1.7 0 0 0 15.05 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.42 9 1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}
