// H18 Deep · Theme tokens (light / dark)
// Every visual property that differs between modes lives here.

const H18_THEMES = {
  light: {
    mode: 'light',
    bg:        '#f5f2ea',      // app outer bg
    surface:   '#ffffff',      // main panels
    surface2:  '#faf8f3',      // subtle panels (AI boxes, sublevels)
    rail:      '#efece4',      // left icon rail
    topbar:    '#ffffff',
    border:    '#e8e3d6',
    borderSoft:'#efeae0',
    divider:   '#ece7dc',
    text:      '#15140f',
    textMid:   '#5a564b',
    textDim:   '#908977',
    textFaint: '#b9b2a0',
    mono:      '#706a5a',
    selBg:     '#fff6db',      // selected inbox row
    selBorder: '#e5a04a',
    todayBg:   '#fff6db',
    todayText: '#b54b12',
    hotBg:     '#fde4d4',
    hot:       '#b54b12',
    urgent:    '#c44a24',
    rowHover:  '#faf6ea',
    gridLine:  '#efeadd',
    gridLineSoft: '#f5f1e5',
    chipBg:    '#f0ece0',
    dot:       '#d44a2e',
    invert:    '#111',
    invertInk: '#fafaf7',
    accent:    '#d24a1a',      // brand / now-line
    scrim:     'rgba(0,0,0,0.04)',
    shadow:    '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
  },
  // Dark: warm neutral (slight purple/brown hint), NOT pure black.
  // Inspired by Linear / Arc / modern editor themes — darker than gray, has character.
  dark: {
    mode: 'dark',
    bg:        '#16151a',       // app bg — warm near-black, not #000
    surface:   '#1e1d24',       // main panels — slightly purple
    surface2:  '#252430',       // sublevel / AI / input bg
    rail:      '#1a1920',       // rail slightly darker than surface
    topbar:    '#1a1920',
    border:    '#2f2d38',       // visible but soft
    borderSoft:'#272530',
    divider:   '#242230',
    text:      '#f0ede4',       // warm off-white (not pure #fff)
    textMid:   '#b4afa0',
    textDim:   '#7d786a',
    textFaint: '#4f4b42',
    mono:      '#9a9580',
    selBg:     'rgba(240,175,110,0.12)',    // warm amber
    selBorder: '#e8a86a',
    todayBg:   'rgba(255,195,120,0.07)',
    todayText: '#f5b878',
    hotBg:     'rgba(240,130,80,0.18)',
    hot:       '#ffab7a',
    urgent:    '#ff9267',
    rowHover:  '#23222c',
    gridLine:  '#2a2834',
    gridLineSoft: '#22212a',
    chipBg:    '#2a2834',
    dot:       '#ff7a4a',
    invert:    '#f0ede4',
    invertInk: '#16151a',
    accent:    '#ffab7a',
    scrim:     'rgba(255,255,255,0.03)',
    shadow:    '0 1px 2px rgba(0,0,0,0.4), 0 10px 28px rgba(0,0,0,0.5)',
  },
};

// Adjust course accent lightness based on theme (hand-tuned for dark mode legibility)
const h18Accent = (course, theme) => {
  if (theme.mode === 'light') return course.accent;
  // Dark: use semi-transparent brand color over surface
  return `${course.color}22`;
};

const h18CourseText = (course, theme) => {
  if (theme.mode === 'light') return course.color;
  // Lighter/brighter variant for dark bg
  const lightened = {
    '#3451b2': '#7e96ff', // ml
    '#1f7a4f': '#5bd49a', // alg
    '#9e3a24': '#ff8b6b', // os
    '#6a3da0': '#c49cff', // lin
    '#1d6477': '#6dc4d9', // stat
    '#3a3a3a': '#a7a39a', // cmp
  };
  return lightened[course.color] || course.color;
};

Object.assign(window, { H18_THEMES, h18Accent, h18CourseText });
