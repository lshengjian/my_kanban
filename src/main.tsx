import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider } from "convex/react";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { clientFor, readEnv, writeEnv, type EnvKey } from "./backend";
import { writeToken } from "./session";
import "./styles.css";

/**
 * Owns the selected backend. Changing it swaps the Convex client and remounts
 * the app, because the two deployments share no data and no sessions.
 */
function Root() {
  const [env, setEnv] = useState<EnvKey>(() => readEnv());

  const changeEnv = (next: EnvKey) => {
    if (next === env) return;
    // A session token is only valid in the deployment that issued it, so drop
    // it rather than letting the next load bounce off UNAUTHENTICATED.
    writeToken(null);
    writeEnv(next);
    setEnv(next);
  };

  return (
    <ConvexProvider client={clientFor(env)}>
      {/* key={env} resets every view and session-state hook on a switch. */}
      <App key={env} env={env} onChangeEnv={changeEnv} />
    </ConvexProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Keeps a rejected query from unmounting the tree into a blank page. */}
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
