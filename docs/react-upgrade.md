# React 16 → 18 and react-router 4 → 6 upgrade

Status: **plan**. This is a large, mechanical refactor of the frontend. It is
split into staged, individually-verifiable PRs so `master` is never broken
between steps.

## Why React 18, not 19

- **18** (Sept 2022) — `createRoot`, automatic batching, `useSyncExternalStore`,
  `useId`, `Suspense` on the server. The legacy class API is untouched;
  `ReactDOM.render` prints a deprecation warning and still works.
- **19** (Dec 2024) — removes `ReactDOM.render`/`ReactDOM.hydrate`,
  `defaultProps` on function components, string refs, and **`propTypes`**;
  requires `react-dom/client`.

Because of 19's `ReactDOM.render` removal, move 16 → 18 first; 18 → 19 is then
a small, separate step (createRoot only) if/when wanted. Everything below is
verified against 18.

## What the survey found (matters for effort)

| Area | Reality |
|---|---|
| Component style | **77 class components, 0 hooks, 0 `React.memo`/`forwardRef`** |
| Legacy lifecycle (`componentWillMount` etc.) | **0** — no `UNSAFE_` migration needed |
| String refs / `findDOMNode` / `ReactDOMServer` | **0** — `createRef` in 14 files already |
| `ReactDOM.render` | exactly **1** (`app/index.jsx:18`) |
| Legacy context (`childContextTypes`) | **0** |
| Tests | `node --test`; 15 files; only **1** touches React (`test/a11y.test.js`); **no test imports `.jsx`** |
| Build plugins (`share/`, `pwa/`, `vite.config.js`) | **no React/router coupling**, no SSR |
| Peer deps | `lucide-react` already allows 18/19; `@googlemaps/markerclusterer` is React-free; **only react-router must bump** |

Router surface (all in `app/`):

- `Link` — 55 files (safe API, unchanged)
- `Redirect` — 6 sites → `Navigate`
- `withRouter` — 2 (`App.jsx`, `post/DuplicateButton.jsx`) → removed in RR6
- `NavLink` `activeClassName`/`exact` — 1 file, 8 props → `className={({isActive})}`
- `<Switch>` → `<Routes>`, `<Route render|component>` → `element` — 34 routes, **1 file**
- router props read: `match` 23 (13 files), `history` 16 (9 files), `location` 14 (6 files)

## The one hard part

RR6 has **no `withRouter`**, and 77 class components cannot call hooks. Reading
`match.params`/`history` in a class component therefore needs a small bridge.
Add one shim module and keep it tiny:

```js
// app/lib/router.js
import React from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';

// Bridge RR6 hooks back to the props RR4's withRouter used to inject, so the
// (many) class components keep reading this.props.match/history/location.
export const withRouter = (Component) => (props) =>
  React.createElement(Component, {
    ...props,
    match: { params: useParams() },
    history: useNavigate(),
    location: useLocation(),
  });
```

Doing this in **one** place means RR6's `useNavigate` async-contract check (below)
has a single fixup point and the class components need no edits.

Gotchas that the shim must cover:

- `history.push`/`replace`/`go`/`goBack` exist on `navigate`; `navigate` is
  **async** in RR6 — the `app/post/Post.jsx` navigation paths must be verified.
- `location.state`/`location.search`/`location.hash` — unchanged names.
- `props.match.path`/`url` (pattern resolution) is gone; only `params` is
  provided. Confirm no component reads `match.path`/`match.url` (survey found
  none, but re-check during implementation).

## Staged PRs

### Stage 1 — React 16 → 18 (no router change)
1. Bump `react` + `react-dom` to `^18.3.1`; drop `history` 4 if RR6 bundles its
   own (keep until Stage 2 so nothing changes twice).
2. `app/index.jsx`: `ReactDOM.render` → `createRoot` from `react-dom/client`.
3. Fix `scheduler` mismatch in the lockfile (16.14 tree ships `scheduler@0.19`).
4. Update `vite.config.js` vendor regex (keep `react`, `react-dom`, drop the
   stale `scheduler` pin if unused).
5. Keep everything else identical. `ReactDOM.render`'s deprecation warning is
   the only behavioural change.

Verify: `npm test` 95 passing, `npm run build`, `npm run check:pwa` 21/21, and
a manual smoke of `/`, `/post/:id`, `/login`, `/messages`, `/admin`.

### Stage 2 — react-router 4 → 6
1. Bump `react-router-dom` to `^6.30.0` (6 is deliberately chosen over 7: v7
   requires React ≥18 and changes typing/packaging, but its client API is the
   same — v6 keeps this stage minimal). Drop `react-router` (v6 re-exports
   everything from `react-router-dom`).
