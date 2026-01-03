import React, { useEffect, useMemo, useState } from "react";

/** ===== Types ===== */
type PartState = "ok" | "damaged" | "broken";
type Parts = Record<string, PartState>;

type LogEntry = { id: string; ts: number; text: string };

type CheckType = "조사" | "교섭" | "행동" | "전투" | "정신";

type SimMode = "observe" | "intervene";

type Character = {
  id: string;
  name: string;

  // 네크로니카
  position: string;      // 앨리스~솔로리티
  classType: string;     // 스테이시~사이키델릭
  reinforceType: string; // 무기류/강화 장치/돌연변이
  reinforceText: string; // 상세 직접 입력

  // 보물 (심리안정용)
  treasure: string;         // 보물 종류(선택)
  treasureIntact: boolean;  // 보물 보유 여부(잃으면 false)

  // RP/정책(선택형 유지)
  temperament: string;
  speech: string;
  trust: string;

  // 시뮬레이터 상태
  madness: number; // 0~10 (높을수록 붕괴 가까움)
};

type SaveData = {
  version: number;
  parts: Parts;
  log: LogEntry[];
  characters: Character[];

  // sim
  simMode: SimMode;
  scene: SceneState | null;
  activeIndex: number;
};

type SceneState = {
  id: string;
  title: string;
  intro: string;
  beat: number;        // 1..3
  beatsTotal: number;  // 기본 3
  tension: number;     // 0..5 분위기/위험도
  lastOutcome?: string;
};

/** ===== Constants ===== */
const LS_KEY = "nechronica_tr_state_sim_v2";

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

const partLabel = (s: PartState) => (s === "ok" ? "정상" : s === "damaged" ? "손상" : "파괴");

const OPT = {
  position: ["앨리스", "홀릭", "오토마톤", "정크", "코트", "솔로리티"],
  classType: ["스테이시", "타나토스", "고딕", "레퀴엠", "바로크", "로마네스크", "사이키델릭(확장)"],
  reinforceType: ["무기류", "강화 장치", "돌연변이"],
  treasure: ["사진", "책", "언데드 펫", "부서진 부분", "거울", "인형", "봉제인형", "악세사리", "바구니", "귀여운 옷"],
  temperament: ["무감정", "냉소적", "집착", "광기", "헌신", "불안정", "천진난만", "잔혹", "기타"],
  speech: ["존댓말", "반말", "무뚝뚝", "나른함", "조용함", "기타"],
  trust: ["신뢰", "호의", "중립", "경계", "적대"],
};

/** ===== Utils ===== */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const formatTime = (ts: number) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 1d10 */
function roll1d10(): number {
  return 1 + Math.floor(Math.random() * 10);
}

/** 결과 등급(1d10 통일) */
type Grade = "성공" | "부분성공" | "실패" | "대참사";
function gradeFromD10(x: number): Grade {
  if (x >= 8) return "성공";
  if (x >= 5) return "부분성공";
  if (x >= 2) return "실패";
  return "대참사"; // 1
}

/** ===== Character factory (오류 방지 핵심) ===== */
const makeCharacter = (over?: Partial<Character>): Character => ({
  id: (globalThis.crypto?.randomUUID?.() ?? uid()),
  name: "캐릭터",

  position: "앨리스",
  classType: "스테이시",
  reinforceType: "무기류",
  reinforceText: "",

  treasure: "사진",
  treasureIntact: true,

  temperament: "무감정",
  speech: "무뚝뚝",
  trust: "중립",

  madness: 0,

  ...(over ?? {}),
});

/** 구버전 세이브 호환 */
function normalizeCharacter(raw: Partial<Character>): Character {
  return makeCharacter({
    ...raw,
    id: raw.id ?? (globalThis.crypto?.randomUUID?.() ?? uid()),
    name: raw.name ?? "캐릭터",
    position: raw.position ?? "앨리스",
    classType: raw.classType ?? "스테이시",
    reinforceType: raw.reinforceType ?? "무기류",
    reinforceText: raw.reinforceText ?? "",
    treasure: raw.treasure ?? "사진",
    treasureIntact: raw.treasureIntact ?? true,
    temperament: raw.temperament ?? "무감정",
    speech: raw.speech ?? "무뚝뚝",
    trust: raw.trust ?? "중립",
    madness: Number.isFinite(raw.madness as number) ? (raw.madness as number) : 0,
  });
}

