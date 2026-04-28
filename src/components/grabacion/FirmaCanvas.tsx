"use client";

import * as React from "react";
import { Button } from "@/components/ui";

interface FirmaCanvasProps {
  onFirmaChange: (firmaBase64: string | null) => void;
  ancho?: number;
  alto?: number;
}

function getCanvasPoint(
  canvas: HTMLCanvasElement,
  event: MouseEvent | TouchEvent,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();

  let clientX: number;
  let clientY: number;

  if ("touches" in event) {
    if (event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else if (event.changedTouches.length > 0) {
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    } else {
      return null;
    }
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function FirmaCanvas({
  onFirmaChange,
  ancho = 400,
  alto = 200,
}: FirmaCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const drawingRef = React.useRef(false);
  const lastPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const hasDrawnRef = React.useRef(false);
  const [hasDrawn, setHasDrawn] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const setupCanvas = () => {
      const cssWidth = container.getBoundingClientRect().width;
      const cssHeight = alto;
      if (cssWidth <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      const previous = hasDrawnRef.current ? canvas.toDataURL("image/png") : null;

      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1A2628";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      if (previous) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
        };
        img.src = previous;
      }
    };

    setupCanvas();

    const observer = new ResizeObserver(setupCanvas);
    observer.observe(container);
    return () => observer.disconnect();
  }, [alto]);

  const handlePointerDown = (
    event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = getCanvasPoint(canvas, event.nativeEvent);
    if (!point) return;

    drawingRef.current = true;
    lastPointRef.current = point;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#1A2628";
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";

    if (!hasDrawnRef.current) {
      hasDrawnRef.current = true;
      setHasDrawn(true);
    }
  };

  const handlePointerMove = (
    event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const point = getCanvasPoint(canvas, event.nativeEvent);
    if (!ctx || !point) return;

    const last = lastPointRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    lastPointRef.current = point;
  };

  const handlePointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;

    const canvas = canvasRef.current;
    if (canvas && hasDrawnRef.current) {
      onFirmaChange(canvas.toDataURL("image/png"));
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssWidth = container.getBoundingClientRect().width;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cssWidth, alto);

    hasDrawnRef.current = false;
    setHasDrawn(false);
    onFirmaChange(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="w-full"
        style={{ maxWidth: ancho }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Lienzo para tu firma"
          className="block w-full rounded-md border border-[color:var(--border-subtle)] bg-white touch-none"
          style={{ height: alto }}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          onTouchCancel={handlePointerUp}
        />
      </div>
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={!hasDrawn}
          aria-label="Borrar firma"
        >
          Borrar firma
        </Button>
      </div>
    </div>
  );
}
