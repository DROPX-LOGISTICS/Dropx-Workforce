"use client";

import { TextareaHTMLAttributes, useEffect, useRef } from "react";

type AutoGrowTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function AutoGrowTextarea({ className, onInput, rows = 3, ...props }: AutoGrowTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function resize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  useEffect(() => {
    if (textareaRef.current) resize(textareaRef.current);
  }, []);

  return (
    <textarea
      {...props}
      className={`field auto-grow-textarea ${className ?? ""}`.trim()}
      onInput={(event) => {
        resize(event.currentTarget);
        onInput?.(event);
      }}
      ref={textareaRef}
      rows={rows}
    />
  );
}
