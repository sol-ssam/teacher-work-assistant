// lesson_plan(진도계획)을 학년별로 plannedWeek 순서에 따라 나열해 "차시 순서"를 만들고,
// class_progress(학급별 실제 진도)가 그 순서에서 몇 번째 차시에 해당하는지 찾아
// 같은 학년 학급 사이의 진도 차이를 계산한다. AI를 사용하지 않는다.
import { formatClassName } from "./progressComparison";

function gradeOf(className) {
  if (!className) return null;
  const match = String(className).match(/^(\d+)/);
  return match ? match[1] : null;
}

function buildPlanSequenceByGrade(lessonPlans) {
  const byGrade = {};
  for (const step of lessonPlans) {
    const grade = String(step.grade ?? "").trim();
    if (!grade) continue;
    if (!byGrade[grade]) byGrade[grade] = [];
    byGrade[grade].push(step);
  }
  for (const grade of Object.keys(byGrade)) {
    byGrade[grade].sort((a, b) => (a.plannedWeek ?? "").localeCompare(b.plannedWeek ?? ""));
  }
  return byGrade;
}

// class_progress 항목이 학년별 계획 순서에서 몇 번째(1부터)에 해당하는지 찾는다.
// 단원+차시가 정확히 일치하는 계획을 우선 찾고, 없으면 같은 단원의 첫 계획으로 대체한다.
function findStepIndex(sequence, cp) {
  if (!sequence || sequence.length === 0) return null;
  const exact = sequence.findIndex((s) => s.unit === cp.unit && s.lesson === cp.lesson);
  if (exact !== -1) return exact + 1;
  const byUnit = sequence.findIndex((s) => s.unit === cp.unit);
  if (byUnit !== -1) return byUnit + 1;
  return null;
}

export function analyzeProgress(lessonPlans, classProgress) {
  const planByGrade = buildPlanSequenceByGrade(lessonPlans);

  const perClass = classProgress.map((cp) => {
    const grade = gradeOf(cp.className);
    const sequence = grade ? planByGrade[grade] : null;
    const stepIndex = sequence ? findStepIndex(sequence, cp) : null;
    return {
      ...cp,
      grade,
      stepIndex,
      totalSteps: sequence ? sequence.length : null,
    };
  });

  const byGrade = {};
  for (const c of perClass) {
    if (!c.grade || c.stepIndex == null) continue;
    if (!byGrade[c.grade]) byGrade[c.grade] = [];
    byGrade[c.grade].push(c);
  }

  const diffMessages = [];
  for (const grade of Object.keys(byGrade)) {
    const classes = byGrade[grade];
    if (classes.length < 2) continue;
    const fastest = classes.reduce((a, b) => (b.stepIndex > a.stepIndex ? b : a));
    for (const c of classes) {
      if (c.id === fastest.id) continue;
      const diff = fastest.stepIndex - c.stepIndex;
      if (diff > 0) {
        diffMessages.push({
          id: `${grade}-${c.id}`,
          text: `${formatClassName(c.className)}이 ${formatClassName(fastest.className)}보다 ${diff}차시 느립니다.`,
        });
      }
    }
  }

  return { perClass, diffMessages };
}
