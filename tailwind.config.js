/** @type {import('tailwindcss').Config} */

/*
 * Every scale here is an alias of a token in `src/styles/tokens.css`, so a
 * utility written in a component reads the same value the stylesheets do. A
 * component never writes a pixel size of its own: it picks a step.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--surface-canvas)',
        raised: 'var(--surface-raised)',
        sunken: 'var(--surface-sunken)',
        hover: 'var(--surface-hover)',
        active: 'var(--surface-active)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        'line-control': 'var(--line-control)',
        ink: 'var(--ink)',
        'ink-muted': 'var(--ink-muted)',
        focus: 'var(--focus)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        condensed: 'var(--font-condensed)',
        mono: 'var(--font-mono)',
      },
      /* The six sizes section 8.2 fixes, and no others. */
      fontSize: {
        meta: 'var(--text-meta)',
        control: 'var(--text-control)',
        caption: 'var(--text-caption)',
        ui: 'var(--text-ui)',
        body: 'var(--text-body)',
        title: 'var(--text-title)',
        display: 'var(--text-display)',
      },
      lineHeight: {
        flat: 'var(--leading-flat)',
        tight: 'var(--leading-tight)',
        snug: 'var(--leading-snug)',
        body: 'var(--leading-body)',
      },
      /* Radius climbs with the surface: chip, control, surface, frame. */
      borderRadius: {
        DEFAULT: 'var(--radius-sm)',
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-xs)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        overlay: 'var(--shadow-overlay)',
        drag: 'var(--shadow-drag)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
      },
      maxWidth: {
        measure: 'var(--measure)',
      },
      spacing: {
        panel: 'var(--panel-w)',
        topbar: 'var(--topbar-h)',
        sidebar: 'var(--sidebar-w)',
      },
    },
  },
  plugins: [],
};
