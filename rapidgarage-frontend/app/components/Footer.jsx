import React from 'react';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span>© {new Date().getFullYear()} RapidGarage · Garage and yard sales near you</span>
        <nav aria-label="Footer">
          <Link to="/">Browse</Link>
          <Link to="/newpost">Post a sale</Link>
          <Link to="/about">About</Link>
        </nav>
      </div>
    </footer>
  );
}
