const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: document.getElementById('login-username').value.trim(),
      password: document.getElementById('login-password').value,
    }),
  });
  if (!response.ok) {
    const data = await response.json();
    loginError.textContent = data.error || 'Login gagal';
    return;
  }
  const data = await response.json();
  window.location.href = data.redirect || '/index.html';
});
