/** A window onto the world map, in its units: x = longitude + 180, y = 90 - latitude. */
export interface MapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WORLD: MapBox = { x: 0, y: 0, width: 360, height: 180 };
/** About a city across: closer than this the land outline says nothing. */
const MIN_SPAN = 0.5;

export function project(lon: number, lat: number): [number, number] {
  return [lon + 180, 90 - lat];
}

/** The box centred on `cx, cy`, at least `width` by `height`, shaped like the screen. */
function shaped(cx: number, cy: number, width: number, height: number, aspect: number): MapBox {
  const w = Math.max(width, height * aspect, MIN_SPAN);
  const h = w / aspect;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** The points with a margin around them, shaped like a screen of `aspect` (width / height). */
export function fitBox(points: readonly [number, number][], aspect: number): MapBox {
  if (points.length === 0) return shaped(180, 90, 360, 180, aspect);
  let [left, top, right, bottom] = [360, 180, 0, 0];
  for (const [lon, lat] of points) {
    const [x, y] = project(lon, lat);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const width = right - left;
  const height = bottom - top;
  return shaped(
    (left + right) / 2,
    (top + bottom) / 2,
    width * 1.3 + MIN_SPAN,
    height * 1.3 + MIN_SPAN,
    aspect,
  );
}

/** Zoomed by `factor` (above 1 closer) keeping the map point under `focus` where it is. */
export function zoomBox(box: MapBox, factor: number, focus: [number, number]): MapBox {
  const width = Math.min(Math.max(box.width / factor, MIN_SPAN), WORLD.width * 1.5);
  const scale = width / box.width;
  const [fx, fy] = focus;
  return {
    x: fx - (fx - box.x) * scale,
    y: fy - (fy - box.y) * scale,
    width,
    height: box.height * scale,
  };
}

/** Moved by `dx, dy` map units, never so far that the world leaves the screen. */
export function panBox(box: MapBox, dx: number, dy: number): MapBox {
  const clamp = (value: number, size: number, world: number) =>
    Math.min(Math.max(value, -size / 2), world - size / 2);
  return {
    ...box,
    x: clamp(box.x + dx, box.width, WORLD.width),
    y: clamp(box.y + dy, box.height, WORLD.height),
  };
}
