// Aplica o tema escolhido antes de a página aparecer (evita um clarão branco).
// Fica num ficheiro (e não inline no index.html) porque a CSP de produção não permite scripts inline.
try {
  var theme = localStorage.getItem('warrantly.theme')
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme)
  }
} catch {}
