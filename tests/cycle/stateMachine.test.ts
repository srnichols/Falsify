import { describe, it, expect } from 'vitest';
import {
  transition,
  legalEvents,
  isTerminal,
  INITIAL_STATE,
  CycleTransitionError,
  type CycleEvent,
} from '../../src/cycle/stateMachine.js';
import type { CycleState } from '../../src/domain/types.js';

describe('cycle state machine — happy path', () => {
  it('runs intake → … → theory', () => {
    let state: CycleState = INITIAL_STATE;
    expect(state).toBe('intake');
    state = transition(state, 'hypothesize');
    expect(state).toBe('hypothesis');
    state = transition(state, 'experiment');
    expect(state).toBe('experiment');
    state = transition(state, 'analyze');
    expect(state).toBe('analysis');
    state = transition(state, 'confirm');
    expect(state).toBe('theory');
    expect(isTerminal(state)).toBe(true);
  });
});

describe('cycle state machine — the No branch', () => {
  it('routes analysis → review → hypothesis on refute then revise', () => {
    let state: CycleState = 'analysis';
    state = transition(state, 'refute');
    expect(state).toBe('review');
    state = transition(state, 'revise');
    expect(state).toBe('hypothesis');
  });

  it('can loop the full cycle more than once', () => {
    let state: CycleState = INITIAL_STATE;
    state = transition(state, 'hypothesize'); // hypothesis
    state = transition(state, 'experiment'); // experiment
    state = transition(state, 'analyze'); // analysis
    state = transition(state, 'refute'); // review
    state = transition(state, 'revise'); // back to hypothesis
    expect(state).toBe('hypothesis');
    state = transition(state, 'experiment'); // experiment again
    state = transition(state, 'analyze'); // analysis again
    state = transition(state, 'confirm'); // theory
    expect(state).toBe('theory');
  });
});

describe('cycle state machine — illegal transitions', () => {
  it('rejects intake → theory (no shortcut to a Yes)', () => {
    expect(() => transition('intake', 'confirm')).toThrow(CycleTransitionError);
  });

  it('rejects advancing out of the terminal theory state', () => {
    expect(() => transition('theory', 'hypothesize' as CycleEvent)).toThrow(CycleTransitionError);
  });

  it('rejects skipping the experiment step', () => {
    expect(() => transition('hypothesis', 'analyze')).toThrow(CycleTransitionError);
  });

  it('error carries the offending from-state and event', () => {
    try {
      transition('intake', 'confirm');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CycleTransitionError);
      const e = err as CycleTransitionError;
      expect(e.from).toBe('intake');
      expect(e.event).toBe('confirm');
    }
  });
});

describe('cycle state machine — introspection', () => {
  it('reports legal events per state', () => {
    expect(legalEvents('intake')).toEqual(['hypothesize']);
    expect(legalEvents('analysis').sort()).toEqual(['confirm', 'refute']);
    expect(legalEvents('theory')).toEqual([]);
  });

  it('only theory is terminal', () => {
    const states: CycleState[] = ['intake', 'hypothesis', 'experiment', 'analysis', 'review', 'theory'];
    const terminal = states.filter(isTerminal);
    expect(terminal).toEqual(['theory']);
  });
});
