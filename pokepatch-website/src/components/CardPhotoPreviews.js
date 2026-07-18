"use client";

import { useEffect, useState } from "react";

function CardPhotoTile({ src, alt, label, href, onRemove, removeAriaLabel }) {
  const image = (
    <div className="flex aspect-[3/4] w-full items-center justify-center bg-cream/80 p-1">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <span className="text-xs text-ink/50">Loading...</span>
      )}
    </div>
  );

  return (
    <li className="group relative w-24 shrink-0 overflow-hidden rounded-xl border-2 border-ink/10 bg-cream/80">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          {image}
        </a>
      ) : (
        image
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeAriaLabel ?? `Remove ${label}`}
          className="absolute right-1.5 top-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-xs font-bold text-cream transition-colors duration-150 sm:hover:bg-ink"
        >
          ✕
        </button>
      )}
      {label && (
        <span className="block truncate px-2 py-1 text-xs text-ink">
          {label}
        </span>
      )}
    </li>
  );
}

export function CardPhotoPreviewGrid({
  items,
  onRemove,
  caption,
  title,
  emptyText = "None",
  className = "",
}) {
  if (title && items.length === 0) {
    return (
      <div className={className}>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs text-ink/60">{emptyText}</p>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className={className}>
      {title && (
        <p className="text-sm font-semibold text-ink">{title}</p>
      )}
      {caption && (
        <p
          className={`text-sm text-ink/60 ${title ? "mt-1" : ""}`}
        >
          {caption}
        </p>
      )}
      <ul className="mt-3 flex flex-wrap gap-3">
        {items.map((item) => (
          <CardPhotoTile
            key={item.id}
            src={item.src}
            alt={item.alt}
            label={item.label}
            href={item.href}
            onRemove={onRemove ? () => onRemove(item.id) : undefined}
            removeAriaLabel={item.removeAriaLabel}
          />
        ))}
      </ul>
    </div>
  );
}

export function StagedCardPhotoPreviews({ files, onRemove, caption }) {
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    const urls = files.map((item) => URL.createObjectURL(item.file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  const items = files.map((item, index) => ({
    id: item.id,
    src: previews[index] ?? null,
    alt: item.file.name,
    label: item.file.name,
    removeAriaLabel: `Remove ${item.file.name}`,
  }));

  return (
    <CardPhotoPreviewGrid items={items} onRemove={onRemove} caption={caption} />
  );
}
