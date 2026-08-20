// Palette mirrors shadcn/ui (zinc base + violet primary). Radii are globally
// disabled: every `rounded*` utility resolves to 0 so nothing is ever rounded.
const FLAT = {
  none: '0px',
  sm: '0px',
  DEFAULT: '0px',
  md: '0px',
  lg: '0px',
  xl: '0px',
  '2xl': '0px',
  '3xl': '0px',
  full: '0px',
};

tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#7c3aed', deep: '#6d28d9', tint: '#f4f2ff', shade: '#2a1a4d' },
        ink: { DEFAULT: '#09090b', soft: '#3f3f46', faint: '#71717a' },
        paper: { DEFAULT: '#f4f4f5', card: '#ffffff', line: '#e4e4e7' },
        night: {
          DEFAULT: '#09090b',
          card: '#0c0c0f',
          line: '#27272a',
          text: '#fafafa',
          faint: '#a1a1aa',
        },
        terminal: '#09090b',
      },
      // Two families and no more: Plus Jakarta Sans carries the interface,
      // JetBrains Mono carries console output and ID readouts.
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          'Segoe UI Variable Text',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Cascadia Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      borderRadius: FLAT,
    },
  },
};

try {
  const stored = JSON.parse(localStorage.getItem('jspoofer.settings') || '{}');
  document.documentElement.classList.toggle('dark', (stored.theme ?? 'dark') === 'dark');
} catch {
  document.documentElement.classList.add('dark');
}
