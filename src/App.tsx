import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

type PartState = "ok" | "damaged" | "broken";
type Parts = Record<"head" | "body" | "armL" | "armR" | "legL" | "legR", PartState>;

type LogKind = "SYS" | "PART" | "DICE" | "SAVE" | "SIM";
type LogEntry = { id: string; ts: number; kind: LogKind; text: string };

type NechPosition = "앨리스" | "홀릭" | "오토마톤" | "정크" | "코트" | "솔로리티";
type NechClass =
  | "스테이시"
  | "타나토스"
  | "고딕"
  | "레퀴엠"
  | "바로크"
  | "로마네스크"
  | "사이키델릭";
type Treasure =
  | "사진"
  | "책"
  | "언데드 펫"
  | "부서진 부분"
  | "거울"
  | "인형"
  | "봉제인형"
  | "악세사리"
  | "바구니"
  | "귀여운 옷";

type ReinforceType = "무기류" | "강화 장치" | "돌연변이";

type RelationLevel = "신뢰" | "중립" | "경계" | "적대";

type Character = {
  id: string;
  name: string;
  position: NechPosition;
  clazz: NechClass;
  reinforceType: ReinforceType;
  reinforceDetail: string; // 많으면 자유 작성
  treasure: Treasure;
  treasureCount: number; // 보물 개수(심리 안정용)
  speech: "반말" | "존댓말" | "슴다체" | "무뚝뚝";
  temperament: "냉정" | "다정" | "광기" | "게으름";
  notes: string;

  // 진행용 수치(원하는 만큼만 단순화)
  mentalMod: number; // 광기 판정 보정(-3~+3)
  madness: number; // 0~10 (10이면 붕괴)
};

type SceneType = "탐색" | "전투" | "교섭" | "공포";

type SaveData = {
  version: 1;
  mode: "setup" | "run";
  parts: Parts;
  log: LogEntry[];
  characters: Character[];
  relations: Record<string, RelationLevel>; // key: "a|b" (정렬된 id)
  // dice
  diceNotation: string;
  lastRoll?: { notation: string; rolls: number[]; total: number; mod: number };
  // sim
  sceneType: SceneType;
  checksInScene: number;
};

const LS_KEY = "nechronica-tr-save-v1";

const POSITIONS: NechPosition[] = ["앨리스", "홀릭", "오토마톤", "정크", "코트", "솔로리티"];
const CLASSES: NechClass[] = ["스테이시", "타나토스", "고딕", "레퀴엠", "바로크", "로마네스크", "사이키델릭"];
const TREASURES: Treasure[] = [
  "사진",
  "책",
  "언데드 펫",
  "부서진 부분",
  "거울",
  "인형",
  "봉제인형",
  "악세사리",
  "바구니",
  "귀여운 옷",
];
const REINFORCES: ReinforceType[] = ["무기류", "강화 장치", "돌연변이"];

const prettyPartsName: Record<keyof Parts, string> = {
  head: "머리",
  body: "몸통",
  armL: "왼팔",
  armR: "오른팔",
  legL: "왼다리",
  legR: "오른다리",
};

const partLabel = (s: PartState) => (s === "ok" ? "정상" : s === "damaged" ? "손상" : "파괴");

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// 1d10만 지원(요청대로 통일). notation 예: "1d10+2" / "1d10-1"
function parse1d10(notation: string): { mod: number } | null {
  const s = notation.trim().toLowerCase().replace(/\s+/g, "");
  // allow: 1d10, 1d10+2, 1d10-2
  const m = s.match(/^1d10([+-]\d+)?$/);
  if (!m) return null;
  const mod = m[1] ? Number(m[1]) : 0;
  if (!Number.isFinite(mod)) return null;
  return { mod };
}

function roll1d10(mod: number) {
  const die = Math.floor(Math.random() * 10) + 1; // 1~10
  const total = die + mod;
  return { die, total };
}

function relKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pickOne<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function App() {
  // ----- core state -----
  const [mode, setMode] = useState<"setup" | "run">("setup");

  const [parts, setParts] = useState<Parts>({
    head: "ok",
    body: "ok",
    armL: "ok",
    armR: "ok",
    legL: "ok",
    legR: "ok",
  });

  const [log, setLog] = useState<LogEntry[]>([
    { id: uid(), ts: Date.now(), kind: "SYS", text: "세션 시작" },
  ]);

  const [characters, setCharacters] = useState<Character[]>([
    {
      id: uid(),
      name: "캐릭터 1",
      position: "앨리스",
      clazz: "스테이시",
      reinforceType: "무기류",
      reinforceDetail: "",
      treasure: "인형",
      treasureCount: 2,
      speech: "반말",
      temperament: "냉정",
      notes: "",
      mentalMod: 0,
      madness: 0,
    },
  ]);

  const [relations, setRelations] = useState<Record<string, RelationLevel>>({});

  // ----- dice -----
  const [diceNotation, setDiceNotation] = useState("1d10+0");
  const [lastRoll, setLastRoll] = useState<SaveData["lastRoll"]>(undefined);

  // ----- sim -----
  const [sceneType, setSceneType] = useState<SceneType>("탐색");
  const [checksInScene, setChecksInScene] = useState(3);

  // ----- save/load textarea -----
  const [jsonBox, setJsonBox] = useState("");

  // log scroll
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const addLog = (kind: LogKind, text: string) => {
    setLog((prev) => {
      const next = [...prev, { id: uid(), ts: Date.now(), kind, text }];
      // 너무 길어지면 잘라내기
      const LIMIT = 800;
      return next.length > LIMIT ? next.slice(next.length - LIMIT) : next;
    });
  };

  const togglePart = (key: keyof Parts) => {
    setParts((prev) => {
      const cur = prev[key];
      const next: PartState = cur === "ok" ? "damaged" : cur === "damaged" ? "broken" : "ok";
      const out = { ...prev, [key]: next };
      addLog("PART", `파츠 변경: ${prettyPartsName[key]} → ${partLabel(next)} (${next})`);
      return out;
    });
  };

  const partsSummary = useMemo(() => {
    const broken = Object.entries(parts)
      .filter(([, s]) => s === "broken")
      .map(([k]) => prettyPartsName[k as keyof Parts]);
    const damaged = Object.entries(parts)
      .filter(([, s]) => s === "damaged")
      .map(([k]) => prettyPartsName[k as keyof Parts]);
    return { broken, damaged };
  }, [parts]);

  // ----- save/load helpers -----
  const buildSaveData = (): SaveData => ({
    version: 1,
    mode,
    parts,
    log,
    characters,
    relations,
    diceNotation,
    lastRoll,
    sceneType,
    checksInScene,
  });

  const applySaveData = (data: SaveData) => {
    setMode(data.mode ?? "setup");
    setParts(data.parts);
    setLog(data.log?.length ? data.log : [{ id: uid(), ts: Date.now(), kind: "SYS", text: "세션 시작" }]);
    setCharacters(data.characters?.length ? data.characters : []);
    setRelations(data.relations ?? {});
    setDiceNotation(data.diceNotation ?? "1d10+0");
    setLastRoll(data.lastRoll);
    setSceneType(data.sceneType ?? "탐색");
    setChecksInScene(data.checksInScene ?? 3);
  };

  const saveLocal = () => {
    const data = buildSaveData();
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    addLog("SAVE", "로컬 저장 완료(localStorage).");
  };

  const loadLocal = () => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      addLog("SAVE", "로컬 저장 데이터가 없어.");
      return;
    }
    try {
      const data = JSON.parse(raw) as SaveData;
      if (!data || data.version !== 1) throw new Error("version mismatch");
      applySaveData(data);
      addLog("SAVE", "로컬 불러오기 완료(localStorage).");
    } catch {
      addLog("SAVE", "로컬 불러오기 실패: 데이터가 깨졌거나 형식이 달라.");
    }
  };

  const exportJsonToBox = () => {
    const data = buildSaveData();
    setJsonBox(JSON.stringify(data, null, 2));
    addLog("SAVE", "JSON 내보내기: 텍스트 박스에 생성 완료.");
  };

  const importJsonFromBox = () => {
    const raw = jsonBox.trim();
    if (!raw) {
      addLog("SAVE", "JSON 불러오기 실패: 텍스트가 비어있어.");
      return;
    }
    try {
      const data = JSON.parse(raw) as SaveData;
      if (!data || data.version !== 1) throw new Error("version mismatch");
      applySaveData(data);
      addLog("SAVE", "JSON 불러오기 완료.");
    } catch {
      addLog("SAVE", "JSON 불러오기 실패: JSON 형식 확인해줘.");
    }
  };

  const resetAll = () => {
    setMode("setup");
    setParts({ head: "ok", body: "ok", armL: "ok", armR: "ok", legL: "ok", legR: "ok" });
    setCharacters([
      {
        id: uid(),
        name: "캐릭터 1",
        position: "앨리스",
        clazz: "스테이시",
        reinforceType: "무기류",
        reinforceDetail: "",
        treasure: "인형",
        treasureCount: 2,
        speech: "반말",
        temperament: "냉정",
        notes: "",
        mentalMod: 0,
        madness: 0,
      },
    ]);
    setRelations({});
    setDiceNotation("1d10+0");
    setLastRoll(undefined);
    setSceneType("탐색");
    setChecksInScene(3);
    setLog([{ id: uid(), ts: Date.now(), kind: "SYS", text: "전체 초기화" }]);
    setJsonBox("");
  };

  // ----- dice actions -----
  const doRoll = () => {
    const parsed = parse1d10(diceNotation);
    if (!parsed) {
      addLog("DICE", `주사위 표기 오류: "${diceNotation}" (예: 1d10+2)`);
      return;
    }
    const r = roll1d10(parsed.mod);
    const info = { notation: diceNotation, rolls: [r.die], total: r.total, mod: parsed.mod };
    setLastRoll(info);
    addLog("DICE", `🎲 ${diceNotation} → [${r.die}] + (${parsed.mod >= 0 ? "+" : ""}${parsed.mod}) = ${r.total}`);
  };

  // ----- characters CRUD -----
  const addCharacter = () => {
    const idx = characters.length + 1;
    setCharacters((prev) => [
      ...prev,
      {
        id: uid(),
        name: `캐릭터 ${idx}`,
        position: "앨리스",
        clazz: "스테이시",
        reinforceType: "무기류",
        reinforceDetail: "",
        treasure: "인형",
        treasureCount: 2,
        speech: "반말",
        temperament: "냉정",
        notes: "",
        mentalMod: 0,
        madness: 0,
      },
    ]);
    addLog("SYS", `캐릭터 추가: 캐릭터 ${idx}`);
  };

  const removeCharacter = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    addLog("SYS", "캐릭터 삭제");
    // relations 정리
    setRelations((prev) => {
      const next: Record<string, RelationLevel> = {};
      for (const [k, v] of Object.entries(prev)) {
        const [a, b] = k.split("|");
        if (a !== id && b !== id) next[k] = v;
      }
      return next;
    });
  };

  const updateChar = (id: string, patch: Partial<Character>) => {
    setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  // ----- relations -----
  const [relA, setRelA] = useState<string>("");
  const [relB, setRelB] = useState<string>("");
  const [relLevel, setRelLevel] = useState<RelationLevel>("중립");

  useEffect(() => {
    // 기본값 세팅
    if (!relA && characters[0]) setRelA(characters[0].id);
    if (!relB && characters[1]) setRelB(characters[1].id);
  }, [characters, relA, relB]);

  useEffect(() => {
    if (!relA || !relB || relA === relB) return;
    const k = relKey(relA, relB);
    const cur = relations[k] ?? "중립";
    setRelLevel(cur);
  }, [relA, relB, relations]);

  const saveRelation = () => {
    if (!relA || !relB || relA === relB) return;
    const k = relKey(relA, relB);
    setRelations((prev) => ({ ...prev, [k]: relLevel }));
    const aName = characters.find((c) => c.id === relA)?.name ?? "A";
    const bName = characters.find((c) => c.id === relB)?.name ?? "B";
    addLog("SIM", `관계 변경: ${aName} ↔ ${bName} = ${relLevel}`);
  };

  // ----- simulation: 1 scene multiple checks -----
  const sceneTemplates: Record<SceneType, string[]> = {
    탐색: [
      "{A}는(은) 폐허의 틈을 더듬어 단서를 찾는다.",
      "{A}는(은) 낡은 표식을 확인하고 이동 경로를 추정한다.",
      "{A}는(은) 주변 소리를 죽이고 위험을 가늠한다.",
    ],
    전투: [
      "{A}는(은) 반사적으로 사거리를 잡고 공격한다.",
      "{A}는(은) 빈틈을 파고들어 상대의 균형을 무너뜨린다.",
      "{A}는(은) 몸을 낮춰 치명상을 피한다.",
    ],
    교섭: [
      "{A}는(은) 말투를 조절해 상대의 의도를 떠본다.",
      "{A}는(은) 조건을 제시하고 반응을 관찰한다.",
      "{A}는(은) 분위기를 장악하려 한다.",
    ],
    공포: [
      "{A}는(은) 불길한 직감을 억누르며 한 발 내딛는다.",
      "{A}는(은) 귓가의 소음을 애써 무시한다.",
      "{A}는(은) 손끝이 떨리는 걸 감춘다.",
    ],
  };

  const outcomeText = (die: number, total: number, target = 6) => {
    // 네크로니카 감성: 1=대실패, 10=대성공, 그 외는 target 비교
    if (die === 10) return "대성공(10)";
    if (die === 1) return "대실패(1)";
    return total >= target ? "성공" : "실패";
  };

  const doMadnessCheck = (c: Character, reason: string) => {
    // 1d10 + mentalMod vs 6
    const r = roll1d10(c.mentalMod);
    const out = outcomeText(r.die, r.total, 6);
    addLog("SIM", `🧠 광기 판정(${c.name}) [1d10${c.mentalMod >= 0 ? "+" : ""}${c.mentalMod}] → ${r.die} = ${r.total} / ${out} (${reason})`);

    if (r.die === 10) return; // 대성공: 변화 없음
    if (r.total >= 6 && r.die !== 1) return; // 성공: 변화 없음

    // 실패/대실패 -> 광기 +1
    const nextMadness = clamp(c.madness + 1, 0, 10);
    updateChar(c.id, { madness: nextMadness });

    // 보물(심리 안정용) 있으면 “완충” 로그만(요청: 쉽게 광기판정 나지 않게 도움)
    // 실제 수치 감소는 하지 않고, 네가 원하는대로 나중에 규칙 강화 가능
    if (c.treasureCount > 0) {
      addLog("SIM", `🧸 보물이 마음을 붙잡는다: ${c.treasure} (보유 ${c.treasureCount})`);
    }

    if (nextMadness >= 10) {
      addLog("SIM", `💥 붕괴: ${c.name}의 광기점이 10에 도달했다.`);
    }
  };

  const loseTreasure = (cid: string) => {
    const c = characters.find((x) => x.id === cid);
    if (!c) return;
    if (c.treasureCount <= 0) {
      addLog("SIM", `🧸 보물 분실 시도: ${c.name}은(는) 이미 보물이 없다.`);
      return;
    }
    const nextCount = c.treasureCount - 1;
    const nextMadness = clamp(c.madness + 1, 0, 10);
    updateChar(cid, { treasureCount: nextCount, madness: nextMadness });
    addLog("SIM", `🧸 보물 분실: ${c.name}의 ${c.treasure} (-1) → 광기점 +1 (${nextMadness}/10)`);
    if (nextMadness >= 10) addLog("SIM", `💥 붕괴: ${c.name}의 광기점이 10에 도달했다.`);
  };

  const runScene = () => {
    if (characters.length === 0) {
      addLog("SIM", "씬 진행 실패: 캐릭터가 없어.");
      return;
    }
    const count = clamp(checksInScene, 1, 10);
    addLog("SIM", `🎬 씬 시작: ${sceneType} / 판정 ${count}회`);

    for (let i = 0; i < count; i++) {
      const c = pickOne(characters);
      const line = pickOne(sceneTemplates[sceneType]).replaceAll("{A}", c.name);
      addLog("SIM", `- ${line}`);

      // 장면 타입별로 판정 종류를 간단히 분기(원하면 더 세밀하게 늘릴 수 있음)
      if (sceneType === "공포") {
        doMadnessCheck(c, "공포");
      } else {
        // 일반 행동 판정: 1d10+0 vs 6, 실패 시 약한 흔들림으로 광기 체크 1번
        const r = roll1d10(0);
        const out = outcomeText(r.die, r.total, 6);
        addLog("SIM", `🎲 행동 판정(${c.name}) 1d10 → ${r.die} / ${out}`);
        if (out === "실패" || out === "대실패(1)") {
          doMadnessCheck(c, "실패 여파");
        }
      }
    }

    addLog("SIM", `✅ 씬 종료: ${sceneType}`);
  };

  const startRun = () => {
    setMode("run");
    addLog("SYS", "▶ 실행 모드로 전환");
  };

  const backToSetup = () => {
    setMode("setup");
    addLog("SYS", "↩ 설정 모드로 복귀");
  };

  // ----- UI blocks -----
  const TopBar = (
    <div className="topBar">
      <div>
        <div className="appTitle">네크로니카 TR 시뮬레이터</div>
        <div className="appSubtitle">1d10 통일 · 파츠/로그/세이브 · 캐릭터 설정 → 실행 화면 전환</div>
      </div>

      <div className="topActions">
        {mode === "run" ? (
          <button className="btn" onClick={backToSetup} title="캐릭터 설정 화면으로">
            설정으로
          </button>
        ) : (
          <button className="btn btnAccent" onClick={startRun} title="실행 화면으로 전환">
            실행
          </button>
        )}

        <button className="btn" onClick={saveLocal} title="localStorage 저장">
          저장(Local)
        </button>
        <button className="btn" onClick={loadLocal} title="localStorage 불러오기">
          불러오기(Local)
        </button>

        <button className="btn" onClick={exportJsonToBox} title="텍스트박스에 JSON 생성">
          JSON 내보내기
        </button>
        <button className="btn" onClick={importJsonFromBox} title="텍스트박스 JSON을 적용">
          JSON 불러오기
        </button>

        <button className="btn btnDanger" onClick={resetAll} title="전체 초기화">
          전체 초기화
        </button>
      </div>
    </div>
  );

  const SavePanel = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">💾 세이브 / 로드</div>
        <div className="panelRight hintSmall">자동 저장: 필요하면 저장(Local) 눌러줘.</div>
      </div>

      <textarea
        className="textarea"
        value={jsonBox}
        onChange={(e) => setJsonBox(e.target.value)}
        placeholder="내보내기 누르면 여기에 JSON 생성. 백업/공유용. 불러오기는 여기 JSON 붙여넣고 버튼."
        rows={6}
      />
      <div className="hint">
        Vercel 배포 업데이트는 “코드 수정 → GitHub에 push”가 되어야 반영돼. (로컬 localhost 링크는 업로드 대상 아님)
      </div>
    </div>
  );

  const PartsPanel = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">🧩 파츠</div>
        <div className="panelRight hintSmall">
          손상 {partsSummary.damaged.length} / 파괴 {partsSummary.broken.length}
        </div>
      </div>

      <div className="partsRow">
        {Object.entries(parts).map(([key, state]) => (
          <button
            key={key}
            onClick={() => togglePart(key as keyof Parts)}
            className={`partBtn part-${state}`}
            title="클릭하면 ok → damaged → broken 순환"
          >
            {prettyPartsName[key as keyof Parts]} : {partLabel(state as PartState)}
          </button>
        ))}
      </div>

      {(partsSummary.damaged.length > 0 || partsSummary.broken.length > 0) && (
        <div className="hint">
          {partsSummary.damaged.length > 0 && <div>손상: {partsSummary.damaged.join(", ")}</div>}
          {partsSummary.broken.length > 0 && <div>파괴: {partsSummary.broken.join(", ")}</div>}
        </div>
      )}
    </div>
  );

  const DicePanel = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">🎲 다이스(1d10)</div>
        <div className="panelRight hintSmall">예: 1d10+2 / 1d10-1</div>
      </div>

      <div className="row">
        <input className="input" value={diceNotation} onChange={(e) => setDiceNotation(e.target.value)} />
        <button className="btn btnAccent" onClick={doRoll}>
          굴리기
        </button>
      </div>

      <div className="hint">
        {lastRoll ? (
          <>
            마지막: {lastRoll.notation} → [{lastRoll.rolls.join(", ")}] = <b>{lastRoll.total}</b>
          </>
        ) : (
          "아직 굴린 기록 없음"
        )}
      </div>
    </div>
  );

  const LogPanel = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">📝 로그</div>
        <div className="panelRight">
          <button className="btn btnDanger" onClick={() => setLog([])} title="로그 초기화">
            초기화
          </button>
        </div>
      </div>

      <div ref={logRef} className="logBox">
        {log.map((e) => (
          <div key={e.id} className="logRow">
            <div className="logTime">{formatTime(e.ts)}</div>
            <div className={`logKind k-${e.kind}`}>{e.kind}</div>
            <div className="logText">{e.text}</div>
          </div>
        ))}
      </div>

      <div className="hint">파츠/다이스/세이브/씬 이벤트가 자동 기록돼.</div>
    </div>
  );

  const SetupCharacters = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">👤 캐릭터 시트(설정)</div>
        <div className="panelRight">
          <button className="btn btnAccent" onClick={addCharacter}>
            + 캐릭터 추가
          </button>
        </div>
      </div>

      <div className="setupGrid">
        {characters.map((c, idx) => (
          <div key={c.id} className="charCard">
            <div className="charCardTop">
              <div className="charBadge">{idx + 1}</div>
              <input
                className="input charName"
                value={c.name}
                onChange={(e) => updateChar(c.id, { name: e.target.value })}
                placeholder="이름"
              />
              <button className="btn btnDanger" onClick={() => removeCharacter(c.id)} title="삭제">
                삭제
              </button>
            </div>

            <div className="formGrid">
              <label>
                <div className="label">포지션</div>
                <select
                  className="input"
                  value={c.position}
                  onChange={(e) => updateChar(c.id, { position: e.target.value as NechPosition })}
                >
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="label">클래스</div>
                <select
                  className="input"
                  value={c.clazz}
                  onChange={(e) => updateChar(c.id, { clazz: e.target.value as NechClass })}
                >
                  {CLASSES.map((cl) => (
                    <option key={cl} value={cl}>
                      {cl}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="label">보강 지점</div>
                <select
                  className="input"
                  value={c.reinforceType}
                  onChange={(e) => updateChar(c.id, { reinforceType: e.target.value as ReinforceType })}
                >
                  {REINFORCES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="label">보물</div>
                <select
                  className="input"
                  value={c.treasure}
                  onChange={(e) => updateChar(c.id, { treasure: e.target.value as Treasure })}
                >
                  {TREASURES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="label">보물 보유(0~3)</div>
                <select
                  className="input"
                  value={c.treasureCount}
                  onChange={(e) => updateChar(c.id, { treasureCount: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="label">말투</div>
                <select
                  className="input"
                  value={c.speech}
                  onChange={(e) => updateChar(c.id, { speech: e.target.value as Character["speech"] })}
                >
                  {["반말", "존댓말", "슴다체", "무뚝뚝"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="label">성향</div>
                <select
                  className="input"
                  value={c.temperament}
                  onChange={(e) => updateChar(c.id, { temperament: e.target.value as Character["temperament"] })}
                >
                  {["냉정", "다정", "광기", "게으름"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="label">광기 보정(-3~+3)</div>
                <input
                  className="input"
                  type="number"
                  value={c.mentalMod}
                  min={-3}
                  max={3}
                  onChange={(e) => updateChar(c.id, { mentalMod: clamp(Number(e.target.value), -3, 3) })}
                />
              </label>

              <label>
                <div className="label">현재 광기점(0~10)</div>
                <input
                  className="input"
                  type="number"
                  value={c.madness}
                  min={0}
                  max={10}
                  onChange={(e) => updateChar(c.id, { madness: clamp(Number(e.target.value), 0, 10) })}
                />
              </label>

              <label className="span2">
                <div className="label">보강 상세(많으면 자유 작성)</div>
                <input
                  className="input"
                  value={c.reinforceDetail}
                  onChange={(e) => updateChar(c.id, { reinforceDetail: e.target.value })}
                  placeholder="예: 팔에 내장형 톱니 / 신경 강화 / 변이 촉수 ..."
                />
              </label>

              <label className="span2">
                <div className="label">메모</div>
                <textarea
                  className="textarea"
                  rows={3}
                  value={c.notes}
                  onChange={(e) => updateChar(c.id, { notes: e.target.value })}
                  placeholder="성격/관계/금기/연출 포인트..."
                />
              </label>
            </div>

            <div className="charQuick">
              <button className="btn" onClick={() => loseTreasure(c.id)} title="보물 1개 분실(+광기)">
                🧸 보물 분실(+광기)
              </button>
              <button className="btn" onClick={() => doMadnessCheck(c, "수동")} title="광기 판정">
                🧠 광기 판정
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="hint">
        실행 누르면 화면이 “진행 모드(정돈된 레이아웃)”로 바뀐다.  
        관계/씬/로그는 진행 모드에서 주로 보게 될 거야.
      </div>
    </div>
  );

  const RunSimPanel = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">🎬 시뮬레이터</div>
        <div className="panelRight">
          <button className="btn btnAccent" onClick={runScene}>
            씬 진행
          </button>
        </div>
      </div>

      <div className="formGrid">
        <label>
          <div className="label">씬 타입</div>
          <select className="input" value={sceneType} onChange={(e) => setSceneType(e.target.value as SceneType)}>
            {(["탐색", "전투", "교섭", "공포"] as SceneType[]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div className="label">씬 내 판정 횟수(1~10)</div>
          <input
            className="input"
            type="number"
            value={checksInScene}
            min={1}
            max={10}
            onChange={(e) => setChecksInScene(clamp(Number(e.target.value), 1, 10))}
          />
        </label>
      </div>

      <div className="hint">
        - 탐색/전투/교섭: 행동 판정(1d10) 실패 시 “여파”로 광기 판정이 들어갈 수 있음  
        - 공포: 매 판정이 바로 광기 판정(1d10+보정)  
        (규칙은 네가 원하는 방향으로 더 네크로니카답게 강화 가능)
      </div>
    </div>
  );

  const RunRelationsPanel = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">🔗 관계</div>
        <div className="panelRight">
          <button className="btn btnAccent" onClick={saveRelation} disabled={!relA || !relB || relA === relB}>
            저장
          </button>
        </div>
      </div>

      <div className="formGrid">
        <label>
          <div className="label">A</div>
          <select className="input" value={relA} onChange={(e) => setRelA(e.target.value)}>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div className="label">B</div>
          <select className="input" value={relB} onChange={(e) => setRelB(e.target.value)}>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="span2">
          <div className="label">관계</div>
          <select className="input" value={relLevel} onChange={(e) => setRelLevel(e.target.value as RelationLevel)}>
            {(["신뢰", "중립", "경계", "적대"] as RelationLevel[]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="hintSmall">
        지금은 “관계값 저장 + 로그 기록”까지만. 다음 단계에서 관계값이 씬 텍스트/판정 확률에 영향 주게 확장 가능.
      </div>
    </div>
  );

  const RunCharactersPanel = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">👥 생존자 목록</div>
        <div className="panelRight hintSmall">{characters.length}명</div>
      </div>

      <div className="survivorList">
        {characters.map((c) => (
          <div key={c.id} className="survivorRow">
            <div className="survivorName">{c.name}</div>
            <div className="survivorMeta">
              <span className="pill">{c.position}</span>
              <span className="pill">{c.clazz}</span>
              <span className="pill">광기 {c.madness}/10</span>
              <span className="pill">🧸{c.treasureCount}</span>
            </div>
            <div className="survivorActions">
              <button className="btn" onClick={() => doMadnessCheck(c, "수동")}>
                광기 판정
              </button>
              <button className="btn" onClick={() => loseTreasure(c.id)}>
                보물 분실
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ----- LAYOUT -----
  return (
    <div className="app">
      {TopBar}

      {mode === "setup" ? (
        <div className="layoutSetup">
          <div className="colMain">
            {SetupCharacters}
            {SavePanel}
          </div>

          <div className="colSide">
            {PartsPanel}
            {DicePanel}
            {LogPanel}
          </div>
        </div>
      ) : (
        <div className="layoutRun">
          {/* Left */}
          <div className="runLeft">
            {RunCharactersPanel}
            {PartsPanel}
            {DicePanel}
            {SavePanel}
          </div>

          {/* Center */}
          <div className="runCenter">
            {RunSimPanel}
            {LogPanel}
          </div>

          {/* Right */}
          <div className="runRight">
            {RunRelationsPanel}
            <div className="panel">
              <div className="panelHeader">
                <div className="panelTitle">💡 팁</div>
              </div>
              <div className="hint">
                - “설정으로” 돌아가서 캐릭터 추가/수정 가능<br />
                - 씬을 반복하며 로그가 쌓이는 구조라, 네가 원하는 “붕괴” 감성을 점점 강화하기 좋다<br />
                - 다음 단계: (1) 관계가 텍스트/판정에 영향, (2) 이벤트 풀/선택지, (3) 씬 길이/속도 조절
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
