import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

const url = import.meta.env.VITE_CONVEX_URL as string;
const client = new ConvexReactClient(url);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Keeps a rejected query from unmounting the tree into a blank page. */}
    <ErrorBoundary>
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
