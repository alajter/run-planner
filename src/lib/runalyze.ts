// Runalyze over its MCP server (https://runalyze.com/mcp). One session per call site: serverless
// functions don't keep state, and the handshake is cheap next to the calls it serves.
const MCP_URL = "https://runalyze.com/mcp";
const PROTOCOL = "2025-06-18";

export class RunalyzeError extends Error {}


interface RpcReply {
  error?: { code: number; message: string };
  result?: { isError?: boolean; content?: unknown; structuredContent?: unknown };
}

function parse(text: string): RpcReply {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  // SSE framing: the JSON is split over `data:` lines
  return JSON.parse(t.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5)).join(""));
}

export class Runalyze {
  private sid: string | null = null;

  constructor(private token: string | null) {
    if (!token) throw new RunalyzeError("No Runalyze token: add it in Settings");
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer pt#${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.sid ? { "Mcp-Session-Id": this.sid, "Mcp-Protocol-Version": PROTOCOL } : {}),
    };
  }

  private async post(body: object): Promise<Response> {
    return fetch(MCP_URL, { method: "POST", headers: this.headers(), body: JSON.stringify(body), cache: "no-store" });
  }

  private async init() {
    this.sid = null;
    const r = await this.post({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "runalyze-planner", version: "0.1" } } });
    if (!r.ok) throw new RunalyzeError(`initialize: HTTP ${r.status}`);
    this.sid = r.headers.get("mcp-session-id");
    await r.text();
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Call one tool and return its structured result. A dead session re-initializes once. */
  async call<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.sid) await this.init();
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
      let why = `HTTP ${r.status}`;
      if (r.ok) {
        const d = parse(await r.text());
        if (!d.error) {
          if (d.result?.isError) throw new RunalyzeError(`${tool}: ${JSON.stringify(d.result.content).slice(0, 200)}`);
          return (d.result?.structuredContent ?? d.result) as T;
        }
        if (d.error.code === -32602) throw new RunalyzeError(`${tool}: ${d.error.message}`);   // bad arguments: no retry
        why = d.error.message;
      }
      if (attempt === 0) await this.init();
      else throw new RunalyzeError(`${tool}: ${why}`);
    }
    throw new RunalyzeError(`${tool}: failed`);
  }
}

// — the shapes this app reads —
export interface RActivity {
  id: number; title: string; sport: string; type: string; date: string; datetime: string;
  distance: number; duration: number; average_heart_rate: number | null; maximum_heart_rate: number | null;
  effective_vo2max: number | null;
}
export interface RDetail extends RActivity {
  trimp: number | null; cadence: number | null; cadence_display_factor: number | null;
  aerobic_decoupling_pace: number | null; temperature: number | null; humidity: number | null;
  elevation_up: number | null; vo2max: number | null;
  splits: { index: number; distance: number; duration: number; pace: number }[] | null;
  streams?: { distance?: number[]; time?: number[]; heart_rate?: (number | null)[]; cadence?: (number | null)[] };
}
export interface RCalculations {
  effectiveVO2max: number; fitness: number; fatigue: number; performance: number;
  acuteChronicWorkloadRatio: number; restDays: number; marathonShape: number;
  hrvBaseline: number | null; hrvNormalRange: [number, number] | null;
}
export interface RPrognosis {
  predictions_available: boolean;
  distances: { distance: number; prognosis_seconds: number; personal_best: { official_time: number } | null }[];
}
