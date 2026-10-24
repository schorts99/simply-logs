try {
  const preference = localStorage.getItem('simply_logs_theme') || localStorage.getItem('purrpulse_theme_preference');
  const dark = preference === 'dark' || (preference !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
} catch {}
