import { describe, expect, it } from 'vitest'
import {
  createFocusAreaDraft,
  createTrainingGoalDraft,
  finalizeFocusAreaDraft,
  finalizeTrainingGoalDraft,
  haveFocusAreaDraftChanges,
  haveTrainingGoalDraftChanges,
} from './practice-drafts'
import { type FocusArea, type TrainingGoal } from './types'

describe('practice draft helpers', () => {
  it('creates clean drafts from saved values', () => {
    const goals = buildGoals()
    const focusAreas = buildFocusAreas()

    const goalDraft = createTrainingGoalDraft(goals)
    const focusAreaDraft = createFocusAreaDraft(focusAreas)

    expect(goalDraft).toEqual(goals)
    expect(goalDraft).not.toBe(goals)
    expect(goalDraft[0]).not.toBe(goals[0])
    expect(haveTrainingGoalDraftChanges(goals, goalDraft)).toBe(false)

    expect(focusAreaDraft).toEqual([
      {
        id: 'focus-1',
        label: 'Static',
        scenarioNames: ['Air', 'Bounceshot'],
      },
    ])
    expect(focusAreaDraft).not.toBe(focusAreas)
    expect(focusAreaDraft[0]).not.toBe(focusAreas[0])
    expect(haveFocusAreaDraftChanges(focusAreas, focusAreaDraft)).toBe(false)
  })

  it('detects dirty goal and focus-area drafts', () => {
    const goals = buildGoals()
    const focusAreas = buildFocusAreas()

    const changedGoals = createTrainingGoalDraft(goals)
    changedGoals[0] = {
      ...changedGoals[0],
      target: 8,
    }

    const changedFocusAreas = createFocusAreaDraft(focusAreas)
    changedFocusAreas[0] = {
      ...changedFocusAreas[0],
      scenarioNames: [...changedFocusAreas[0].scenarioNames, 'Static'],
    }

    expect(haveTrainingGoalDraftChanges(goals, changedGoals)).toBe(true)
    expect(haveFocusAreaDraftChanges(focusAreas, changedFocusAreas)).toBe(true)
  })

  it('finalizes drafts into cloned saved values', () => {
    const goals = buildGoals()
    const focusAreas = buildFocusAreas()
    const finalizedGoals = finalizeTrainingGoalDraft(goals)
    const finalizedFocusAreas = finalizeFocusAreaDraft(focusAreas)

    expect(finalizedGoals).toEqual(goals)
    expect(finalizedGoals).not.toBe(goals)
    expect(finalizedFocusAreas).toEqual([
      {
        id: 'focus-1',
        label: 'Static',
        scenarioNames: ['Air', 'Bounceshot'],
      },
    ])
    expect(finalizedFocusAreas).not.toBe(focusAreas)
    expect(finalizedFocusAreas[0].scenarioNames).toEqual(['Air', 'Bounceshot'])
  })
})

function buildGoals(): TrainingGoal[] {
  return [
    { id: 'weeklyHours', label: 'Weekly playtime', unit: 'hours', target: 5 },
    { id: 'activeDays', label: 'Active days', unit: 'days', target: 4 },
  ]
}

function buildFocusAreas(): FocusArea[] {
  return [
    {
      id: 'focus-1',
      label: 'Static',
      scenarioNames: ['Bounceshot', 'Air'],
    },
  ]
}
