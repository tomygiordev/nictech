import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/source-sans-3";
import App from "./App";
import { ErpAuthProvider } from "./auth/ErpAuthProvider";
import { queryClient } from "./lib/queryClient";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErpAuthProvider>
        <App />
      </ErpAuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
