import { useEffect, useMemo, useRef, useState } from "react";

/** ========= Types ========= */
type PartState = "ok" | "damaged" | "broken";
type Parts = Record<string, PartState>;

type LogTag = "SYSTEM" | "PART" | "DICE" | "SAVE" | "LOAD" | "GM" | "WARN";
type LogEntry = { id: string; ts: number; tag: LogTag; text: string };

type DiceResult = {
  notation: string; // normalized
  rolls: number[];
  sides: number;
  modifier: number;
  total: number;
};

type JudgeKey = "attack" | "dodge" | "search" | "mental" | "action" | "custom1" | "custom2";

type JudgePreset = {
  key: JudgeKey;
  label: string;
  base: string; // ex: "2d6"
  bonus: number; // extra modifier for this judge
};

type CharacterSheet = {
  // Basic
  name: string;
  classRole: string;
  age: string;
  personality: string; // 성격/성향 키워드
  speechStyle: string; // 말투
  likes: string;
  dislikes: string;
  memo: string;

  // Vital
  hpMax: number;
  hpNow: number;
  mpMax: number;
  mpNow: number;

  // Dice
  diceBonus: number; // global base bonus

  // A: Expanded sheet
  skillsText: string; // 스킬/특기 (자유 텍스트)
  bondsText: string; // 유대/관계
  memoriesText: string; // 기억/서사
  equipmentText: string; // 장비/무기/방어구
  inventoryText: string; // 소지품
  materialsText: string; // 제작 재료/자원

  // C: Judge presets
  judgePresets: Record<JudgeKey, JudgePreset>;
};

type GMTable = { id: string; name: string; items: string[] };

type AppState = {
  version: number;
  parts: Parts;
  logs: LogEntry[];
  character: CharacterSheet;
  gmTables: GMTable[];
};

const STORAGE_KEY = "nechronica-tr-state-v2";

/** ========= Helpers ========= */
const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);

const formatTime = (ts: number) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const partLabel = (s: PartState) => (s === "ok" ? "정상" : s === "damaged" ? "손상" : "파괴");

/**
 * Support:
 *  - NdM, dM
 *  - NdM+K, NdM-K
 *  - spaces allowed
 * Examples: 2d6+1 / d10 / 3d6-2
 */
function parseDiceNotation(inputRaw: string): { n: number; m: number; mod: number; norm: string } | null {
  const input = inputRaw.trim().toLowerCase().replace(/\s+/g, "");
  const re = /^(\d*)d(\d+)([+-]\d+)?$/i;
  const m = input.match(re);
  if (!m) return null;

  const nStr = m[1];
  const sidesStr = m[2];
  const modStr = m[3];

  const n = nStr === "" ? 1 : Number(nStr);
  const sides = Number(sidesStr);
  const mod = modStr ? Number(modStr) : 0;

  if (!Number.isFinite(n) || !Number.isFinite(sides) || !Number.isFinite(mod)) return null;
  if (n <= 0 || n > 200) return null;
  if (sides <= 1 || sides > 100000) return null;

  const norm = `${n}d${sides}${mod === 0 ? "" : mod > 0 ? `+${mod}` : `${mod}`}`;
  return { n, m: sides, mod, norm };
}

function rollDice(notation: string): DiceResult | null {
  const parsed = parseDiceNotation(notation);
  if (!parsed) return null;

  const rolls: number[] = [];
  for (let i = 0; i < parsed.n; i++) rolls.push(1 + Math.floor(Math.random() * parsed.m));

  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + parsed.mod;

  return {
    notation: parsed.norm,
    rolls,
    sides: parsed.m,
    modifier: parsed.mod,
    total,
  };
}

function safeJsonParse<T>(s: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    const v = JSON.parse(s) as T;
    return { ok: true, value: v };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "JSON 파싱 실패" };
  }
}