/** ===== Scene generator ===== */
const SCENE_TITLES = [
  "폐허의 복도",
  "무너진 계단",
  "녹슨 수술실",
  "검은 온실",
  "막힌 격납고",
  "정전된 제어실",
  "차가운 기숙사",
  "피 냄새 나는 창고",
];

function startNewScene(): SceneState {
  const title = SCENE_TITLES[Math.floor(Math.random() * SCENE_TITLES.length)];
  const tension = Math.floor(Math.random() * 3) + 1; // 1~3
  const introPool = [
    "먼지가 떠다닌다. 발소리가 너무 크게 들린다.",
    "빛이 깨진다. 무언가가 너무 가까이 있다.",
    "숨을 쉬는 것조차 들켜버릴 것 같다.",
    "여기엔 사람이 있었고, 지금은 없다.",
  ];
  const intro = introPool[Math.floor(Math.random() * introPool.length)];
  return {
    id: uid(),
    title,
    intro,
    beat: 1,
    beatsTotal: 3,
    tension,
  };
}

/** ===== Choice generation ===== */
type Choice = {
  id: string;
  label: string;
  type: CheckType;
  risk: number; // 0..2 (높을수록 파츠/보물 위험)
};

function makeChoicesForBeat(scene: SceneState): Choice[] {
  // 비트별로 “자주 나오는 타입”을 조금씩 다르게
  const beat = scene.beat;
  const base: Array<CheckType> =
    beat === 1 ? ["조사", "행동", "교섭"] :
    beat === 2 ? ["정신", "조사", "행동"] :
    ["전투", "행동", "정신"];

  const templates: Record<CheckType, string[]> = {
    조사: ["주변을 조사한다", "흔적을 추적한다", "단서를 회수한다"],
    교섭: ["상대의 의도를 떠본다", "거리를 좁힌다", "거짓말을 섞어 설득한다"],
    행동: ["조용히 이동한다", "급히 엄폐한다", "우회로를 찾는다"],
    전투: ["선제 공격한다", "견제하며 후퇴한다", "희생으로 돌파한다"],
    정신: ["호흡을 가다듬는다", "기억을 붙잡는다", "손끝의 감각에 집중한다"],
  };

  const riskByType: Record<CheckType, number> = {
    조사: 0,
    교섭: 0,
    행동: 1,
    전투: 2,
    정신: 1,
  };

  return base.map((t) => {
    const arr = templates[t];
    const label = arr[Math.floor(Math.random() * arr.length)];
    return {
      id: uid(),
      label,
      type: t,
      risk: riskByType[t],
    };
  });
}

/** ===== AI choice policy ===== */
function scoreChoiceForCharacter(c: Character, choice: Choice, parts: Parts, scene: SceneState): number {
  // 기본 점수
  let s = 10;

  // 광기 높으면 정신 관련 선택 경향↑
  if (choice.type === "정신") s += Math.min(8, c.madness * 1.2);

  // 적대/경계가 강하면 전투 경향↑
  if (choice.type === "전투") {
    if (c.trust === "적대") s += 8;
    else if (c.trust === "경계") s += 4;
    else s += 1;
  }

  // 조사 성향(냉정/무감정)
  if (choice.type === "조사") {
    if (c.temperament === "무감정" || c.temperament === "냉소적") s += 6;
    if (scene.tension >= 3) s += 2;
  }

  // 행동(도주/엄폐)은 불안정/겁먹은 느낌(광기↑)일수록↑
  if (choice.type === "행동") {
    s += Math.min(6, c.madness);
    if (scene.tension >= 3) s += 3;
  }

  // 보물 상실 상태면 정신이 불리해져서 “정신”을 피하거나 집착할 수도 있음.
  // 여기서는: 보물이 없으면 정신 선택에 가산(집착/불안) +2
  if (!c.treasureIntact && choice.type === "정신") s += 2;

  // 파츠가 많이 망가졌으면 전투/행동을 살짝 회피
  const brokenCount = Object.values(parts).filter((x) => x === "broken").length;
  const damagedCount = Object.values(parts).filter((x) => x === "damaged").length;
  const injury = brokenCount * 2 + damagedCount;
  if (injury >= 3 && (choice.type === "전투" || choice.type === "행동")) s -= 4;

  // 위험도가 높으면 전투/행동이 늘기도 하지만, 정신도 필요
  s += scene.tension;

  // 약간의 랜덤성
  s += Math.random() * 4;

  return s;
}

