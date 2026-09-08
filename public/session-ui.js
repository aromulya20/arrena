const logoutButton = document.getElementById('btn-logout');
if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}