/** ========= Defaults ========= */
const prettyPartsName: Record<string, string> = {
  head: "머리",
  body: "몸통",
  armL: "왼팔",
  armR: "오른팔",
  legL: "왼다리",
  legR: "오른다리",
};

const defaultParts: Parts = {
  head: "ok",
  body: "ok",
  armL: "ok",
  armR: "ok",
  legL: "ok",
  legR: "ok",
};

const defaultJudgePresets = (): Record<JudgeKey, JudgePreset> => ({
  attack: { key: "attack", label: "공격", base: "2d6", bonus: 0 },
  dodge: { key: "dodge", label: "회피", base: "2d6", bonus: 0 },
  search: { key: "search", label: "조사", base: "2d6", bonus: 0 },
  mental: { key: "mental", label: "정신", base: "2d6", bonus: 0 },
  action: { key: "action", label: "행동", base: "2d6", bonus: 0 },
  custom1: { key: "custom1", label: "커스텀1", base: "2d6", bonus: 0 },
  custom2: { key: "custom2", label: "커스텀2", base: "2d6", bonus: 0 },
});

const defaultCharacter = (): CharacterSheet => ({
  name: "",
  classRole: "",
  age: "",
  personality: "",
  speechStyle: "",
  likes: "",
  dislikes: "",
  memo: "",

  hpMax: 10,
  hpNow: 10,
  mpMax: 10,
  mpNow: 10,

  diceBonus: 0,

  skillsText: "",
  bondsText: "",
  memoriesText: "",
  equipmentText: "",
  inventoryText: "",
  materialsText: "",

  judgePresets: defaultJudgePresets(),
});

const defaultGMTables: GMTable[] = [
  {
    id: uid(),
    name: "랜덤 사건(예시)",
    items: ["낯선 소음이 들린다", "연락이 끊긴 동료가 있다", "물자가 부족하다", "기억이 흔들린다", "정체불명의 흔적을 발견했다"],
  },
];

const defaultState = (): AppState => ({
  version: 2,
  parts: { ...defaultParts },
  logs: [{ id: uid(), ts: Date.now(), tag: "SYSTEM", text: "세션 시작" }],
  character: defaultCharacter(),
  gmTables: [...defaultGMTables],
});

