import React from 'react';
import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { EmptyState } from './ui';
import { t } from '../i18n';

export default function NotFound() {
  return (
    <div className="container container-narrow">
      <EmptyState icon={SearchX} level={1} title={t('notFound.title')} action={<Link className="btn btn-primary" to="/">{t('nav.browseSales')}</Link>}>
        {t('notFound.text')}
      </EmptyState>
    </div>
  );
}
