"use client";

import { useEffect } from "react";
import {
  INSTAGRAM_GALLERY_ITEMS,
  INSTAGRAM_PROFILE_URL,
} from "@/lib/instagramGallery";

const EMBED_SCRIPT_ID = "instagram-embed-js";
const EMBED_SCRIPT_SRC = "https://www.instagram.com/embed.js";

function loadInstagramEmbedScript() {
  if (typeof window === "undefined") return Promise.resolve();

  if (window.instgrm?.Embeds) {
    window.instgrm.Embeds.process();
    return Promise.resolve();
  }

  const existing = document.getElementById(EMBED_SCRIPT_ID);
  if (existing) {
    window.instgrm?.Embeds?.process();
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = EMBED_SCRIPT_ID;
    script.async = true;
    script.src = EMBED_SCRIPT_SRC;
    script.onload = () => {
      window.instgrm?.Embeds?.process();
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Instagram embed.js"));
    document.body.appendChild(script);
  });
}

function InstagramCaption({ caption }) {
  if (!caption) return null;

  const lines = caption.split("\n");
  let inRestoration = false;

  return (
    <div className="mb-3 rounded-2xl border-2 border-berry/35 bg-gradient-to-br from-blush/40 via-cream to-berry/15 px-4 py-4 text-left shadow-sm">
      <div className="space-y-1 text-base leading-snug text-ink md:text-lg">
        {lines.map((line, index) => {
          const trimmed = line.trim();
          if (trimmed === "") {
            return <div key={`blank-${index}`} className="h-2" />;
          }

          const isCardOrSet = /card:/i.test(line) || /set:/i.test(line);
          if (/restoration performed/i.test(trimmed)) {
            inRestoration = true;
          }

          if (isCardOrSet) {
            return (
              <p
                key={`${index}-${line}`}
                className="font-secondary text-lg text-ink md:text-xl"
              >
                {line}
              </p>
            );
          }

          return (
            <p
              key={`${index}-${line}`}
              className={`px-0.5 text-ink/80 ${inRestoration ? "pl-5" : ""}`}
            >
              {line}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function InstagramEmbed({ url, captioned = true }) {
  return (
    <blockquote
      className="instagram-media"
      {...(captioned ? { "data-instgrm-captioned": true } : {})}
      data-instgrm-permalink={url}
      data-instgrm-version="14"
      style={{
        background: "#FFF",
        border: 0,
        borderRadius: "3px",
        boxShadow:
          "0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15)",
        margin: "0 auto",
        maxWidth: "540px",
        minWidth: "326px",
        padding: 0,
        width: "calc(100% - 2px)",
      }}
    >
      <a href={url} target="_blank" rel="noopener noreferrer">
        View this post on Instagram
      </a>
    </blockquote>
  );
}

function EmbedSection({ title, items }) {
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      {title ? (
        <h3 className="font-display text-center text-xl font-bold text-ink">
          {title}
        </h3>
      ) : null}
      <div className="grid grid-cols-1 justify-items-center gap-6 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="w-full max-w-[540px]">
            <InstagramCaption caption={item.caption} />
            <InstagramEmbed url={item.url} captioned={!item.caption} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function InstagramEmbedGrid({
  items = INSTAGRAM_GALLERY_ITEMS,
}) {
  useEffect(() => {
    let cancelled = false;

    loadInstagramEmbedScript().catch(() => {
      if (!cancelled) {
        // Embeds still show the fallback “View on Instagram” link.
      }
    });

    return () => {
      cancelled = true;
    };
  }, [items]);

  if (!items.length) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border-2 border-ink/10 bg-cream/60 px-6 py-10 text-center">
        <p className="text-sm text-ink/70">
          No Instagram posts listed yet. Add permalinks in{" "}
          <code className="rounded bg-ink/5 px-1.5 py-0.5 text-xs">
            src/lib/instagramGallery.js
          </code>
          .
        </p>
        <a
          href={INSTAGRAM_PROFILE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm font-semibold text-berry underline-offset-2 hover:underline"
        >
          Follow @pokepatch.cards
        </a>
      </div>
    );
  }

  const posts = items.filter((item) => item.kind === "post");
  const reels = items.filter((item) => item.kind === "reel");
  const showSectionTitles = posts.length > 0 && reels.length > 0;

  return (
    <div className="space-y-12">
      <EmbedSection
        title={showSectionTitles ? "Posts" : null}
        items={posts}
      />
      <EmbedSection
        title={showSectionTitles ? "Reels" : null}
        items={reels}
      />

      <p className="text-center text-sm text-ink/60">
        More on{" "}
        <a
          href={INSTAGRAM_PROFILE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-berry underline-offset-2 hover:underline"
        >
          @pokepatch.cards
        </a>
      </p>
    </div>
  );
}