function pickChoiceAI(c: Character, choices: Choice[], parts: Parts, scene: SceneState): Choice {
  let best = choices[0];
  let bestScore = -Infinity;
  for (const ch of choices) {
    const sc = scoreChoiceForCharacter(c, ch, parts, scene);
    if (sc > bestScore) {
      bestScore = sc;
      best = ch;
    }
  }
  return best;
}

/** ===== Apply outcome ===== */
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function bumpPart(parts: Parts, key: string): Parts {
  const curr = parts[key] ?? "ok";
  const next: PartState = curr === "ok" ? "damaged" : curr === "damaged" ? "broken" : "broken";
  return { ...parts, [key]: next };
}

function randomPartKey(): string {
  const keys = Object.keys(defaultParts);
  return keys[Math.floor(Math.random() * keys.length)];
}

type ResolveResult = {
  roll: number;
  grade: Grade;
  text: string;
  parts?: Parts;
  character?: Character;
  scene?: SceneState;
};

function resolveCheck(
  scene: SceneState,
  choice: Choice,
  c: Character,
  parts: Parts
): ResolveResult {
  // 1d10 굴림 + 타입별 간단 보정
  let roll = roll1d10();

  // 정신 판정: 보물(심리 안정) 있으면 결과 완화(+1), 없으면 불리(-1)
  if (choice.type === "정신") {
    roll += c.treasureIntact ? 1 : -1;
    roll = clamp(roll, 1, 10);
  }

  const grade = gradeFromD10(roll);

  let nextC: Character = { ...c };
  let nextParts: Parts = { ...parts };
  let nextScene: SceneState = { ...scene };

  // 공통: 텍스트 뼈대
  let text = `🎬 [${scene.title}] (비트 ${scene.beat}/${scene.beatsTotal}) — ${c.name}: ${choice.label} → ${choice.type} 판정 1d10=${roll} (${grade})`;

  // 타입별 후처리
  const risk = choice.risk + (scene.tension >= 3 ? 1 : 0);

  const addMadness = (delta: number) => {
    const before = nextC.madness;
    nextC.madness = clamp(nextC.madness + delta, 0, 10);
    if (nextC.madness !== before) {
      text += ` / 광기 ${before}→${nextC.madness}`;
    }
  };

  const maybeLoseTreasure = () => {
    if (!nextC.treasureIntact) return;
    // 위험도에 따라 보물 상실 확률
    const p = risk === 0 ? 0.05 : risk === 1 ? 0.12 : 0.22;
    if (Math.random() < p) {
      nextC.treasureIntact = false;
      text += ` / 💔 보물(${nextC.treasure}) 상실`;
      // 상실 시 광기 증가(너 요청 반영)
      addMadness(2);
    }
  };

  const maybeDamagePart = () => {
    const key = randomPartKey();
    nextParts = bumpPart(nextParts, key);
    text += ` / 🧩 ${prettyPartsName[key] ?? key} ${partLabel(parts[key] ?? "ok")}→${partLabel(nextParts[key])}`;
  };

  // 결과 반영(리듬 위해 간단/직관적으로)
  if (choice.type === "조사") {
    if (grade === "성공") {
      nextScene.tension = clamp(nextScene.tension - 1, 0, 5);
      text += " / 단서 확보(긴장-1)";
    } else if (grade === "부분성공") {
      text += " / 단서 확보(대가 있음)";
      maybeLoseTreasure();
    } else if (grade === "실패") {
      nextScene.tension = clamp(nextScene.tension + 1, 0, 5);
      text += " / 함정 노출(긴장+1)";
    } else {
      nextScene.tension = clamp(nextScene.tension + 2, 0, 5);
      text += " / 숨겨진 진실이 폭주(긴장+2)";
      addMadness(1);
      maybeLoseTreasure();
    }
  }

  if (choice.type === "교섭") {
    if (grade === "성공") {
      text += " / 분위기 장악";
      nextScene.tension = clamp(nextScene.tension - 1, 0, 5);
    } else if (grade === "부분성공") {
      text += " / 거래 성사(기분 나쁜 약속)";
      addMadness(1);
    } else if (grade === "실패") {
      text += " / 말이 엇나감";
      nextScene.tension = clamp(nextScene.tension + 1, 0, 5);
    } else {
      text += " / 관계가 급변하는 붕괴의 전조";
      addMadness(2);
      maybeLoseTreasure();
    }
  }

  if (choice.type === "행동") {
    if (grade === "성공") {
      text += " / 무사히 위치 확보";
      nextScene.tension = clamp(nextScene.tension - 1, 0, 5);
    } else if (grade === "부분성공") {
      text += " / 이동 성공(흔적을 남김)";
      maybeLoseTreasure();
    } else if (grade === "실패") {
      text += " / 고립";
      nextScene.tension = clamp(nextScene.tension + 1, 0, 5);
      maybeDamagePart();
    } else {
      text += " / 악화된 상황으로 휘말림";
      nextScene.tension = clamp(nextScene.tension + 2, 0, 5);
      maybeLoseTreasure();
      maybeDamagePart();
      addMadness(1);
    }
  }

  if (choice.type === "전투") {
    if (grade === "성공") {
      text += " / 제압 또는 돌파";
      nextScene.tension = clamp(nextScene.tension - 1, 0, 5);
    } else if (grade === "부분성공") {
      text += " / 돌파(대가: 파츠 손상)";
      maybeDamagePart();
      maybeLoseTreasure();
    } else if (grade === "실패") {
      text += " / 밀림(파츠 손상)";
      maybeDamagePart();
      nextScene.tension = clamp(nextScene.tension + 1, 0, 5);
      maybeLoseTreasure();
    } else {
      text += " / 대참사(파츠 파괴/붕괴)";
      // 대참사는 2회 정도 피해
      maybeDamagePart();
      maybeDamagePart();
      maybeLoseTreasure();
      addMadness(2);
      nextScene.tension = clamp(nextScene.tension + 2, 0, 5);
    }
  }

  if (choice.type === "정신") {
    // 보물로 “쉽게 광기 판정” 나지 않게: 결과 자체가 완화(+1 이미 적용)
    // 추가로, 정신 판정은 실패 시 광기 상승이 핵심
    if (grade === "성공") {
      text += " / 심신 안정";
      addMadness(-1);
    } else if (grade === "부분성공") {
      text += " / 간신히 버팀";
      // 변화 없음(혹은 +0)
    } else if (grade === "실패") {
      text += " / 흔들림";
      addMadness(1);
      maybeLoseTreasure();
    } else {
      text += " / 붕괴의 파도";
      addMadness(2);
      maybeLoseTreasure();
    }
  }

  // 붕괴 임계치 연출(광기 8 이상이면 선택이 거칠어지도록 다음 비트 긴장+1)
  if (nextC.madness >= 8) {
    nextScene.tension = clamp(nextScene.tension + 1, 0, 5);
    text += " / ⚠️ 고광기(긴장+1)";
  }

  nextScene.lastOutcome = text;

  return { roll, grade, text, parts: nextParts, character: nextC, scene: nextScene };
}

