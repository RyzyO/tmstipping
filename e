<style>
  :root {
    --gold: #FFD700;
    --gold-dark: #bfa100;
    --black: #181818;
    --glass-bg: rgba(24,24,24,0.85);
  }
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    color: #fff;
    font-family: 'Inter', sans-serif;
    background: linear-gradient(135deg, #181818 0%, #232526 100%);
    scroll-behavior: smooth;
  }

  h1, h2, h3, h4, h5, h6, .navbar-brand, .btn {
    font-family: 'Outfit', sans-serif;
  }

  .navbar {
    background: var(--glass-bg) !important;
    box-shadow: 0 2px 16px rgba(255,215,0,0.08), 0 0 0 2px var(--gold);
    transition: background 0.3s ease;
  }

  .navbar-brand, .navbar-nav .nav-link {
    color: var(--gold) !important;
    font-weight: 600;
    padding-bottom: 35px;
    letter-spacing: 0.5px;
    text-shadow: 0 1px 4px #000, 0 0 2px var(--gold);
    transition: all 0.2s ease;
  }

  .navbar-brand i {
    color: var(--gold);
    margin-right: 0.5rem;
    font-size: 1.5rem;
    vertical-align: middle;
  }

  .navbar-nav .nav-link.active, .navbar-nav .nav-link:hover, .navbar-nav .nav-link:focus {
    color: #fff !important;
    background: linear-gradient(90deg, var(--gold), #fffbe6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 2px 8px #000;
  }

  .hero-section {
    min-height: 60vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    position: relative;
    animation: fadeInUp 0.7s ease-out both;
  }

  .hero-card {
    background: var(--glass-bg);
    border-radius: 24px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.37), 0 0 0 2px var(--gold);
    padding: 3rem 2.5rem 2.5rem;
    max-width: 540px;
    margin: 0 auto;
    text-align: center;
    backdrop-filter: blur(8px);
    transition: transform 0.3s ease;
  }

  .hero-card:hover {
    transform: translateY(-6px);
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(40px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .hero-card h1 {
    color: var(--gold);
    font-size: 2.5rem;
    font-weight: 700;
    letter-spacing: 1px;
    margin-bottom: 1.2rem;
    text-shadow: 0 2px 8px #000, 0 0 2px var(--gold);
  }

  .hero-card h6 {
    color: #fff;
    font-size: 1.15rem;
    margin-bottom: 2rem;
    line-height: 1.5;
    text-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }

  .gold-line {
    width: 60px;
    height: 4px;
    background: linear-gradient(90deg, var(--gold), #fffbe6);
    border-radius: 2px;
    margin: 0.5rem auto 1.5rem auto;
    box-shadow: 0 0 8px 2px var(--gold);
  }

  .btn-success.btn-lg {
    font-size: 1.4rem;
    padding: 0.75rem 2.5rem;
    border-radius: 2rem;
    background: linear-gradient(90deg, var(--gold), #fffbe6) !important;
    color: #181818 !important;
    font-weight: 700;
    border: none;
    transition: all 0.2s ease-in-out;
    box-shadow: 0 2px 12px rgba(255,215,0,0.15);
  }

  .btn-success.btn-lg:hover {
    background: linear-gradient(90deg, #fffbe6, var(--gold)) !important;
    color: #000 !important;
    box-shadow: 0 4px 24px rgba(255,215,0,0.25);
  }

  .bottom-nav {
    position: fixed;
    bottom: 0;
    width: 100%;
    background: #181818;
    border-top: 2px solid var(--gold);
    display: flex;
    justify-content: space-around;
    padding: 0.5rem 0;
    z-index: 1000;
  }

  .bottom-nav a {
    color: var(--gold);
    text-align: center;
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: color 0.2s ease;
  }

  .bottom-nav i {
    font-size: 1.4rem;
    margin-bottom: 0.2rem;
  }

  .bottom-nav a:hover {
    color: #fffbe6;
  }

  @media (max-width: 480px) {
    .hero-card {
      padding: 1.5rem 1rem;
      max-width: 95vw;
    }
    .hero-card h1 { font-size: 1.6rem; }
    .hero-card h6 { font-size: 1rem; }
    .btn-success.btn-lg { font-size: 1.1rem; padding: 0.6rem 1.5rem; }
  }

  .navbar-brand span {
    font-size: 1.7rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  @media (max-width: 480px) {
    .navbar-brand span {
      font-size: 1.1rem;
      white-space: normal;
      line-height: 1.2;
      max-width: 120px;
      display: inline-block;
      word-break: break-word;
    }
    .navbar-brand img {
      height: 28px !important;
      width: 28px !important;
      margin-right: 0.3rem !important;
    }
  }

  @media (max-width: 768px) {
    .hero-section {
      flex-direction: column;
      flex-wrap: wrap;
      padding-top: 4rem;
    }

    .hero-section > .container:first-of-type {
      order: 1;
    }

    .hero-section > .container:last-of-type {
      order: 2;
      margin-top: 2rem;
    }
  }
</style>
