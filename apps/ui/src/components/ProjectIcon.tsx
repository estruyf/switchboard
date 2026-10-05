import type { ProjectInfo } from '@switchboard/protocol/client';
import { basename } from '../lib/format.ts';

/** Stable, readable colour per project name for the letter fallback. */
export function letterColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 45% 42%)`;
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
