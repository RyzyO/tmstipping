// auth.js
import { auth, rtdb } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { loadTeamRank } from "./team.js";
import { showLoading, hideLoading } from "./ui.js";

const desktopAuthBtns = document.getElementById('desktop-auth-btns');
const mobileAuthBtns = document.getElementById('mobile-auth-btns');
const welcomeMessage = document.getElementById('welcome-message');
const teamBox = document.getElementById('team-box');

function renderAuthButtons(user) {
  let html = '';
  if (user) {
    html = `
      <span class="me-3">Hi, ${user.displayName || user.email}</span>
      <button class="btn btn-outline-light btn-sm logout-btn">Logout</button>
    `;
  } else {
    html = `
      <a href="login.html" class="btn btn-outline-light btn-sm me-2">Login</a>
      <a href="signup.html" class="btn btn-success btn-sm">Sign Up</a>
    `;
  }

  desktopAuthBtns.innerHTML = html;
  mobileAuthBtns.innerHTML = html;

  // logout listeners
  document.querySelectorAll('.logout-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await signOut(auth);
        window.location.href = "login.html";
      } catch (err) {
        console.error("Sign out error:", err);
      }
    });
  });
}

function insertAdminNavLink() {
  const navUl = document.querySelector('.navbar-nav.ms-lg-5.me-lg-auto');
  if (!navUl) return;
  if (!navUl.querySelector('.admin-nav-item')) {
    const li = document.createElement('li');
    li.className = 'nav-item admin-nav-item';
    li.innerHTML = `<a class="nav-link" href="admin.html">Admin</a>`;
    navUl.appendChild(li);
  }
}

export function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    showLoading();
    renderAuthButtons(user);
    welcomeMessage.textContent = user
      ? `Welcome, ${user.displayName || user.email}!`
      : "Welcome to the Great Spring Tip Off";

    const tipNowBtn = document.getElementById('tip-now-btn');
    if (tipNowBtn) {
      tipNowBtn.href = user ? "tip.html" : "login.html";
    }

    if (user) {
      // check admin
      const adminRef = ref(rtdb, `users/${user.uid}/admin`);
      const snapshot = await get(adminRef);
      if (snapshot.exists() && snapshot.val() === true) {
        insertAdminNavLink();
      }

      // show team
      teamBox.style.display = "block";
      await loadTeamRank(user);
    } else {
      teamBox.style.display = "none";
    }

    hideLoading();
  });
}
