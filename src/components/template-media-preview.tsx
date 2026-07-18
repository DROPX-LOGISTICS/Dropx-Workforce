"use client";

import { useEffect, useState } from "react";
import type { WhatsAppTemplateHeaderMediaType } from "@/lib/whatsapp-template";

type TemplateMediaPreviewProps = {
  file: File | null;
  type: WhatsAppTemplateHeaderMediaType | null;
};

export function TemplateMediaPreview({ file, type }: TemplateMediaPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (!file || type !== "image") {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, type]);

  if (!type) return null;

  if (!file) {
    return (
      <div className="template-media-preview empty">
        <span>{`Header ${type} preview`}</span>
        <strong>{`Upload ${type}`}</strong>
      </div>
    );
  }

  if (type === "image" && previewUrl) {
    return (
      <figure className="template-media-preview">
        <img alt={file.name} src={previewUrl} />
        <figcaption>{file.name}</figcaption>
      </figure>
    );
  }

  return (
    <div className="template-media-preview file-card">
      <span className="template-media-icon">{type === "video" ? "Video" : "File"}</span>
      <div>
        <strong>{file.name}</strong>
        <small>{formatFileSize(file.size)}</small>
      </div>
    </div>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
