tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#7048e8', deep: '#5f3dc4', tint: '#f0ebfd', shade: '#221a3d' },
        ink: { DEFAULT: '#16161d', soft: '#5b5b6b', faint: '#8d8d9e' },
        paper: { DEFAULT: '#f7f7f9', card: '#ffffff', line: '#e6e6ea' },
        night: { DEFAULT: '#0d0d12', card: '#16161d', line: '#24242e', text: '#e8e8ef' },
        terminal: '#0a0a0f',
      },
      fontFamily: {
        sans: ['Segoe UI Variable Text', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      borderRadius: { DEFAULT: '6px' },
    },
  },
};

try {
  const stored = JSON.parse(localStorage.getItem('jspoofer.settings') || '{}');
  document.documentElement.classList.toggle('dark', (stored.theme ?? 'dark') === 'dark');
} catch {
  document.documentElement.classList.add('dark');
}
