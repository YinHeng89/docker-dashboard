/**
 * i18n Engine
 * Lightweight internationalization (Chinese/English) with no dependencies
 */
const I18n = {
    locale: 'zh',
    locales: { zh: LOCALE_ZH, en: LOCALE_EN },

    // Detect browser language, default to zh
    detect() {
        const lang = (navigator.language || 'zh').toLowerCase();
        return lang.startsWith('zh') ? 'zh' : 'en';
    },

    // Initialize: detect language, apply translations
    init() {
        // Check localStorage first
        const saved = localStorage.getItem('dd-locale');
        if (saved && (saved === 'zh' || saved === 'en')) {
            this.locale = saved;
        } else {
            this.locale = this.detect();
        }
        this.apply();
        this.updateUI();
    },

    // Switch language
    toggle() {
        this.locale = this.locale === 'zh' ? 'en' : 'zh';
        localStorage.setItem('dd-locale', this.locale);
        this.apply();
        this.updateUI();
    },

    // Get translation by key
    t(key) {
        return (this.locales[this.locale] && this.locales[this.locale][key]) || key;
    },

    // Apply all translations to DOM
    apply() {
        // Set html lang attribute
        document.documentElement.lang = this.locale === 'zh' ? 'zh-CN' : 'en';

        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key);
            if (text && text !== key) {
                // Use innerHTML for translations containing HTML tags (e.g. <code>),
                // otherwise use textContent for safety
                if (/<[a-z][\s\S]*>/i.test(text)) {
                    el.innerHTML = text;
                } else {
                    el.textContent = text;
                }
            }
        });

        // Dispatch custom event for any dynamic listeners
        document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { locale: this.locale } }));
    },

    // Update UI elements related to locale
    updateUI() {
        const toggle = document.getElementById('langToggle');
        if (toggle) {
            toggle.querySelector('.lang-label').textContent = this.locale === 'zh' ? 'EN' : '中';
        }
    }
};