/** ========= App ========= */
export default function App() {
  // State
  const [parts, setParts] = useState<Parts>(() => defaultState().parts);
  const [logs, setLogs] = useState<LogEntry[]>(() => defaultState().logs);
  const [character, setCharacter] = useState<CharacterSheet>(() => defaultState().character);
  const [gmTables, setGMTables] = useState<GMTable[]>(() => defaultState().gmTables);

  // Dice (manual)
  const [diceInput, setDiceInput] = useState<string>("2d6+1");
  const [lastRoll, setLastRoll] = useState<DiceResult | null>(null);

  // Save/Load
  const [jsonBox, setJsonBox] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // GM helper
  const [selectedTableId, setSelectedTableId] = useState<string>(() => defaultGMTables[0]?.id ?? "");
  const [gmEditName, setGmEditName] = useState<string>("");
  const [gmEditItems, setGmEditItems] = useState<string>("");
  const [gmPickResult, setGmPickResult] = useState<string>("");

  /** ========= Logging ========= */
  const addLog = (tag: LogTag, text: string) => {
    setLogs((prev) => [{ id: uid(), ts: Date.now(), tag, text }, ...prev]);
  };

  const clearLog = () => {
    setLogs([{ id: uid(), ts: Date.now(), tag: "SYSTEM", text: "로그 초기화" }]);
  };

  /** ========= Parts ========= */
  const togglePart = (key: string) => {
    setParts((prev) => {
      const cur = prev[key] ?? "ok";
      const next: PartState = cur === "ok" ? "damaged" : cur === "damaged" ? "broken" : "ok";
      const nextParts = { ...prev, [key]: next };
      addLog("PART", `${(prettyPartsName as any)[key] ?? key} → ${partLabel(next)}`);
      return nextParts;
    });
  };

  /** ========= Dice ========= */
  const onRollManual = () => {
    const res = rollDice(diceInput);
    if (!res) {
      addLog("WARN", `다이스 표기 오류: "${diceInput}" (예: 2d6+1, d10, 3d6-2)`);
      return;
    }

    // global bonus: 기존 로직은 입력식에 포함된 mod 포함해서 굴림 + 캐릭터 global bonus를 추가 적용
    const bonus = character.diceBonus || 0;
    const patched = bonus === 0 ? res : { ...res, total: res.total + bonus, modifier: res.modifier + bonus };

    setLastRoll(patched);

    const modText = patched.modifier === 0 ? "" : patched.modifier > 0 ? `+${patched.modifier}` : `${patched.modifier}`;
    addLog("DICE", `${res.notation}${bonus !== 0 ? ` (글로벌 ${bonus >= 0 ? `+${bonus}` : bonus})` : ""} → [${res.rolls.join(", ")}] ${modText} = ${patched.total}`);
  };

  // C: judge roll (preset)
  const rollJudge = (key: JudgeKey) => {
    const preset = character.judgePresets[key];
    if (!preset) return;

    const baseParsed = parseDiceNotation(preset.base);
    if (!baseParsed) {
      addLog("WARN", `판정식 오류: ${preset.label}의 base "${preset.base}" (예: 2d6, 1d10, 3d6)`);
      return;
    }

    // base 굴리고, "글로벌 보정 + 판정 보정"을 합산해서 결과에 적용
    const res = rollDice(baseParsed.norm);
    if (!res) {
      addLog("WARN", `판정 굴림 실패: ${preset.label}`);
      return;
    }

    const global = character.diceBonus || 0;
    const local = preset.bonus || 0;
    const totalBonus = global + local;

    const patched = totalBonus === 0 ? res : { ...res, total: res.total + totalBonus, modifier: res.modifier + totalBonus };

    setLastRoll(patched);

    const bonusText =
      totalBonus === 0 ? "" : ` (보정 ${totalBonus >= 0 ? `+${totalBonus}` : totalBonus} = 글로벌 ${global >= 0 ? `+${global}` : global} + ${preset.label} ${local >= 0 ? `+${local}` : local})`;

    const modText = patched.modifier === 0 ? "" : patched.modifier > 0 ? `+${patched.modifier}` : `${patched.modifier}`;

    addLog("DICE", `[판정] ${preset.label}: ${res.notation}${bonusText} → [${res.rolls.join(", ")}] ${modText} = ${patched.total}`);
  };

  /** ========= Save/Load ========= */
  const buildState = (): AppState => ({
    version: 2,
    parts,
    logs,
    character,
    gmTables,
  });

  const applyState = (st: AppState) => {
    if (!st || typeof st !== "object") throw new Error("상태가 올바르지 않습니다.");

    setParts(st.parts ?? defaultParts);
    setLogs(st.logs ?? []);
    setCharacter(() => {
      // 구버전 대응 (judgePresets 없을 수 있음)
      const c = (st as any).character ?? defaultCharacter();
      return {
        ...defaultCharacter(),
        ...c,
        judgePresets: {
          ...defaultJudgePresets(),
          ...(c?.judgePresets ?? {}),
        },
      };
    });
    setGMTables(st.gmTables ?? defaultGMTables);
  };

  const exportJson = () => {
    const st = buildState();
    setJsonBox(JSON.stringify(st, null, 2));
    addLog("SAVE", "JSON 내보내기 완료");
  };

  const importJson = () => {
    const parsed = safeJsonParse<AppState>(jsonBox);
    if (!parsed.ok) {
      addLog("WARN", `JSON 불러오기 실패: ${parsed.error}`);
      return;
    }
    try {
      applyState(parsed.value);
      addLog("LOAD", "JSON 불러오기 완료");
    } catch (e: any) {
      addLog("WARN", `상태 적용 실패: ${e?.message ?? "알 수 없음"}`);
    }
  };

  const downloadJsonFile = () => {
    const st = buildState();
    const text = JSON.stringify(st, null, 2);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `nechronica-tr-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
    addLog("SAVE", "JSON 파일 다운로드");
  };

  const uploadJsonFile = async (file: File) => {
    const text = await file.text();
    setJsonBox(text);

    const parsed = safeJsonParse<AppState>(text);
    if (!parsed.ok) {
      addLog("WARN", `파일 JSON 파싱 실패: ${parsed.error}`);
      return;
    }
    try {
      applyState(parsed.value);
      addLog("LOAD", "JSON 파일 불러오기 완료");
    } catch (e: any) {
      addLog("WARN", `파일 상태 적용 실패: ${e?.message ?? "알 수 없음"}`);
    }
  };

  const resetAll = () => {
    const st = defaultState();
    setParts(st.parts);
    setLogs(st.logs);
    setCharacter(st.character);
    setGMTables(st.gmTables);
    setDiceInput("2d6+1");
    setLastRoll(null);
    setJsonBox("");
    addLog("SYSTEM", "전체 초기화");
  };

  /** ========= LocalStorage Auto Save ========= */
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = safeJsonParse<AppState>(raw);
    if (!parsed.ok) return;

    try {
      applyState(parsed.value);
      setLogs((prev) => [{ id: uid(), ts: Date.now(), tag: "LOAD", text: "자동 저장(localStorage) 복원" }, ...prev]);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildState()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, logs, character, gmTables]);

  /** ========= Derived ========= */
  const partsSummary = useMemo(() => {
    const broken = Object.entries(parts)
      .filter(([, s]) => s === "broken")
      .map(([k]) => (prettyPartsName as any)[k] ?? k);
    const damaged = Object.entries(parts)
      .filter(([, s]) => s === "damaged")
      .map(([k]) => (prettyPartsName as any)[k] ?? k);

    return { broken, damaged, logCount: logs.length };
  }, [parts, logs.length]);

  const selectedTable = useMemo(() => gmTables.find((t) => t.id === selectedTableId) ?? null, [gmTables, selectedTableId]);

  /** ========= GM ========= */
  const pickOne = (items: string[]) => items[Math.floor(Math.random() * items.length)];

  const gmRollTable = () => {
    if (!selectedTable) {
      setGmPickResult("");
      addLog("WARN", "GM: 선택된 랜덤 표가 없음");
      return;
    }
    if (selectedTable.items.length === 0) {
      setGmPickResult("");
      addLog("WARN", `GM: "${selectedTable.name}" 표에 항목이 없음`);
      return;
    }
    const picked = pickOne(selectedTable.items);
    setGmPickResult(picked);
    addLog("GM", `표 "${selectedTable.name}" → ${picked}`);
  };

  const gmSaveFromEditor = () => {
    const name = gmEditName.trim();
    const items = gmEditItems
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!name) {
      addLog("WARN", "GM: 표 이름이 비어있음");
      return;
    }

    setGMTables((prev) => {
      if (selectedTable) {
        addLog("GM", `표 수정: "${name}" (항목 ${items.length}개)`);
        return prev.map((t) => (t.id === selectedTable.id ? { ...t, name, items } : t));
      } else {
        const newT: GMTable = { id: uid(), name, items };
        addLog("GM", `표 추가: "${name}" (항목 ${items.length}개)`);
        return [newT, ...prev];
      }
    });
  };

  const gmAddNewTable = () => {
    const newT: GMTable = { id: uid(), name: "새 표", items: [] };
    setGMTables((prev) => [newT, ...prev]);
    setSelectedTableId(newT.id);
    setGmEditName(newT.name);
    setGmEditItems("");
    addLog("GM", "새 랜덤 표 생성");
  };

  const gmDeleteTable = () => {
    if (!selectedTable) return;
    const name = selectedTable.name;
    setGMTables((prev) => prev.filter((t) => t.id !== selectedTable.id));
    setSelectedTableId("");
    setGmEditName("");
    setGmEditItems("");
    setGmPickResult("");
    addLog("GM", `표 삭제: "${name}"`);
  };

  /** ========= Render ========= */
  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="title">네크로니카 TR 시트</div>
        <div className="subTitle">캐릭터 / 파츠 / 판정 / 다이스 / 로그 / 세이브 / GM 보조</div>
      </div>

      {/* Character Sheet */}
      <div className="panel wFull">
        <div className="panelHeader">
          <div className="panelTitle">🧟 캐릭터 시트</div>
          <div className="panelActions">
            <button className="btn btnDanger" onClick={resetAll} title="전체 초기화">
              전체 초기화
            </button>
          </div>
        </div>

        {/* Basic grid */}
        <div className="grid2">
          <div className="field">
            <label>이름</label>
            <input className="input" value={character.name} onChange={(e) => setCharacter((p) => ({ ...p, name: e.target.value }))} />
          </div>

          <div className="field">
            <label>클래스 / 포지션</label>
            <input className="input" value={character.classRole} onChange={(e) => setCharacter((p) => ({ ...p, classRole: e.target.value }))} placeholder="예: 탱커 / 스카우트" />
          </div>

          <div className="field">
            <label>나이</label>
            <input className="input" value={character.age} onChange={(e) => setCharacter((p) => ({ ...p, age: e.target.value }))} placeholder="예: 17" />
          </div>

          <div className="field">
            <label>글로벌 보정치(다이스)</label>
            <input className="input" type="number" value={character.diceBonus} onChange={(e) => setCharacter((p) => ({ ...p, diceBonus: Number(e.target.value || 0) }))} />
          </div>

          <div className="field">
            <label>성격/성향(키워드)</label>
            <input className="input" value={character.personality} onChange={(e) => setCharacter((p) => ({ ...p, personality: e.target.value }))} placeholder="예: 냉담, 집착, 보호본능, 무기력..." />
          </div>

          <div className="field">
            <label>말투</label>
            <input className="input" value={character.speechStyle} onChange={(e) => setCharacter((p) => ({ ...p, speechStyle: e.target.value }))} placeholder="예: 슴다체 / 반말 / 존댓말..." />
          </div>

          <div className="field">
            <label>좋아하는 것</label>
            <input className="input" value={character.likes} onChange={(e) => setCharacter((p) => ({ ...p, likes: e.target.value }))} />
          </div>

          <div className="field">
            <label>싫어하는 것</label>
            <input className="input" value={character.dislikes} onChange={(e) => setCharacter((p) => ({ ...p, dislikes: e.target.value }))} />
          </div>

          <div className="field">
            <label>HP (현재 / 최대)</label>
            <div className="rowInline">
              <input
                className="input"
                type="number"
                value={character.hpNow}
                onChange={(e) =>
                  setCharacter((p) => {
                    const hpNow = clamp(Number(e.target.value || 0), 0, p.hpMax);
                    return { ...p, hpNow };
                  })
                }
              />
              <span className="sep">/</span>
              <input
                className="input"
                type="number"
                value={character.hpMax}
                onChange={(e) =>
                  setCharacter((p) => {
                    const hpMax = Math.max(1, Number(e.target.value || 1));
                    const hpNow = clamp(p.hpNow, 0, hpMax);
                    return { ...p, hpMax, hpNow };
                  })
                }
              />
            </div>
          </div>

          <div className="field">
            <label>정신력 (현재 / 최대)</label>
            <div className="rowInline">
              <input
                className="input"
                type="number"
                value={character.mpNow}
                onChange={(e) =>
                  setCharacter((p) => {
                    const mpNow = clamp(Number(e.target.value || 0), 0, p.mpMax);
                    return { ...p, mpNow };
                  })
                }
              />
              <span className="sep">/</span>
              <input
                className="input"
                type="number"
                value={character.mpMax}
                onChange={(e) =>
                  setCharacter((p) => {
                    const mpMax = Math.max(1, Number(e.target.value || 1));
                    const mpNow = clamp(p.mpNow, 0, mpMax);
                    return { ...p, mpMax, mpNow };
                  })
                }
              />
            </div>
          </div>

          <div className="field span2">
            <label>자유 메모</label>
            <textarea className="textarea" rows={3} value={character.memo} onChange={(e) => setCharacter((p) => ({ ...p, memo: e.target.value }))} />
          </div>
        </div>

        {/* A: Expanded blocks */}
        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="field span2">
            <label>스킬 / 특기</label>
            <textarea className="textarea" rows={3} value={character.skillsText} onChange={(e) => setCharacter((p) => ({ ...p, skillsText: e.target.value }))} placeholder={"예)\n- 특기: 해킹\n- 스킬: 관찰 +1"} />
          </div>

          <div className="field span2">
            <label>유대 / 관계</label>
            <textarea className="textarea" rows={3} value={character.bondsText} onChange={(e) => setCharacter((p) => ({ ...p, bondsText: e.target.value }))} placeholder={"예)\n베스: 불편하지만 의존\n레나: 경계/신뢰 사이"} />
          </div>

          <div className="field span2">
            <label>기억 / 서사</label>
            <textarea className="textarea" rows={3} value={character.memoriesText} onChange={(e) => setCharacter((p) => ({ ...p, memoriesText: e.target.value }))} placeholder={"예)\n- 잃어버린 연구 기록\n- 과거 실험체와의 사건"} />
          </div>

          <div className="field">
            <label>장비 / 무기 / 방어구</label>
            <textarea className="textarea" rows={4} value={character.equipmentText} onChange={(e) => setCharacter((p) => ({ ...p, equipmentText: e.target.value }))} />
          </div>

          <div className="field">
            <label>소지품</label>
            <textarea className="textarea" rows={4} value={character.inventoryText} onChange={(e) => setCharacter((p) => ({ ...p, inventoryText: e.target.value }))} />
          </div>

          <div className="field span2">
            <label>제작 재료 / 자원</label>
            <textarea className="textarea" rows={3} value={character.materialsText} onChange={(e) => setCharacter((p) => ({ ...p, materialsText: e.target.value }))} placeholder={"예)\n- 금속 조각 x3\n- 약품 샘플 x1"} />
          </div>
        </div>

        <div className="hint">
          자동 저장: 브라우저 재접속해도 유지(localStorage). 공유/백업은 JSON 내보내기 사용.
        </div>
      </div>

      {/* Parts */}
      <div className="panel wFull">
        <div className="panelHeader">
          <div className="panelTitle">🧩 파츠</div>
          <div className="panelActions">
            <div className="miniStat">
              손상 {partsSummary.damaged.length} / 파괴 {partsSummary.broken.length} / 로그 {partsSummary.logCount}
            </div>
          </div>
        </div>

        <div className="partsRow">
          {Object.entries(parts).map(([key, state]) => (
            <button key={key} onClick={() => togglePart(key)} className={`partBtn part-${state}`} title="클릭하면 정상 → 손상 → 파괴 순환">
              {(prettyPartsName as any)[key] ?? key} : {partLabel(state)}
            </button>
          ))}
        </div>

        <div className="hint">파츠 클릭/판정/다이스/세이브/GM 이벤트가 로그에 자동 기록됨.</div>
      </div>

      {/* C: Judge Panel + Manual Dice */}
      <div className="rowWrap">
        <div className="panel w520">
          <div className="panelHeader">
            <div className="panelTitle">🎯 판정</div>
            <div className="panelActions">
              <div className="miniStat">글로벌 {character.diceBonus >= 0 ? `+${character.diceBonus}` : character.diceBonus}</div>
            </div>
          </div>

          {/* Buttons */}
          <div className="judgeBtns">
            {(
              [
                ["attack", "attack"],
                ["dodge", "dodge"],
                ["search", "search"],
                ["mental", "mental"],
                ["action", "action"],
                ["custom1", "custom1"],
                ["custom2", "custom2"],
              ] as Array<[string, JudgeKey]>
            ).map(([_, key]) => (
              <button key={key} className="btn btnAccent" onClick={() => rollJudge(key)} title={`${character.judgePresets[key].base} + (글로벌 + 판정 보정) 굴림`}>
                {character.judgePresets[key].label} 굴리기
              </button>
            ))}
          </div>

          {/* Preset editor */}
          <div className="judgeEditor">
            <div className="hint" style={{ marginBottom: 8 }}>
              아래에서 판정 버튼의 <b>이름/기본식/보정</b>을 설정할 수 있어. 기본식은 <b>2d6</b> 같은 형태만(±는 보정칸에서).
            </div>

            {(
              [
                ["attack", "attack"],
                ["dodge", "dodge"],
                ["search", "search"],
                ["mental", "mental"],
                ["action", "action"],
                ["custom1", "custom1"],
                ["custom2", "custom2"],
              ] as Array<[string, JudgeKey]>
            ).map(([_, key]) => {
              const p = character.judgePresets[key];
              return (
                <div key={key} className="judgeRow">
                  <input
                    className="input"
                    value={p.label}
                    onChange={(e) =>
                      setCharacter((c) => ({
                        ...c,
                        judgePresets: {
                          ...c.judgePresets,
                          [key]: { ...c.judgePresets[key], label: e.target.value },
                        },
                      }))
                    }
                    placeholder="라벨"
                    title="버튼 이름"
                  />
                  <input
                    className="input"
                    value={p.base}
                    onChange={(e) =>
                      setCharacter((c) => ({
                        ...c,
                        judgePresets: {
                          ...c.judgePresets,
                          [key]: { ...c.judgePresets[key], base: e.target.value },
                        },
                      }))
                    }
                    placeholder="기본식(예: 2d6)"
                    title="기본식: 2d6, 1d10, 3d6 등"
                  />
                  <input
                    className="input"
                    type="number"
                    value={p.bonus}
                    onChange={(e) =>
                      setCharacter((c) => ({
                        ...c,
                        judgePresets: {
                          ...c.judgePresets,
                          [key]: { ...c.judgePresets[key], bonus: Number(e.target.value || 0) },
                        },
                      }))
                    }
                    title="판정 보정치"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel w520">
          <div className="panelHeader">
            <div className="panelTitle">🎲 다이스(직접)</div>
            <div className="panelActions">
              <div className="miniStat">글로벌 {character.diceBonus >= 0 ? `+${character.diceBonus}` : character.diceBonus}</div>
            </div>
          </div>

          <div className="rowInline">
            <input className="input" value={diceInput} onChange={(e) => setDiceInput(e.target.value)} placeholder="예: 2d6+1 / d10 / 3d6-2" />
            <button className="btn" onClick={onRollManual}>
              굴리기
            </button>
          </div>

          <div className="hint">직접 굴림은 입력식의 ±를 그대로 사용하고, 결과에 글로벌 보정이 추가로 적용됨.</div>

          <div className="diceResult">
            <div className="diceLineTitle">마지막 결과</div>
            <div className="diceLine">
              {lastRoll
                ? `${lastRoll.notation} → [${lastRoll.rolls.join(", ")}] ${
                    lastRoll.modifier === 0 ? "" : lastRoll.modifier > 0 ? `+${lastRoll.modifier}` : `${lastRoll.modifier}`
                  } = ${lastRoll.total}`
                : "없음"}
            </div>
          </div>
        </div>
      </div>

      {/* Log */}
      <div className="panel wFull">
        <div className="panelHeader">
          <div className="panelTitle">📝 로그</div>
          <button onClick={clearLog} className="btn btnDanger" title="로그 초기화">
            초기화
          </button>
        </div>

        <div className="logBox">
          {logs.map((e) => (
            <div key={e.id} className="logRow">
              <div className="logTime">{formatTime(e.ts)}</div>
              <div className={`logTag tag-${e.tag.toLowerCase()}`}>{e.tag}</div>
              <div className="logText">{e.text}</div>
            </div>
          ))}
        </div>

        <div className="hint">최신 로그가 위에 쌓여.</div>
      </div>

      {/* Save / Load */}
      <div className="panel wFull">
        <div className="panelHeader">
          <div className="panelTitle">💾 세이브 / 로드</div>
          <div className="panelActions">
            <button className="btn" onClick={exportJson}>
              JSON 내보내기
            </button>
            <button className="btn" onClick={importJson}>
              JSON 불러오기
            </button>
            <button className="btn" onClick={downloadJsonFile} title="파일로 저장">
              파일 저장
            </button>
            <button className="btn" onClick={() => fileInputRef.current?.click()} title="파일에서 불러오기">
              파일 불러오기
            </button>
            <button className="btn btnDanger" onClick={resetAll}>
              전체 초기화
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadJsonFile(f);
                e.currentTarget.value = "";
              }}
            />
          </div>
        </div>

        <textarea
          className="textarea"
          rows={6}
          value={jsonBox}
          onChange={(e) => setJsonBox(e.target.value)}
          placeholder="내보내기 누르면 여기에 JSON이 생김. 복사/공유용. 불러오기는 여기 JSON을 붙여넣고 'JSON 불러오기' 버튼."
        />

        <div className="hint">
          자동 저장(localStorage)은 브라우저 내부용. 친구 공유/백업은 <b>JSON 내보내기</b> 또는 <b>파일 저장</b> 추천.
        </div>
      </div>

      {/* GM Helper */}
      <div className="panel wFull">
        <div className="panelHeader">
          <div className="panelTitle">🎛 GM 보조</div>
          <div className="panelActions">
            <button className="btn" onClick={gmAddNewTable}>
              표 추가
            </button>
            <button className="btn" onClick={() => selectedTable && (setGmEditName(selectedTable.name), setGmEditItems(selectedTable.items.join("\n")), addLog("GM", `표 편집 로드: "${selectedTable.name}"`))} disabled={!selectedTable}>
              편집 로드
            </button>
            <button className="btn btnAccent" onClick={gmSaveFromEditor}>
              편집 저장
            </button>
            <button className="btn btnDanger" onClick={gmDeleteTable} disabled={!selectedTable}>
              표 삭제
            </button>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label>랜덤 표 선택</label>
            <select className="input" value={selectedTableId} onChange={(e) => setSelectedTableId(e.target.value)}>
              <option value="">(선택 안 함)</option>
              {gmTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.items.length})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>표 굴리기</label>
            <div className="rowInline">
              <button className="btn btnAccent" onClick={gmRollTable} disabled={!selectedTable}>
                표 굴리기
              </button>
              <button className="btn" onClick={() => setGmPickResult("")}>
                결과 지우기
              </button>
            </div>
          </div>

          <div className="field span2">
            <label>결과</label>
            <div className="gmResult">{gmPickResult || "없음"}</div>
          </div>

          <div className="field">
            <label>표 이름(편집)</label>
            <input className="input" value={gmEditName} onChange={(e) => setGmEditName(e.target.value)} placeholder="예: 랜덤 사건" />
          </div>

          <div className="field span2">
            <label>표 항목(줄바꿈으로 1개씩)</label>
            <textarea className="textarea" rows={5} value={gmEditItems} onChange={(e) => setGmEditItems(e.target.value)} placeholder={"항목1\n항목2\n항목3"} />
          </div>
        </div>

        <div className="hint">표 선택 → (편집 로드) → 수정 → 편집 저장. 표 굴리기 결과는 로그에 자동 기록됨.</div>
      </div>

      <div className="footerHint">
        수정 후 <b>Commit → Push</b> 하면 Vercel이 자동 재배포돼(링크 그대로).
      </div>
    </div>
  );
}
