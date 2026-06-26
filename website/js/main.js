/**
 * Docker Dashboard Official Website - Main Script
 * Handles: theme toggle, i18n, scroll animations, mobile menu, copy buttons
 */
(function () {
    'use strict';

    // ==================== Theme ====================
    const Theme = {
        get() {
            return localStorage.getItem('dd-theme') || 'dark';
        },

        set(theme) {
            localStorage.setItem('dd-theme', theme);
            document.documentElement.setAttribute('data-theme', theme);
        },

        toggle() {
            this.set(this.get() === 'dark' ? 'light' : 'dark');
        },

        init() {
            this.set(this.get());
        }
    };

    // ==================== Scroll Animations ====================
    const ScrollAnimator = {
        observer: null,

        init() {
            this.observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            entry.target.classList.add('visible');
                            this.observer.unobserve(entry.target);
                        }
                    });
                },
                {
                    threshold: 0.15,
                    rootMargin: '0px 0px -50px 0px'
                }
            );

            document.querySelectorAll('[data-animate]').forEach(el => {
                this.observer.observe(el);
            });
        }
    };

    // ==================== Navigation ====================
    const Navigation = {
        init() {
            const nav = document.getElementById('nav');
            const mobileBtn = document.getElementById('mobileMenuBtn');
            const mobileMenu = document.getElementById('mobileMenu');

            // Scroll effect
            window.addEventListener('scroll', () => {
                const scrolled = window.scrollY > 20;
                nav.classList.toggle('scrolled', scrolled);
            }, { passive: true });

            // Mobile menu toggle
            if (mobileBtn && mobileMenu) {
                mobileBtn.addEventListener('click', () => {
                    mobileMenu.classList.toggle('open');
                });

                // Close mobile menu on link click
                mobileMenu.querySelectorAll('a').forEach(link => {
                    link.addEventListener('click', () => {
                        mobileMenu.classList.remove('open');
                    });
                });

                // Close mobile menu when clicking outside
                document.addEventListener('click', (e) => {
                    if (!nav.contains(e.target)) {
                        mobileMenu.classList.remove('open');
                    }
                });
            }

            // Active nav link highlight
            this.updateActiveLink();
            window.addEventListener('scroll', () => this.updateActiveLink(), { passive: true });
        },

        updateActiveLink() {
            const sections = document.querySelectorAll('section[id]');
            const links = document.querySelectorAll('.nav-links a[href^="#"]');
            let current = '';

            sections.forEach(section => {
                const sectionTop = section.offsetTop - 100;
                if (window.scrollY >= sectionTop) {
                    current = section.getAttribute('id');
                }
            });

            links.forEach(link => {
                link.style.color = '';
                link.style.setProperty('--underline-width', '0');
                if (link.getAttribute('href') === '#' + current) {
                    link.style.color = 'var(--accent)';
                    link.style.setProperty('--underline-width', '100%');
                }
            });
        }
    };

    // ==================== Copy Buttons ====================
    const CopyManager = {
        init() {
            document.querySelectorAll('.copy-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const text = btn.getAttribute('data-copy');
                    if (!text) return;

                    navigator.clipboard.writeText(text).then(() => {
                        btn.classList.add('copied');
                        const originalTitle = btn.getAttribute('title');
                        btn.setAttribute('title', 'Copied! ✓');

                        setTimeout(() => {
                            btn.classList.remove('copied');
                            btn.setAttribute('title', originalTitle || 'Copy');
                        }, 2000);
                    }).catch(() => {
                        // Fallback for older browsers
                        const textarea = document.createElement('textarea');
                        textarea.value = text;
                        textarea.style.position = 'fixed';
                        textarea.style.opacity = '0';
                        document.body.appendChild(textarea);
                        textarea.select();
                        try {
                            document.execCommand('copy');
                            btn.classList.add('copied');
                            setTimeout(() => btn.classList.remove('copied'), 2000);
                        } catch (err) {
                            console.warn('Copy failed:', err);
                        }
                        document.body.removeChild(textarea);
                    });
                });
            });
        }
    };

    // ==================== Smooth Scroll for Anchor Links ====================
    const SmoothScroll = {
        init() {
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function (e) {
                    const targetId = this.getAttribute('href');
                    const target = document.querySelector(targetId);
                    if (target) {
                        e.preventDefault();
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                });
            });
        }
    };

    // ==================== Parallax Effect on Hero ====================
    const Parallax = {
        init() {
            const orbs = document.querySelectorAll('.hero-orb');
            if (!orbs.length) return;

            window.addEventListener('mousemove', (e) => {
                const { clientX, clientY } = e;
                const centerX = window.innerWidth / 2;
                const centerY = window.innerHeight / 2;

                orbs.forEach((orb, index) => {
                    const speed = (index + 1) * 0.02;
                    const x = (clientX - centerX) * speed;
                    const y = (clientY - centerY) * speed;
                    orb.style.transform = `translate(${x}px, ${y}px)`;
                });
            }, { passive: true });
        }
    };

    // ==================== Stats Reveal ====================
    const StatsReveal = {
        init() {
            const stats = document.querySelector('.hero-stats');
            if (!stats) return;

            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    stats.classList.add('revealed');
                    observer.unobserve(stats);
                }
            }, { threshold: 0.3 });

            observer.observe(stats);
        }
    };

    // ==================== Feature Card Tilt Effect ====================
    const TiltEffect = {
        init() {
            const cards = document.querySelectorAll('.feature-card');
            if (!cards.length || window.matchMedia('(max-width: 768px)').matches) return;

            cards.forEach(card => {
                card.addEventListener('mousemove', (e) => {
                    const rect = card.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;

                    const rotateX = ((y - centerY) / centerY) * -5;
                    const rotateY = ((x - centerX) / centerX) * 5;

                    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
                });

                card.addEventListener('mouseleave', () => {
                    card.style.transform = '';
                });
            });
        }
    };

    // ==================== Tab Switcher ====================
    const TabSwitcher = {
        init() {
            const tabs = document.querySelectorAll('.qs-tab');
            const panels = document.querySelectorAll('.qs-tab-content');

            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const target = tab.getAttribute('data-tab');

                    // Update active tab
                    tabs.forEach(t => {
                        t.classList.remove('active');
                        t.setAttribute('aria-selected', 'false');
                    });
                    tab.classList.add('active');
                    tab.setAttribute('aria-selected', 'true');

                    // Update active panel
                    panels.forEach(p => p.classList.remove('active'));
                    const panel = document.getElementById('tab-' + target);
                    if (panel) {
                        panel.classList.add('active');
                        // Re-trigger scroll animations for newly visible content
                        panel.querySelectorAll('[data-animate]').forEach(el => {
                            el.classList.remove('visible');
                            ScrollAnimator.observer.observe(el);
                        });
                    }
                });
            });
        }
    };

    // ==================== Initialize Everything ====================
    function init() {
        Theme.init();
        I18n.init();

        // Event listeners
        document.getElementById('themeToggle')?.addEventListener('click', () => Theme.toggle());
        document.getElementById('langToggle')?.addEventListener('click', () => I18n.toggle());

        // Initialize modules
        Navigation.init();
        ScrollAnimator.init();
        CopyManager.init();
        SmoothScroll.init();
        Parallax.init();
        StatsReveal.init();
        TiltEffect.init();
        TabSwitcher.init();

        // Listen for i18n changes to re-run counter (since text may change)
        document.addEventListener('i18n:changed', () => {
            // Re-apply any dynamic updates if needed
        });

        console.log('%cDocker Dashboard %c官网已就绪',
            'font-weight: bold; font-size: 14px;',
            'color: #94a3b8;');
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
