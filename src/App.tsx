import { useEffect, useMemo, useRef, useState } from "react";

/* =====================
   Types
===================== */
type PartState = "ok" | "damaged" | "broken";

type DiceRollResult = {
  notation: string;
  rolls: number[];
  sides: number;
  modifier: number;
  total: number;
};

type LogEntry = {
  id: string;
  ts: number;
  text: string;
};

type GMTable = {
  id: string;
  name: string;
  items: string[]; // 랜덤 표 항목들
};

type SaveData = {
  version: number;
  parts: Record<string, PartState>;
  diceInput: string;
  lastRoll: DiceRollResult | null;
  log: LogEntry[];

  // GM 보조
  gmNotes: string;
  gmTables: GMTable[];
  gmSelectedTableId: string | null;
};

const SAVE_KEY = "nechronica_tr_save_v2";

/* =====================
   Utils
===================== */
const safeUUID = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCrypto: any = globalThis.crypto;
  return anyCrypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
};

const nextState = (s: PartState): PartState =>
  s === "ok" ? "damaged" : s === "damaged" ? "broken" : "ok";

const partLabel = (s: PartState) => (s === "ok" ? "정상" : s === "damaged" ? "손상" : "파괴");

const formatTime = (ts: number) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

function parseDiceNotation(input: string): { count: number; sides: number; modifier: number } {
  // 지원: NdM, NdM+K, NdM-K (공백 무시)
  const s = input.trim().replace(/\s+/g, "").toLowerCase();
  const m = s.match(/^(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?$/i);
  if (!m) throw new Error("형식 예: 2d6+1 / 1d10 / 3d6-2");

  const count = Number(m[1]);
  const sides = Number(m[2]);
  const modifier = m[3] ? Number(m[3].replace(/\s+/g, "")) : 0;

  if (!Number.isFinite(count) || !Number.isFinite(sides) || !Number.isFinite(modifier)) {
    throw new Error("숫자를 읽을 수 없어.");
  }
  if (count < 1 || count > 100) throw new Error("주사위 개수는 1~100까지만.");
  if (sides < 2 || sides > 1000) throw new Error("면수는 2~1000까지만.");

  return { count, sides, modifier };
}

function rollDice(count: number, sides: number, modifier: number, notation: string): DiceRollResult {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + modifier;
  return { notation, rolls, sides, modifier, total };
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* =====================
   Log Tagging
===================== */
function tagOf(text: string): { name: string; cls: string } {
  if (text.startsWith("다이스:")) return { name: "DICE", cls: "tag-dice" };
  if (text.startsWith("파츠 변경:")) return { name: "PART", cls: "tag-part" };
  if (text.includes("세이브") || text.includes("불러오기") || text.includes("내보내기") || text.includes("로드"))
    return { name: "SAVE", cls: "tag-save" };
  if (text.startsWith("⚠️") || text.startsWith("❌")) return { name: "WARN", cls: "tag-warn" };
  if (text.startsWith("GM:")) return { name: "GM", cls: "tag-gm" };
  return { name: "LOG", cls: "tag-log" };
}

/* =====================
   App
===================== */
export default function App() {
  const prettyPartsName = useMemo(
    () => ({
      head: "머리",
      body: "몸통",
      armL: "왼팔",
      armR: "오른팔",
      legL: "왼다리",
      legR: "오른다리",
    }),
    []
  );

  const defaultParts: Record<string, PartState> = {
    head: "ok",
    body: "ok",
    armL: "ok",
    armR: "ok",
    legL: "ok",
    legR: "ok",
  };

  const defaultLog: LogEntry[] = [{ id: safeUUID(), ts: Date.now(), text: "세션 시작" }];

  const defaultTables: GMTable[] = [
    {
      id: safeUUID(),
      name: "훅(상황)",
      items: ["정전", "경보", "실종", "배신", "감염", "봉인 해제", "누군가의 비명", "낯선 전파", "혈흔", "검문"],
    },
    {
      id: safeUUID(),
      name: "장소",
      items: ["폐병원", "지하철 터널", "잿빛 주거구", "붕괴된 연구동", "수몰된 거리", "격리 구역", "정비소", "컨테이너 야적장"],
    },
    {
      id: safeUUID(),
      name: "대가(대신 잃는 것)",
      items: ["시간", "기억의 조각", "신뢰", "파츠", "안전", "비밀", "동료의 체력", "도망칠 기회"],
    },
  ];

  // ----- state
  const [parts, setParts] = useState<Record<string, PartState>>(defaultParts);
  const [diceInput, setDiceInput] = useState("2d6+1");
  const [diceError, setDiceError] = useState<string | null>(null);
  const [lastRoll, setLastRoll] = useState<DiceRollResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>(defaultLog);

  // Save/Load UI
  const [saveText, setSaveText] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // GM Assist v1
  const [gmNotes, setGmNotes] = useState("");
  const [gmTables, setGmTables] = useState<GMTable[]>(defaultTables);
  const [gmSelectedTableId, setGmSelectedTableId] = useState<string | null>(defaultTables[0]?.id ?? null);
  const [gmEditName, setGmEditName] = useState("");
  const [gmEditItems, setGmEditItems] = useState("");
  const [gmLastRoll, setGmLastRoll] = useState<string | null>(null);
  const [gmHook, setGmHook] = useState<string | null>(null);

  // 로그 자동 스크롤
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = logBoxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log.length]);

  // ----- log helper
  const addLog = (text: string) => {
    const entry: LogEntry = { id: safeUUID(), ts: Date.now(), text };
    setLog((prev) => [...prev, entry]); // 최신이 아래
  };

  const clearLog = () => {
    setLog([{ id: safeUUID(), ts: Date.now(), text: "세션 시작" }]);
    setSaveMsg("🧹 로그 초기화됨");
    setTimeout(() => setSaveMsg(null), 1600);
  };

  // ----- parts
  const togglePart = (key: string) => {
    setParts((prev) => {
      const before = prev[key];
      const after = nextState(before);
      const name = (prettyPartsName as any)[key] ?? key;
      addLog(`파츠 변경: ${name} ${partLabel(before)} → ${partLabel(after)}`);
      return { ...prev, [key]: after };
    });
  };

  // ----- dice
  const onRoll = () => {
    try {
      setDiceError(null);
      const parsed = parseDiceNotation(diceInput);
      const res = rollDice(parsed.count, parsed.sides, parsed.modifier, diceInput.trim());
      setLastRoll(res);

      const modText = res.modifier === 0 ? "" : ` ${res.modifier > 0 ? "+" : ""}${res.modifier}`;
      addLog(`다이스: ${res.notation} = [${res.rolls.join(", ")}]${modText} → ${res.total}`);
    } catch (e: any) {
      setLastRoll(null);
      const msg = e?.message ?? "다이스 입력을 확인해줘.";
      setDiceError(msg);
      addLog(`⚠️ 다이스 실패: ${diceInput.trim() || "(빈 값)"} (${msg})`);
    }
  };

  // ----- GM helpers
  const selectedTable = useMemo(
    () => gmTables.find((t) => t.id === gmSelectedTableId) ?? null,
    [gmTables, gmSelectedTableId]
  );

  const gmSummary = useMemo(() => {
    const broken = Object.entries(parts)
      .filter(([, s]) => s === "broken")
      .map(([k]) => (prettyPartsName as any)[k] ?? k);
    const damaged = Object.entries(parts)
      .filter(([, s]) => s === "damaged")
      .map(([k]) => (prettyPartsName as any)[k] ?? k);

    const diceLine = lastRoll
      ? `${lastRoll.notation} → ${lastRoll.total} ([${
          lastRoll.rolls.join(", ")
        }]${lastRoll.modifier ? `, 보정 ${lastRoll.modifier > 0 ? "+" : ""}${lastRoll.modifier}` : ""})`
      : "없음";

    return {
      parts: {
        broken,
        damaged,
      },
      diceLine,
      logCount: log.length,
    };
  }, [parts, prettyPartsName, lastRoll, log.length]);

  const gmRollTable = () => {
    if (!selectedTable) {
      setGmLastRoll(null);
      addLog("⚠️ GM: 선택된 랜덤 표가 없어.");
      return;
    }
    if (!selectedTable.items.length) {
      setGmLastRoll(null);
      addLog(`⚠️ GM: '${selectedTable.name}' 표에 항목이 없어.`);
      return;
    }
    const picked = pickOne(selectedTable.items);
    const res = `GM 표 '${selectedTable.name}' → ${picked}`;
    setGmLastRoll(res);
    addLog(`GM: ${res}`);
  };

  const gmAddOrUpdateTable = () => {
    const name = gmEditName.trim();
    const items = parseLines(gmEditItems);
    if (!name) {
      addLog("⚠️ GM: 표 이름이 비어있어.");
      return;
    }
    if (!items.length) {
      addLog("⚠️ GM: 표 항목이 비어있어.");
      return;
    }

    // 같은 이름이 있으면 업데이트, 없으면 새로 추가
    setGmTables((prev) => {
      const existing = prev.find((t) => t.name === name);
      if (existing) {
        const next = prev.map((t) => (t.id === existing.id ? { ...t, items } : t));
        setGmSelectedTableId(existing.id);
        addLog(`GM: 표 업데이트 '${name}' (${items.length}항목)`);
        return next;
      }
      const newTable: GMTable = { id: safeUUID(), name, items };
      const next = [...prev, newTable];
      setGmSelectedTableId(newTable.id);
      addLog(`GM: 표 추가 '${name}' (${items.length}항목)`);
      return next;
    });

    setGmEditName("");
    setGmEditItems("");
  };

  const gmLoadSelectedToEditor = () => {
    if (!selectedTable) return;
    setGmEditName(selectedTable.name);
    setGmEditItems(selectedTable.items.join("\n"));
    addLog(`GM: 편집 로드 '${selectedTable.name}'`);
  };

  const gmDeleteSelected = () => {
    if (!selectedTable) return;
    const delId = selectedTable.id;
    const delName = selectedTable.name;

    setGmTables((prev) => prev.filter((t) => t.id !== delId));
    setGmSelectedTableId((prevId) => (prevId === delId ? null : prevId));
    addLog(`GM: 표 삭제 '${delName}'`);
  };

  const gmMakeHook = () => {
    // 룰 기반(AI 없이) 훅 생성
    const hookA = pickOne(["경보가 울린다", "누군가 실종됐다", "격리 구역이 열렸다", "외부 신호가 잡힌다", "보급이 끊겼다", "감염 의심자가 나온다"]);
    const hookB = pickOne(["폐병원", "붕괴된 연구동", "지하 터널", "정비소", "잿빛 주거구", "격리 구역"]);
    const hookC = pickOne(["정부", "사이비", "사냥꾼", "동료", "실험체", "연락망"]);
    const hookD = pickOne(["거짓말", "대가", "시간제한", "파츠 손상", "기억 손실", "배신"]);

    const line = `${hookB}에서 ${hookA}. ${hookC} 쪽이 얽혀 있고, 해결의 대가로 ${hookD}(이)가 걸린다.`;
    setGmHook(line);
    addLog(`GM: 훅 생성 → ${line}`);
  };

  // ----- save/restore
  const makeSaveData = (): SaveData => ({
    version: 2,
    parts,
    diceInput,
    lastRoll,
    log,
    gmNotes,
    gmTables,
    gmSelectedTableId,
  });

  const applySaveData = (data: SaveData) => {
    if (!data) throw new Error("세이브 데이터가 없어.");
    if (data.version !== 2) throw new Error("지원하지 않는 세이브 버전이야(버전 불일치).");

    setParts(data.parts ?? defaultParts);
    setDiceInput(data.diceInput ?? "2d6+1");
    setLastRoll(data.lastRoll ?? null);
    setLog(Array.isArray(data.log) ? data.log : defaultLog);

    setGmNotes(data.gmNotes ?? "");
    setGmTables(Array.isArray(data.gmTables) && data.gmTables.length ? data.gmTables : defaultTables);
    setGmSelectedTableId(data.gmSelectedTableId ?? (defaultTables[0]?.id ?? null));
  };

  // 자동 로드 (처음 1회)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SaveData;
      applySaveData(parsed);
      setSaveMsg("✅ 자동 로드됨");
      setTimeout(() => setSaveMsg(null), 1600);
    } catch {
      setSaveMsg("⚠️ 자동 로드 실패(세이브가 깨졌을 수 있어).");
      setTimeout(() => setSaveMsg(null), 2200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 자동 저장
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(makeSaveData()));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, diceInput, lastRoll, log, gmNotes, gmTables, gmSelectedTableId]);

  // JSON 내보내기
  const exportSaveText = () => {
    const text = JSON.stringify(makeSaveData(), null, 2);
    setSaveText(text);
    setSaveMsg("✅ 내보내기 완료: 아래 JSON을 복사해 백업해둬.");
    setTimeout(() => setSaveMsg(null), 2500);
    addLog("세이브 내보내기(JSON)");
  };

  // JSON 불러오기
  const importSaveText = () => {
    try {
      const parsed = JSON.parse(saveText) as SaveData;
      applySaveData(parsed);
      localStorage.setItem(SAVE_KEY, JSON.stringify(parsed));
      setSaveMsg("✅ 불러오기 완료!");
      setTimeout(() => setSaveMsg(null), 1800);
      addLog("세이브 불러오기(JSON)");
    } catch (e: any) {
      setSaveMsg(`❌ 불러오기 실패: ${e?.message ?? "JSON이 올바른지 확인해줘."}`);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  // 전체 초기화 (상태/로그/저장 삭제)
  const resetAll = () => {
    setParts(defaultParts);
    setDiceInput("2d6+1");
    setLastRoll(null);
    setDiceError(null);
    setLog([{ id: safeUUID(), ts: Date.now(), text: "세션 시작" }]);

    setGmNotes("");
    setGmTables(defaultTables);
    setGmSelectedTableId(defaultTables[0]?.id ?? null);
    setGmEditName("");
    setGmEditItems("");
    setGmLastRoll(null);
    setGmHook(null);

    setSaveText("");
    localStorage.removeItem(SAVE_KEY);
    setSaveMsg("🧼 전체 초기화 완료(자동 세이브 삭제됨)");
    setTimeout(() => setSaveMsg(null), 2500);
  };

  /* =====================
     UI
===================== */
  return (
    <div className="app">
      {/* title */}
      <div className="titlebar">
        <div>
          <h1 className="h1">네크로니카 TR 시트</h1>
          <p className="sub">파츠 / 다이스 / 로그 / 세이브 + GM 보조</p>
        </div>
        <span className="badge">v2</span>
      </div>

      {/* parts */}
      <div className="panel wFull">
        <div className="panelHeader">
          <div className="panelTitle">🧩 파츠</div>
          <span className="badge">정상 → 손상 → 파괴</span>
        </div>

        <div className="partsRow">
          {Object.entries(parts).map(([key, state]) => (
            <button
              key={key}
              onClick={() => togglePart(key)}
              className={`partBtn part-${state}`}
              title="클릭하면 정상→손상→파괴 순환"
            >
              {(prettyPartsName as any)[key] ?? key} : {partLabel(state)}
            </button>
          ))}
        </div>

        <div className="hint">클릭으로 파츠 상태를 관리해.</div>
      </div>

      {/* main two panels */}
      <div className="twoCol">
        {/* dice */}
        <div className="panel w520">
          <div className="panelHeader">
            <div className="panelTitle">🎲 다이스</div>
            <span className="badge">NdM ± K</span>
          </div>

          <div className="grid">
            <input
              className="input"
              value={diceInput}
              onChange={(e) => setDiceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRoll();
              }}
              placeholder="예: 2d6+1"
            />
            <button onClick={onRoll} className="btn btnAccent">
              굴리기
            </button>
          </div>

          <div className="hint">
            지원: <b>NdM</b>, <b>NdM+K</b>, <b>NdM-K</b>
          </div>

          {diceError && <div className="msg msgErr">{diceError}</div>}

          {lastRoll && (
            <div className="panel" style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 900 }}>
                결과: {lastRoll.notation} → <span style={{ fontSize: 18 }}>{lastRoll.total}</span>
              </div>
              <div className="hint">
                굴림: [{lastRoll.rolls.join(", ")}] (d{lastRoll.sides})
                {lastRoll.modifier !== 0
                  ? ` / 보정: ${lastRoll.modifier > 0 ? "+" : ""}${lastRoll.modifier}`
                  : ""}
              </div>
            </div>
          )}
        </div>

        {/* log */}
        <div className="panel w520">
          <div className="panelHeader">
            <div className="panelTitle">📝 로그</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={clearLog} className="btn btnDanger" title="로그 초기화">
                로그 초기화
              </button>
              <button onClick={resetAll} className="btn" title="전체 초기화(자동저장 삭제)">
                전체 초기화
              </button>
            </div>
          </div>

          <div className="logBox" ref={logBoxRef}>
            {log.map((e) => {
              const tag = tagOf(e.text);
              return (
                <div key={e.id} className="logRow">
                  <div className="logTime">{formatTime(e.ts)}</div>
                  <span className={`logTag ${tag.cls}`}>{tag.name}</span>
                  <div className="logText">{e.text}</div>
                </div>
              );
            })}
          </div>

          <div className="hint">태그: DICE / PART / SAVE / GM / WARN</div>
        </div>
      </div>

      {/* Save/Load */}
      <div className="panel wFull">
        <div className="panelHeader">
          <div className="panelTitle">💾 세이브 / 로드</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={exportSaveText} className="btn">
              JSON 내보내기
            </button>
            <button onClick={importSaveText} className="btn">
              JSON 불러오기
            </button>
            <button onClick={resetAll} className="btn btnDanger" title="모든 상태 초기화 + 자동저장 삭제">
              전체 초기화
            </button>
          </div>
        </div>

        {saveMsg && (
          <div
            className={
              saveMsg.startsWith("✅")
                ? "msg msgOk"
                : saveMsg.startsWith("⚠️")
                ? "msg msgWarn"
                : saveMsg.startsWith("❌")
                ? "msg msgErr"
                : "msg"
            }
          >
            {saveMsg}
          </div>
        )}

        <textarea
          className="textarea"
          value={saveText}
          onChange={(e) => setSaveText(e.target.value)}
          placeholder="내보내기 누르면 JSON이 생성돼. 백업/공유용으로 복사해두고, 불러오기는 여기에 JSON을 붙여넣은 뒤 버튼 누르기."
        />

        <div className="hint">자동 저장(localStorage): 새로고침해도 유지됨. JSON은 백업/공유용.</div>
      </div>

      {/* GM Assist v1 */}
      <div className="panel wFull">
        <div className="panelHeader">
          <div className="panelTitle">🧠 GM 보조 v1</div>
          <span className="badge">요약 / 씬노트 / 랜덤표 / 훅</span>
        </div>

        {/* Summary */}
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHeader">
            <div className="panelTitle">현재 상태 요약</div>
            <span className="badge">자동</span>
          </div>

          <div className="hint">
            <b>파괴:</b> {gmSummary.parts.broken.length ? gmSummary.parts.broken.join(", ") : "없음"}{" "}
            / <b>손상:</b> {gmSummary.parts.damaged.length ? gmSummary.parts.damaged.join(", ") : "없음"}
          </div>
          <div className="hint">
            <b>마지막 다이스:</b> {gmSummary.diceLine}
          </div>
          <div className="hint">
            <b>로그:</b> {gmSummary.logCount}줄
          </div>
        </div>

        {/* Notes */}
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHeader">
            <div className="panelTitle">씬 노트</div>
            <span className="badge">세이브 포함</span>
          </div>

          <textarea
            className="textarea"
            value={gmNotes}
            onChange={(e) => setGmNotes(e.target.value)}
            placeholder="씬 진행 메모 / NPC 대사 초안 / 복선 / 트리거 등"
          />
          <div className="hint">여기 내용도 자동 저장 + JSON 세이브에 포함돼.</div>
        </div>

        {/* Random Tables */}
        <div className="twoCol">
          <div className="panel w520">
            <div className="panelHeader">
              <div className="panelTitle">🎴 랜덤 표</div>
              <span className="badge">커스텀 가능</span>
            </div>

            <div className="hint" style={{ marginBottom: 8 }}>
              표 선택:
            </div>
            <select
              className="input"
              value={gmSelectedTableId ?? ""}
              onChange={(e) => setGmSelectedTableId(e.target.value || null)}
            >
              <option value="">(선택 없음)</option>
              {gmTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.items.length})
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button className="btn btnAccent" onClick={gmRollTable}>
                표 굴리기
              </button>
              <button className="btn" onClick={gmLoadSelectedToEditor} disabled={!selectedTable}>
                편집기에 불러오기
              </button>
              <button className="btn btnDanger" onClick={gmDeleteSelected} disabled={!selectedTable}>
                선택 표 삭제
              </button>
            </div>

            {gmLastRoll && <div className="msg msgOk">{gmLastRoll}</div>}

            <div className="hint">표 추가/수정은 오른쪽 편집기에서 이름이 같으면 “업데이트”로 처리돼.</div>
          </div>

          {/* Table Editor */}
          <div className="panel w520">
            <div className="panelHeader">
              <div className="panelTitle">✍️ 표 편집기</div>
              <span className="badge">이름 중복=업데이트</span>
            </div>

            <input
              className="input"
              value={gmEditName}
              onChange={(e) => setGmEditName(e.target.value)}
              placeholder="표 이름 (예: 적 등장, 소문, 보상 등)"
            />
            <div style={{ height: 10 }} />
            <textarea
              className="textarea"
              value={gmEditItems}
              onChange={(e) => setGmEditItems(e.target.value)}
              placeholder={`항목을 줄바꿈으로 입력\n예)\n낯선 발자국\n피 묻은 배지\n숨겨진 통로`}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button className="btn btnAccent" onClick={gmAddOrUpdateTable}>
                추가/업데이트
              </button>
              <button className="btn" onClick={() => { setGmEditName(""); setGmEditItems(""); }}>
                편집기 비우기
              </button>
            </div>
          </div>
        </div>

        {/* Hook generator */}
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panelHeader">
            <div className="panelTitle">🪝 훅 생성기</div>
            <span className="badge">룰 기반</span>
          </div>

          <button className="btn btnAccent" onClick={gmMakeHook}>
            훅 만들기
          </button>

          {gmHook && <div className="msg msgOk">{gmHook}</div>}

          <div className="hint">AI 없이도 세션 진행용 “상황+장소+세력+대가”를 자동으로 뽑아줘.</div>
        </div>
      </div>
    </div>
  );
}
