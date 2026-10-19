import React from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';

// react-router 6 removed withRouter and the render-prop (props) => ... form, and
// it only exposes params/location/navigation through hooks. Most of this app is
// still written as class components (see docs/react-upgrade.md), which cannot
// call hooks, and ~30 call sites read this.props.match / .location / .history.
//
// This is the single bridge between the two. It re-creates the props that
// react-router 4 injected, so no component had to be rewritten during the 4 -> 6
// move. Once components migrate to hooks, this module and its uses can go.
//
// Note: RR6's navigate() returns a promise and, unlike RR4's history.push(), does
// not accept a second `state`-only call shape; the codebase only ever calls
// push/back, so the pass-through below is enough.

// `history` shape: push/replace/go/goBack/goForward, as RR4 exposed it.
function useHistoryShim() {
  const navigate = useNavigate();
  return React.useMemo(() => ({
    push: (to) => navigate(to),
    replace: (to) => navigate(to, { replace: true }),
    go: (n) => navigate(n),
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
  }), [navigate]);
}

// Injects the RR4-style props. `params` defaults are merged in first so a route
// like /events/new (no :id) still sees its own defaults before the URL's.
export function withRouterProps(Component, defaultParams) {
  function WithRouterProps(props) {
    const params = useParams();
    const location = useLocation();
    const history = useHistoryShim();
    const match = React.useMemo(
      () => ({ params: { ...(defaultParams || {}), ...params } }),
      [params]
    );
    return React.createElement(Component, { ...props, match, location, history });
  }
  WithRouterProps.displayName = `withRouterProps(${Component.displayName || Component.name || 'Component'})`;
  return WithRouterProps;
}
