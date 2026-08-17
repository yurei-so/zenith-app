const API_ROOT = "https://api.guildwars2.com";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

interface ApiTask {
  id: number;
  objective: string;
  level: number;
  coord: [number, number];
}

interface ApiPointOfInterest {
  id: number;
  name?: string;
  type: string;
  coord: [number, number];
}

interface ApiMapSummary {
  id: number;
  name: string;
  min_level: number;
  max_level: number;
  default_floor: number;
  region_id: number;
  region_name: string;
  continent_id: number;
  continent_name: string;
  map_rect: [[number, number], [number, number]];
  continent_rect: [[number, number], [number, number]];
}

interface ApiContinent {
  name: string;
  continent_dims: [number, number];
  min_zoom: number;
  max_zoom: number;
}

interface ApiMapDetails {
  id?: number;
  label_coord?: [number, number];
  tasks?: Record<string, ApiTask>;
  points_of_interest?: Record<string, ApiPointOfInterest>;
}

interface ApiAccount {
  name: string;
  fractal_level?: number;
  daily_ap?: number;
  monthly_ap?: number;
}

interface ApiCharacterCore {
  name: string;
  profession: string;
  level: number;
}

interface ApiAchievementProgress {
  current: number;
}

interface ApiMasteryPoints {
  totals: Array<{ region: string; spent: number; earned: number }>;
}

interface ApiTokenInfo {
  permissions: string[];
}

export interface PlayerProgression {
  configured: boolean;
  updatedAt: string;
  accountName: string | null;
  achievementPoints: number | null;
  fractalLevel: number | null;
  masteryPoints: { spent: number; earned: number } | null;
  character: { name: string; profession: string; level: number } | null;
  notice: string | null;
}

export interface NormalizedMap {
  id: number;
  name: string;
  minLevel: number;
  maxLevel: number;
  continentId: number;
  continentName: string;
  floorId: number;
  regionId: number;
  regionName: string;
  continentDimensions: [number, number];
  minZoom: number;
  maxZoom: number;
  mapRect: ApiMapSummary["map_rect"];
  continentRect: ApiMapSummary["continent_rect"];
  center: [number, number];
  hearts: Array<{
    id: number;
    name: string;
    level: number;
    coordinate: [number, number];
  }>;
  pointsOfInterest: Array<{
    id: number;
    name: string;
    kind: "landmark" | "waypoint" | "vista";
    coordinate: [number, number];
  }>;
}