2. `app/index.jsx`: `BrowserRouter` is unchanged.
3. `app/App.jsx`: `<Switch>` → `<Routes>`; every `render={(props) => <X {...props} .../>}`
   → `element={<X .../>}`, injecting `common`/`config` via a **context**
   (`AppRoutesContext`) instead of render-prop args, so the 34 routes stay
   declarative. `NotFound` becomes `<Route path="*" element={<NotFound/>} />`.
4. `app/lib/router.js`: add the `withRouter` bridge above; re-export it from
   wherever `DuplicateButton` and `App` import it.
5. `<Redirect to=.../>` → `<Navigate to=... replace/>` in the 6 auth files
   (`user/Login.jsx`, `user/Logout.jsx`, `user/ResetPassword.jsx`,
   `user/SignUp.jsx`, `post/NewPost.jsx`, `post/EditPost.jsx`).
6. `components/NavBar.jsx`: `activeClassName`/`exact` → RR6 `className={({isActive}) => ...}`
   (`end` replaces `exact`).
7. Verify all 170 `<Link>` targets and the `#hash` anchors (`saved/Saved.jsx`,
   `user/Unsubscribe.jsx`).

Verify: same four commands as Stage 1, plus the full manual route walk
(deep-link each of the 34 routes).

### Stage 3 (optional, later) — React 18 → 19
`createRoot` already in place; bump to `^19`, remove nothing else (no
`defaultProps`/string refs/`propTypes` in this codebase). Cheap once Stage 1–2
have soaked.

### Stage 4 (optional) — `StrictMode`
Only after Stage 2. StrictMode double-invokes effects and remounts, which will
expose the run-once assumptions the survey found (`App.jsx:88` interval,
`Messages.jsx:75`, and the add/remove-listener pairs in `NavBar`, `ui.jsx`
Dialog, `AddToCalendar`, `ShareButton`). Worth doing, but as its own PR with
the listener audit — not bundled with the version bump.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| 34-route table rewritten by hand | Single file; verify by deep-linking every route in the a11y/manual pass |
| `withRouter` bridge hides bugs | Keep it to one module, documented as a migration shim, and delete it later once components move to hooks |
| RR6 `navigate` is async; RR4 `history.push` was not | Audit the 16 `props.history` sites, especially `post/Post.jsx` (4 sites) and `Messages.jsx` |
| Class components + StrictMode | Deferred to Stage 4 |
| `i18n.init().then()` boot ordering | Preserve the async boot around `createRoot` in `index.jsx` |
| No test renders components | Add a small render smoke test (Stage 2) — currently only `a11y.test.js` touches React at all |

## Verification (every stage)

```
cd rapidgarage-frontend
npm test          # 95 passing today
npm run build     # must stay warning-free
npm run check:pwa # 21/21
npm run test:a11y # Playwright + axe, needs a running app
```

Plus the manual route walk. No backend change is involved.

## Outcome (as shipped)

All four stages landed. Each was verified the same way (unit tests, a
warning-free build, `check:pwa` 21/21, a real-browser deep-link walk over
every route, and the project's Playwright + axe-core suite — 386 states,
0 violations).

- **Stage 1** — React 16.14 → 18.3 (#79). `createRoot` only; nothing else
  needed, since the codebase uses no lifecycle, string ref, legacy context
  or `defaultProps` that 18 changed.
- **Stage 2** — react-router 4.3 → 6.30 (#81). The `withRouter` bridge
  shipped as `app/lib/router.jsx` (`withRouterProps`) plus a single
  `RoutedInner` wrapper in `App.jsx`, rather than the per-file swap this
  doc first sketched — the route table stayed declarative and only one
  module had to know about RR4-vs-RR6 props.
- **Stage 3** — React 18.3 → 19.3 (#82). Version bump only; the React 19
  removals (`ReactDOM.render`, string refs, `propTypes`, factory
  components) were all absent.
- **Stage 4** — `StrictMode`, dev-only (this change). Wrapped in
  `app/index.jsx` behind `import.meta.env.DEV`, so the production bundle
  is byte-identical (the built entry does not reference `StrictMode` at
  all). A lifecycle probe on the dev server confirmed the double-invoke
  is real (`ctor, ctor, render, render, didMount, willUnmount, didMount`),
  and an instrumented run showed no leaked intervals or listeners across
  30 reloads and 8 SPA navigations.

One caveat found while doing Stage 4: because the app waits for
`i18n.init()` (a dynamic-import promise) before its first render, `App`'s
own class lifecycle mounts *outside* StrictMode's double-invoke window —
the wrapper is double-invoked, but `App.componentDidMount` commits once.
The guard therefore mainly protects the routed page components (Messages,
Saved, dialogs), which mount synchronously. Moving the boot into a
Suspense boundary would widen the window, but at the cost of the
"no English flash" guarantee, so it was left as is.

Left over, not scheduled: the `withRouterProps` shim can be deleted as
components migrate to hooks, and components can then be converted from
classes to functions incrementally.
