import React from 'react';
import { Link } from 'react-router-dom';
import { t } from '../i18n';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span>© {new Date().getFullYear()} RapidGarage · {t('footer.tagline')}</span>
        <nav aria-label={t('footer.label')}>
          <Link to="/">{t('nav.browse')}</Link>
          <Link to="/newpost">{t('nav.postSale')}</Link>
          <Link to="/about">{t('nav.about')}</Link>
        </nav>
      </div>
    </footer>
  );
}
