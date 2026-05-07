"use client";

import { Component, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; error: string };

export default class RootErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, error: error?.message || "Unknown error" };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: "white", padding: "20px", background: "#0d1117" }}>
          <h1>Error: {this.state.error}</h1>
        </div>
      );
    }
    return this.props.children;
  }
}
