import { useEffect, useState } from 'react';
import type { ProjectIcon as Icon, ProjectInfo } from '@switchboard/protocol/client';
import { basename } from '../lib/format.ts';
import { accentFromPixels, letterColor } from '../lib/projectColor.ts';

/** Sampled icon colours by icon (null: no clear colour), so each icon is drawn and read once. */
const iconColors = new Map<string, Promise<string | null>>();

/** The cache key of an icon: its picture or its emoji. */
const iconKey = (icon: Icon) => (icon.kind === 'image' ? icon.dataUrl : `emoji:${icon.value}`);

/** Draws an image or emoji icon small and reads the colour it shows. */
function sampleIcon(icon: Icon): Promise<string | null> {
  const key = iconKey(icon);
  let color = iconColors.get(key);
  if (!color) {
    color = (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      if (icon.kind === 'image') {
        const img = new Image();
        img.src = icon.dataUrl;
        await img.decode();
        ctx.drawImage(img, 0, 0, 32, 32);
      } else {
        ctx.font = '28px "Apple Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon.value, 16, 17);
      }
      return accentFromPixels(ctx.getImageData(0, 0, 32, 32).data);
    })().catch(() => null);
    iconColors.set(key, color);
  }
  return color;
}

/**
 * The colour a project's icon shows, for borders and glows that point at it: the letter tile's
 * colour, or the main colour of its image or emoji (the name's colour when that has none). Null
 * without a folder.
 */
export function useProjectColor(project: ProjectInfo | undefined, root: string | null): string | null {
  const icon = project?.icon ?? null;
  // Compared by key: the projects list comes back as new objects on every reload.
  const key = icon ? iconKey(icon) : null;
  const [sampled, setSampled] = useState<{ key: string; color: string | null } | null>(null);
  useEffect(() => {
    if (!icon || !key) return;
    let cancelled = false;
    void sampleIcon(icon).then((color) => !cancelled && setSampled({ key, color }));
    return () => {
      cancelled = true;
    };
  }, [key]);
  if (!root) return null;
  const fallback = letterColor(project?.name ?? basename(root));
  return (key && sampled?.key === key ? sampled.color : null) ?? fallback;
}

/** A project's icon: its image, its emoji, or its first letter on a coloured tile. */
export function ProjectIcon({ project, root, size = 14 }: { project: ProjectInfo | undefined; root: string; size?: number }) {
  const name = project?.name ?? basename(root);
  // Corners scale with the icon, so large ones read as tiles rather than squares.
  const box = { width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.22)) };
  if (project?.icon?.kind === 'image') {
    return <img src={project.icon.dataUrl} alt="" style={box} className="shrink-0 object-contain" draggable={false} />;
  }
  if (project?.icon?.kind === 'emoji') {
    return (
      <span style={{ ...box, fontSize: size * 0.85, lineHeight: `${size}px` }} className="shrink-0 text-center" aria-hidden>
        {project.icon.value}
      </span>
    );
  }
  return (
    <span
      style={{ ...box, background: letterColor(name), fontSize: size * 0.62 }}
      className="flex shrink-0 items-center justify-center font-semibold text-white uppercase"
      aria-hidden
    >
      {name.replace(/^[^a-z0-9]+/i, '').charAt(0) || '·'}
    </span>
  );
}
