import React from 'react';
import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { EmptyState } from './ui';

export default function NotFound() {
  return (
    <div className="container container-narrow">
      <EmptyState icon={SearchX} title="Page not found" action={<Link className="btn btn-primary" to="/">Browse sales</Link>}>
        That page doesn't exist or has moved.
      </EmptyState>
    </div>
  );
}
