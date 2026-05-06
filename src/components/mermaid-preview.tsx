"use client";

import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";

type MermaidPreviewProps = {
  chart: string;
};

export function MermaidPreview({ chart }: MermaidPreviewProps) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      setError(null);
      if (chart.trim().length === 0) {
        setSvg("");
        return;
      }

      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: "transparent",
            primaryColor: cssColor("--panel", "#11110f"),
            primaryTextColor: cssColor("--foreground", "#f5f2ea"),
            primaryBorderColor: cssColor("--border", "#302e28"),
            lineColor: cssColor("--edge", "#8b867c"),
            fontFamily: "Arial, Helvetica, sans-serif",
          },
        });
        const rendered = await mermaid.render(`atlas_${id}`, chart);
        if (!cancelled) {
          setSvg(rendered.svg);
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("");
          setError(renderError instanceof Error ? renderError.message : "Mermaid could not render this graph.");
        }
      }
    }

    renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
        {error}
      </div>
    );
  }

  if (!svg) {
    return <div className="h-36 animate-pulse rounded-md bg-muted" aria-label="Rendering Mermaid chart" />;
  }

  return (
    <div
      className="overflow-auto rounded-md border border-border bg-background p-4 [&_svg]:max-w-none"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function cssColor(variableName: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value.length > 0 ? value : fallback;
}