/** ===== App ===== */
export default function App() {
  const [parts, setParts] = useState<Parts>(defaultParts);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [characters, setCharacters] = useState<Character[]>([
    makeCharacter({ name: "캐릭터 1" }),
  ]);

  // sim
  const [simMode, setSimMode] = useState<SimMode>("observe");
  const [scene, setScene] = useState<SceneState | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  // save/load textarea
  const [jsonBox, setJsonBox] = useState<string>("");

  /** ===== Log helpers ===== */
  const addLog = (text: string) => {
    setLog((prev) => [{ id: uid(), ts: Date.now(), text }, ...prev].slice(0, 800));
  };
  const clearLog = () => setLog([]);

  /** ===== Parts (manual toggle) ===== */
  const togglePart = (key: string) => {
    setParts((prev) => {
      const curr = prev[key] ?? "ok";
      const next: PartState = curr === "ok" ? "damaged" : curr === "damaged" ? "broken" : "ok";
      const updated = { ...prev, [key]: next };
      addLog(`🧩 파츠: ${prettyPartsName[key] ?? key} → ${partLabel(next)} (${next})`);
      return updated;
    });
  };

  /** ===== Characters helpers ===== */
  const addCharacter = () => {
    const n = characters.length + 1;
    const ch = makeCharacter({ name: `캐릭터 ${n}` });
    setCharacters((prev) => [ch, ...prev]);
    addLog(`👤 캐릭터 추가: ${ch.name}`);
  };

  const removeCharacter = (id: string) => {
    const target = characters.find((c) => c.id === id);
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    addLog(`🗑️ 캐릭터 삭제: ${target?.name ?? id}`);
    // activeIndex 보정
    setActiveIndex((i) => Math.max(0, Math.min(i, Math.max(0, characters.length - 2))));
  };

  const updateCharacter = (id: string, patch: Partial<Character>) => {
    setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  /** ===== Sim actions ===== */
  const beginScene = () => {
    const sc = startNewScene();
    setScene(sc);
    addLog(`🌑 씬 시작: ${sc.title} — ${sc.intro}`);
  };

  const endScene = () => {
    if (!scene) return;
    addLog(`🌘 씬 종료: ${scene.title} (긴장 ${scene.tension})`);
    setScene(null);
  };

  const currentActor = characters[activeIndex] ?? characters[0];

  const choices = useMemo(() => {
    if (!scene) return [];
    return makeChoicesForBeat(scene);
  }, [scene?.id, scene?.beat]);

  const advanceBeat = (picked?: Choice) => {
    if (!scene) return;
    if (characters.length === 0) return;

    const actor = currentActor ?? characters[0];
    const chosen =
      simMode === "observe"
        ? pickChoiceAI(actor, choices, parts, scene)
        : (picked ?? choices[0]);

    const res = resolveCheck(scene, chosen, actor, parts);

    // apply
    if (res.parts) setParts(res.parts);
    if (res.character) {
      setCharacters((prev) =>
        prev.map((c) => (c.id === actor.id ? res.character! : c))
      );
    }
    if (res.scene) setScene(res.scene);
    addLog(res.text);

    // 다음 비트 / 씬 종료 처리
    setScene((prev) => {
      if (!prev) return prev;
      const nextBeat = prev.beat + 1;
      if (nextBeat > prev.beatsTotal) {
        // 씬 종료
        setTimeout(() => endScene(), 0);
        return prev;
      }
      return { ...prev, beat: nextBeat };
    });

    // 다음 액터로(라운드 로빈)
    setActiveIndex((i) => (characters.length === 0 ? 0 : (i + 1) % characters.length));
  };

  /** ===== Save/Load ===== */
  const buildSaveData = (): SaveData => ({
    version: 2,
    parts,
    log,
    characters,
    simMode,
    scene,
    activeIndex,
  });

  const applySaveData = (data: SaveData) => {
    setParts(data.parts ?? defaultParts);
    setLog(data.log ?? []);
    setCharacters((data.characters ?? []).map(normalizeCharacter));
    setSimMode(data.simMode ?? "observe");
    setScene(data.scene ?? null);
    setActiveIndex(Number.isFinite(data.activeIndex) ? data.activeIndex : 0);
  };

  const exportJson = () => {
    const text = JSON.stringify(buildSaveData(), null, 2);
    setJsonBox(text);
    addLog("💾 세이브: JSON 내보내기");
  };

  const importJson = () => {
    const parsed = safeJsonParse<SaveData>(jsonBox);
    if (!parsed) {
      addLog("⚠️ 로드: JSON 파싱 실패");
      return;
    }
    applySaveData(parsed);
    addLog("📥 로드: JSON 불러오기");
  };

  const resetAll = () => {
    setParts(defaultParts);
    setLog([]);
    setCharacters([makeCharacter({ name: "캐릭터 1" })]);
    setSimMode("observe");
    setScene(null);
    setActiveIndex(0);
    setJsonBox("");
    addLog("🧨 전체 초기화");
  };

  /** 자동 저장 */
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(buildSaveData()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, log, characters, simMode, scene, activeIndex]);

  /** 첫 로드 */
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      addLog("🟢 세션 시작");
      return;
    }
    const parsed = safeJsonParse<SaveData>(raw);
    if (parsed) applySaveData(parsed);
    addLog("🟢 세션 시작 (로컬 자동 로드)");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    const broken = Object.values(parts).filter((s) => s === "broken").length;
    const damaged = Object.values(parts).filter((s) => s === "damaged").length;
    const avgMadness =
      characters.length === 0
        ? 0
        : Math.round((characters.reduce((a, c) => a + c.madness, 0) / characters.length) * 10) / 10;
    return { broken, damaged, logCount: log.length, avgMadness };
  }, [parts, log.length, characters]);

  return (
    <div className="app">
      {/* Header */}
      <div className="headerBar">
        <div>
          <div className="appTitle">네크로니카 TR 시뮬레이터</div>
          <div className="subTitle">1d10 통일 · 보물=심리안정(상실 시 광기↑) · 1씬=3비트(여러 판정)</div>
        </div>

        <div className="topActions">
          <button className="btn btnAccent" onClick={exportJson}>JSON 내보내기</button>
          <button className="btn" onClick={importJson}>JSON 불러오기</button>
          <button className="btn btnDanger" onClick={resetAll}>전체 초기화</button>
        </div>
      </div>

      <div className="layout">
        {/* Sidebar */}
        <div className="sidebar">
          {/* Parts */}
          <div className="panel">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">🧩 파츠</div>
                <div className="panelSub">클릭하면 정상→손상→파괴 순환</div>
              </div>
              <div className="panelSub">손상 {summary.damaged} / 파괴 {summary.broken}</div>
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
          </div>

          {/* Log */}
          <div className="panel">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">📝 로그</div>
                <div className="panelSub">자동 기록 (최대 800줄)</div>
              </div>
              <button className="btn btnDanger" onClick={clearLog} title="로그 초기화">
                초기화
              </button>
            </div>

            <div className="logBox">
              {log.length === 0 ? (
                <div className="hint">아직 로그가 없어.</div>
              ) : (
                log.map((e) => (
                  <div key={e.id} className="logRow">
                    <div className="logTime">{formatTime(e.ts)}</div>
                    <div className="logText">{e.text}</div>
                  </div>
                ))
              )}
            </div>

            <div className="hint">평균 광기: {summary.avgMadness} / 10</div>
          </div>
        </div>

        {/* Main */}
        <div className="main">
          {/* Simulator */}
          <div className="panel">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">🎮 시뮬레이터</div>
                <div className="panelSub">관전/개입 토글 · 1씬=3비트(각 비트마다 1d10 판정)</div>
              </div>

              <div className="row rowWrap">
                <button
                  className={`btn ${simMode === "observe" ? "btnAccent" : ""}`}
                  onClick={() => setSimMode("observe")}
                  title="캐릭터가 자동으로 선택하고 진행(관전)"
                >
                  관전
                </button>
                <button
                  className={`btn ${simMode === "intervene" ? "btnAccent" : ""}`}
                  onClick={() => setSimMode("intervene")}
                  title="네가 선택지를 눌러 진행(개입)"
                >
                  개입
                </button>
                {!scene ? (
                  <button className="btn btnAccent" onClick={beginScene}>씬 시작</button>
                ) : (
                  <button className="btn btnDanger" onClick={endScene}>씬 종료</button>
                )}
              </div>
            </div>

            {!scene ? (
              <div className="hint">
                “씬 시작”을 누르면 자동으로 상황이 생성되고, 비트(최대 3회 판정)로 진행돼.
              </div>
            ) : (
              <>
                <div className="hint">
                  <b>{scene.title}</b> — {scene.intro} <br />
                  비트 <b>{scene.beat}</b> / {scene.beatsTotal} · 긴장 <b>{scene.tension}</b> / 5 · 진행자:{" "}
                  <b>{currentActor?.name ?? "없음"}</b>
                </div>

                <div className="row rowWrap" style={{ marginTop: 10 }}>
                  {choices.map((ch) => (
                    <button
                      key={ch.id}
                      className={`btn ${simMode === "intervene" ? "btnAccent" : ""}`}
                      onClick={() => simMode === "intervene" && advanceBeat(ch)}
                      title={`${ch.type} / 위험도 ${ch.risk}`}
                      disabled={simMode !== "intervene"}
                    >
                      {ch.label} ({ch.type})
                    </button>
                  ))}
                </div>

                <div className="row rowWrap" style={{ marginTop: 10 }}>
                  <button className="btn btnAccent" onClick={() => advanceBeat()} title="관전은 자동 선택 / 개입은 선택지 미선택 시 기본값">
                    다음 비트 진행
                  </button>
                  <div className="hint">
                    판정: <b>1d10</b> · 성공(8~10) / 부분(5~7) / 실패(2~4) / 대참사(1)
                    <br />
                    보물은 심리 안정: <b>정신 판정 완화(+1)</b>, 상실 시 <b>광기 +2</b> & 정신 판정 불리(-1)
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Characters */}
          <div className="panel">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">👤 캐릭터 시트</div>
                <div className="panelSub">포지션/클래스/보물(심리안정) / 보강지점</div>
              </div>
              <button className="btn btnAccent" onClick={addCharacter}>+ 캐릭터 추가</button>
            </div>

            <div className="charList">
              {characters.map((c) => (
                <div key={c.id} className="panel" style={{ padding: 12 }}>
                  <div className="charCardHeader">
                    <div className="charName">{c.name}</div>
                    <button className="btn btnDanger" onClick={() => removeCharacter(c.id)}>삭제</button>
                  </div>

                  <div className="grid2">
                    <div>
                      <div className="fieldLabel">이름</div>
                      <input
                        className="input"
                        value={c.name}
                        onChange={(e) => updateCharacter(c.id, { name: e.target.value })}
                      />
                    </div>

                    <div>
                      <div className="fieldLabel">포지션</div>
                      <select
                        className="select"
                        value={c.position}
                        onChange={(e) => updateCharacter(c.id, { position: e.target.value })}
                      >
                        {OPT.position.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    <div>
                      <div className="fieldLabel">클래스</div>
                      <select
                        className="select"
                        value={c.classType}
                        onChange={(e) => updateCharacter(c.id, { classType: e.target.value })}
                      >
                        {OPT.classType.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    <div>
                      <div className="fieldLabel">보물(심리안정)</div>
                      <select
                        className="select"
                        value={c.treasure}
                        onChange={(e) => updateCharacter(c.id, { treasure: e.target.value })}
                      >
                        {OPT.treasure.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                      <div className="hint">
                        상태: {c.treasureIntact ? "✅ 보유" : "💔 상실"} (상실 시 광기↑)
                      </div>
                      <div className="row rowWrap">
                        <button
                          className={`btn ${c.treasureIntact ? "" : "btnAccent"}`}
                          onClick={() => updateCharacter(c.id, { treasureIntact: true })}
                          type="button"
                        >
                          보물 보유
                        </button>
                        <button
                          className={`btn ${!c.treasureIntact ? "btnDanger" : ""}`}
                          onClick={() => updateCharacter(c.id, { treasureIntact: false, madness: clamp(c.madness + 2, 0, 10) })}
                          type="button"
                          title="보물 상실은 광기 +2"
                        >
                          보물 상실(+2)
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="fieldLabel">보강 지점(분류)</div>
                      <select
                        className="select"
                        value={c.reinforceType}
                        onChange={(e) => updateCharacter(c.id, { reinforceType: e.target.value })}
                      >
                        {OPT.reinforceType.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    <div>
                      <div className="fieldLabel">보강 지점(상세)</div>
                      <input
                        className="input"
                        value={c.reinforceText}
                        onChange={(e) => updateCharacter(c.id, { reinforceText: e.target.value })}
                        placeholder="상세는 직접 입력"
                      />
                    </div>

                    <div>
                      <div className="fieldLabel">기질</div>
                      <select
                        className="select"
                        value={c.temperament}
                        onChange={(e) => updateCharacter(c.id, { temperament: e.target.value })}
                      >
                        {OPT.temperament.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    <div>
                      <div className="fieldLabel">말투</div>
                      <select
                        className="select"
                        value={c.speech}
                        onChange={(e) => updateCharacter(c.id, { speech: e.target.value })}
                      >
                        {OPT.speech.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    <div>
                      <div className="fieldLabel">태도(관계)</div>
                      <select
                        className="select"
                        value={c.trust}
                        onChange={(e) => updateCharacter(c.id, { trust: e.target.value })}
                      >
                        {OPT.trust.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    <div>
                      <div className="fieldLabel">광기(0~10)</div>
                      <div className="row rowWrap">
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={10}
                          value={c.madness}
                          onChange={(e) => updateCharacter(c.id, { madness: clamp(Number(e.target.value || 0), 0, 10) })}
                        />
                        <button className="btn" onClick={() => updateCharacter(c.id, { madness: clamp(c.madness - 1, 0, 10) })}>-1</button>
                        <button className="btn" onClick={() => updateCharacter(c.id, { madness: clamp(c.madness + 1, 0, 10) })}>+1</button>
                      </div>
                      <div className="hint">
                        {c.madness >= 8 ? "⚠️ 고광기: 선택이 거칠어지고 긴장이 올라가기 쉬움" : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="hint" style={{ marginTop: 8 }}>
                    요약: {c.position}/{c.classType} · 보물({c.treasureIntact ? "보유" : "상실"}:{c.treasure}) · 보강({c.reinforceType}:{c.reinforceText || "—"}) · 광기 {c.madness}/10
                  </div>

                  <div className="row rowWrap" style={{ marginTop: 8 }}>
                    <button
                      className="btn"
                      onClick={() => addLog(`👤 ${c.name} — ${c.position}/${c.classType} · 보물:${c.treasure}${c.treasureIntact ? "" : "(상실)"} · 보강:${c.reinforceType}/${c.reinforceText || "—"} · 광기 ${c.madness}/10`)}
                    >
                      요약 로그 남기기
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Save/Load */}
          <div className="panel">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">💾 세이브 / 로드</div>
                <div className="panelSub">자동 저장(localStorage) + JSON 백업/공유</div>
              </div>
            </div>

            <textarea
              className="textarea"
              value={jsonBox}
              onChange={(e) => setJsonBox(e.target.value)}
              placeholder="내보내기 누르면 JSON이 생김. 복붙해서 백업/공유 가능. 불러오기는 JSON 붙여넣고 '불러오기'."
            />
            <div className="hint">
              배포(Vercel) 반영은 수정 후 <b>Commit + Push</b> 해야 갱신돼.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
