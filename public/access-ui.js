fetch('/api/auth/me').then((response) => response.json()).then(({ user }) => {
  if (user?.role !== 'admin') {
    document.querySelectorAll('a[href="system-subscribers.html"], a[href="admin-dashboard.html"]').forEach((link) => link.remove());
    document.querySelectorAll('a[href="system-dashboard.html"]').forEach((link) => { link.textContent = 'Info Langganan'; });
    document.getElementById('subscriber-navbar-label')?.remove();
  }
});
