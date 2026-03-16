import { type FocusArea, type TrainingGoal } from './types'

export function createTrainingGoalDraft(goals: TrainingGoal[]): TrainingGoal[] {
  return goals.map((goal) => ({ ...goal }))
}

export function finalizeTrainingGoalDraft(goals: TrainingGoal[]): TrainingGoal[] {
  return createTrainingGoalDraft(goals)
}

export function haveTrainingGoalDraftChanges(
  savedGoals: TrainingGoal[],
  draftGoals: TrainingGoal[],
): boolean {
  if (savedGoals.length !== draftGoals.length) {
    return true
  }

  return savedGoals.some((goal, index) => {
    const draftGoal = draftGoals[index]
    return (
      !draftGoal ||
      goal.id !== draftGoal.id ||
      goal.label !== draftGoal.label ||
      goal.unit !== draftGoal.unit ||
      goal.target !== draftGoal.target
    )
  })
}

export function createFocusAreaDraft(focusAreas: FocusArea[]): FocusArea[] {
  return normalizeFocusAreas(focusAreas)
}

export function finalizeFocusAreaDraft(focusAreas: FocusArea[]): FocusArea[] {
  return normalizeFocusAreas(focusAreas)
}

export function haveFocusAreaDraftChanges(
  savedFocusAreas: FocusArea[],
  draftFocusAreas: FocusArea[],
): boolean {
  if (savedFocusAreas.length !== draftFocusAreas.length) {
    return true
  }

  return savedFocusAreas.some((focusArea, index) => {
    const draftFocusArea = draftFocusAreas[index]
    return (
      !draftFocusArea ||
      focusArea.id !== draftFocusArea.id ||
      focusArea.label !== draftFocusArea.label ||
      !areStringArraysEqual(
        [...focusArea.scenarioNames].sort((left, right) => left.localeCompare(right)),
        [...draftFocusArea.scenarioNames].sort((left, right) => left.localeCompare(right)),
      )
    )
  })
}

function normalizeFocusAreas(focusAreas: FocusArea[]): FocusArea[] {
  return focusAreas.map((focusArea) => ({
    ...focusArea,
    scenarioNames: [...focusArea.scenarioNames].sort((left, right) => left.localeCompare(right)),
  }))
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}
