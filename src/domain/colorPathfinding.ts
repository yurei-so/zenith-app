import type { ContinentPoint, ZoneMap } from "./types";
import { continentBoundsToTileRange } from "./coordinates";

const TILE_SIZE = 256;
const MAX_GRID_SPAN = 76;
const MAX_TILE_REQUESTS = 36;

export interface ExperimentalRoute {
  points: ContinentPoint[];
  confidence: "low" | "medium";
  sampledTiles: number;
}

interface SampledTile {
  pixels: Uint8ClampedArray;
  width: number;
}

const tileCache = new Map<string, Promise<SampledTile>>();

export function colorTraversalCost(red: number, green: number, blue: number) {
  const brightness = (red + green + blue) / 3;
  if (brightness < 48) return 8;
  if (blue > red * 1.08 && blue > green * 1.03) return 7;
  if (red > blue * 1.18 && red > green * 1.02 && brightness > 105) return 0.72;
  if (green > red * 1.05 && green > blue * 1.04) return 1.35;
  if (brightness > 205) return 2.8;
  return 1.8;
}

function chooseAnalysisZoom(zone: ZoneMap) {
  for (let zoom = zone.maxZoom; zoom >= zone.minZoom; zoom -= 1) {
    if (continentBoundsToTileRange(zone.continentRect, zoom, zone.maxZoom).count <= MAX_TILE_REQUESTS) {
      return zoom;
    }
  }
  return zone.minZoom;
}

function loadTile(url: string, signal: AbortSignal): Promise<SampledTile> {
  const cached = tileCache.get(url);
  if (cached) return cached;
  const request = new Promise<SampledTile>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (signal.aborted) {
        reject(new DOMException("Route analysis cancelled", "AbortError"));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        reject(new Error("Canvas sampling is unavailable"));
        return;
      }
      context.drawImage(image, 0, 0);
      try {
        resolve({
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
          width: canvas.width,
        });
      } catch {
        reject(new Error("Map tiles do not permit color sampling"));
      }
    };
    image.onerror = () => reject(new Error("A map tile could not be sampled"));
    image.src = url;
  });
  tileCache.set(url, request);
  request.catch(() => tileCache.delete(url));
  return request;
}

interface Grid {
  costs: Float32Array;
  width: number;
  height: number;
  cellSize: number;
  minX: number;
  minY: number;
}

function findPath(grid: Grid, startPoint: ContinentPoint, goalPoint: ContinentPoint) {
  const { width, height, costs, cellSize, minX, minY } = grid;
  const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum - 1, value));
  const toCell = (point: ContinentPoint) => [
    clamp(Math.floor((point[0] - minX) / cellSize), width),
    clamp(Math.floor((point[1] - minY) / cellSize), height),
  ] as const;
  const [startX, startY] = toCell(startPoint);
  const [goalX, goalY] = toCell(goalPoint);
  const start = startY * width + startX;
  const goal = goalY * width + goalX;
  const scores = new Float64Array(width * height);
  scores.fill(Number.POSITIVE_INFINITY);
  scores[start] = 0;
  const parents = new Int32Array(width * height);
  parents.fill(-1);
  const open = new Set<number>([start]);

  while (open.size) {
    let current = -1;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of open) {
      const x = candidate % width;
      const y = Math.floor(candidate / width);
      const estimate = scores[candidate] + Math.hypot(goalX - x, goalY - y);
      if (estimate < best) {
        best = estimate;
        current = candidate;
      }
    }
    if (current === goal) break;
    open.delete(current);
    const x = current % width;
    const y = Math.floor(current / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const neighbor = (y + dy) * width + x + dx;
        const score = scores[current] + costs[neighbor] * (dx && dy ? Math.SQRT2 : 1);
        if (score >= scores[neighbor]) continue;
        scores[neighbor] = score;
        parents[neighbor] = current;
        open.add(neighbor);
      }
    }
  }

  if (start !== goal && parents[goal] < 0) return [];
  const cells: number[] = [];
  for (let current = goal; current >= 0; current = parents[current]) {
    cells.push(current);
    if (current === start) break;
  }
  cells.reverse();
  const stride = Math.max(1, Math.floor(cells.length / 24));
  const points: ContinentPoint[] = [startPoint];
  for (let index = stride; index < cells.length - 1; index += stride) {
    const cell = cells[index];
    points.push([
      minX + ((cell % width) + 0.5) * cellSize,
      minY + (Math.floor(cell / width) + 0.5) * cellSize,
    ]);
  }
  points.push(goalPoint);
  return points;
}

export async function buildColorRoute(
  zone: ZoneMap,
  start: ContinentPoint,
  goal: ContinentPoint,
  signal: AbortSignal,
): Promise<ExperimentalRoute> {
  const zoom = chooseAnalysisZoom(zone);
  const tileRange = continentBoundsToTileRange(zone.continentRect, zoom, zone.maxZoom);
  const tiles = new Map<string, SampledTile>();
  await Promise.all(
    Array.from({ length: tileRange.maxY - tileRange.minY + 1 }, (_, yOffset) =>
      Array.from({ length: tileRange.maxX - tileRange.minX + 1 }, async (_, xOffset) => {
        const x = tileRange.minX + xOffset;
        const y = tileRange.minY + yOffset;
        const url = `https://tiles.guildwars2.com/${zone.continentId}/${zone.floorId}/${zoom}/${x}/${y}.jpg`;
        tiles.set(`${x}:${y}`, await loadTile(url, signal));
      }),
    ).flat(),
  );
  if (signal.aborted) throw new DOMException("Route analysis cancelled", "AbortError");

  const minX = zone.continentRect[0][0];
  const minY = zone.continentRect[0][1];
  const spanX = zone.continentRect[1][0] - minX;
  const spanY = zone.continentRect[1][1] - minY;
  const cellSize = Math.max(spanX, spanY) / MAX_GRID_SPAN;
  const width = Math.max(2, Math.ceil(spanX / cellSize));
  const height = Math.max(2, Math.ceil(spanY / cellSize));
  const costs = new Float32Array(width * height);
  const zoomScale = 2 ** (zone.maxZoom - zoom);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const continentX = minX + (x + 0.5) * cellSize;
      const continentY = minY + (y + 0.5) * cellSize;
      const pixelX = continentX / zoomScale;
      const pixelY = continentY / zoomScale;
      const tileX = Math.floor(pixelX / TILE_SIZE);
      const tileY = Math.floor(pixelY / TILE_SIZE);
      const tile = tiles.get(`${tileX}:${tileY}`);
      if (!tile) {
        costs[y * width + x] = 3;
        continue;
      }
      const localX = Math.max(0, Math.min(tile.width - 1, Math.floor(pixelX - tileX * TILE_SIZE)));
      const localY = Math.max(0, Math.min(tile.width - 1, Math.floor(pixelY - tileY * TILE_SIZE)));
      const offset = (localY * tile.width + localX) * 4;
      costs[y * width + x] = colorTraversalCost(
        tile.pixels[offset],
        tile.pixels[offset + 1],
        tile.pixels[offset + 2],
      );
    }
  }
  return {
    points: findPath({ costs, width, height, cellSize, minX, minY }, start, goal),
    confidence: zoom >= zone.maxZoom - 2 ? "medium" : "low",
    sampledTiles: tiles.size,
  };
}