export class Gw2ApiClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly loadedMapIds = new Set<number>();
  private readonly apiKey = process.env.ZENITH_GW2_API_KEY?.trim() ?? "";

  async getPlayerProgression(characterName: string | null): Promise<PlayerProgression> {
    const updatedAt = new Date().toISOString();
    if (!this.apiKey) {
      return {
        configured: false,
        updatedAt,
        accountName: null,
        achievementPoints: null,
        fractalLevel: null,
        masteryPoints: null,
        character: null,
        notice: "Set ZENITH_GW2_API_KEY to enable live account progression.",
      };
    }

    const token = await this.getAuthenticatedJson<ApiTokenInfo>("/v2/tokeninfo");
    const permissions = new Set(token.permissions);
    if (!permissions.has("account") || !permissions.has("progression")) {
      return {
        configured: true,
        updatedAt,
        accountName: null,
        achievementPoints: null,
        fractalLevel: null,
        masteryPoints: null,
        character: null,
        notice: "The configured API key needs account and progression permissions.",
      };
    }

    const characterRequest = characterName && permissions.has("characters")
      ? this.getAuthenticatedJson<ApiCharacterCore>(
          `/v2/characters/${encodeURIComponent(characterName)}/core`,
        ).catch(() => null)
      : Promise.resolve(null);
    const [account, achievements, mastery, character] = await Promise.all([
      this.getAuthenticatedJson<ApiAccount>("/v2/account"),
      this.getAuthenticatedJson<ApiAchievementProgress[]>("/v2/account/achievements"),
      this.getAuthenticatedJson<ApiMasteryPoints>("/v2/account/mastery/points"),
      characterRequest,
    ]);
    const achievementPoints = achievements.reduce(
      (total, achievement) => total + (Number.isFinite(achievement.current) ? achievement.current : 0),
      (account.daily_ap ?? 0) + (account.monthly_ap ?? 0),
    );
    const masteryPoints = mastery.totals.reduce(
      (total, region) => ({
        spent: total.spent + region.spent,
        earned: total.earned + region.earned,
      }),
      { spent: 0, earned: 0 },
    );

    return {
      configured: true,
      updatedAt,
      accountName: account.name,
      achievementPoints,
      fractalLevel: account.fractal_level ?? null,
      masteryPoints,
      character: character
        ? { name: character.name, profession: character.profession, level: character.level }
        : null,
      notice: characterName && !permissions.has("characters")
        ? "Add the characters permission to show live character progression."
        : null,
    };
  }

  async getMap(mapId: number, forceRefresh = false): Promise<NormalizedMap> {
    if (!Number.isSafeInteger(mapId) || mapId <= 0) {
      throw new RangeError("Map ID must be a positive integer");
    }
    const map = await this.getJson<ApiMapSummary>(
      `/v2/maps/${mapId}?lang=en`,
      forceRefresh,
    );
    if (
      map.id !== mapId ||
      typeof map.name !== "string" ||
      !Number.isInteger(map.continent_id) ||
      !Number.isInteger(map.default_floor) ||
      !Number.isInteger(map.region_id)
    ) {
      throw new Error("Guild Wars 2 API returned an unexpected map payload");
    }
    const continent = await this.getJson<ApiContinent>(
      `/v2/continents/${map.continent_id}?lang=en`,
      forceRefresh,
    );
    const detailsPath =
      `/v2/continents/${map.continent_id}` +
      `/floors/${map.default_floor}` +
      `/regions/${map.region_id}` +
      `/maps/${map.id}?lang=en`;
    // Instances and a few special maps have valid /v2/maps metadata but are not
    // represented in the continent floor tree. They can still render tiles.
    const details = await this.getJson<ApiMapDetails>(detailsPath, forceRefresh)
      .catch((): ApiMapDetails => ({}));
    const tasks = details.tasks ?? {};
    const pointsOfInterest = details.points_of_interest ?? {};
    const center = details.label_coord ?? [
      (map.continent_rect[0][0] + map.continent_rect[1][0]) / 2,
      (map.continent_rect[0][1] + map.continent_rect[1][1]) / 2,
    ];
    this.loadedMapIds.add(mapId);

    return {
      id: map.id,
      name: map.name,
      minLevel: map.min_level,
      maxLevel: map.max_level,
      continentId: map.continent_id,
      continentName: map.continent_name ?? continent.name,
      floorId: map.default_floor,
      regionId: map.region_id,
      regionName: map.region_name,
      continentDimensions: continent.continent_dims,
      minZoom: continent.min_zoom,
      // The continents endpoint reports the upper bound of the zoom range,
      // while the tile service uses zero-based zoom levels below that bound.
      maxZoom: Math.max(continent.min_zoom, continent.max_zoom - 1),
      mapRect: map.map_rect,
      continentRect: map.continent_rect,
      center,
      hearts: Object.values(tasks)
        .map((task) => ({
          id: task.id,
          name: task.objective,
          level: task.level,
          coordinate: task.coord,
        }))
        .sort((a, b) => a.level - b.level || a.id - b.id),
      pointsOfInterest: Object.values(pointsOfInterest)
        .filter(
          (
            point,
          ): point is ApiPointOfInterest & {
            type: "landmark" | "waypoint" | "vista";
          } =>
            point.type === "landmark" ||
            point.type === "waypoint" ||
            point.type === "vista",
        )
        .map((point) => ({
          id: point.id,
          name:
            point.name ??
            (point.type === "vista"
              ? "Vista"
              : point.type === "waypoint"
                ? "Waypoint"
                : "Point of interest"),
          kind: point.type,
          coordinate: point.coord,
        }))
        .sort((a, b) => a.id - b.id),
    };
  }

  status() {
    return {
      loadedMaps: [...this.loadedMapIds],
      cachedResponses: this.cache.size,
      inFlightRequests: this.inFlight.size,
    };
  }

  private async getJson<T>(path: string, forceRefresh: boolean): Promise<T> {
    const cached = this.cache.get(path);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
    const existing = this.inFlight.get(path);
    if (existing) return existing as Promise<T>;

    const request = this.fetchJson<T>(path)
      .then((value) => {
        this.cache.set(path, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          value,
        });
        return value;
      })
      .catch((error) => {
        // A stale map is better than no map during a transient API outage.
        if (cached) return cached.value as T;
        throw error;
      })
      .finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, request);
    return request;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_ROOT}${path}`, {
        headers: {
          accept: "application/json",
          "user-agent": "Zenith-GW2-Companion/0.1",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Guild Wars 2 API returned HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getAuthenticatedJson<T>(path: string): Promise<T> {
    const cacheKey = `authenticated:${path}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing as Promise<T>;

    const request = this.fetchAuthenticatedJson<T>(path)
      .then((value) => {
        this.cache.set(cacheKey, { expiresAt: Date.now() + 30_000, value });
        return value;
      })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async fetchAuthenticatedJson<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_ROOT}${path}`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "user-agent": "Zenith-GW2-Companion/0.1",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Guild Wars 2 API returned HTTP ${response.status}`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
