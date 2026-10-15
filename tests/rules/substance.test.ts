import { describe, it, expect } from 'vitest';
import {
  assessEvidenceItem,
  assessEvidenceList,
  assessFalsificationCondition,
  assessReviewAnswer,
} from '../../src/rules/substance.js';

describe('assessFalsificationCondition', () => {
  it.each([
    "if it's wrong",
    'The hypothesis is false.',
    'I am wrong',
    'n/a',
    'none',
    'if proven wrong',
    'data contradicts the claim',
  ])('rejects a restatement of "it could be wrong": %s', (text) => {
    expect(assessFalsificationCondition(text).ok).toBe(false);
  });

  it('rejects text too short to describe an observation', () => {
    expect(assessFalsificationCondition('no change').ok).toBe(false);
  });

  it.each([
    'no drop in reaction time versus placebo',
    'Reaction time is unchanged or rises.',
    'a calorimeter shows output equal to input',
  ])('accepts a described observation: %s', (text) => {
    expect(assessFalsificationCondition(text).ok).toBe(true);
  });
});

describe('assessReviewAnswer', () => {
  it.each(['ok', 'n/a', 'fine', 'yes', 'too broad'])('rejects an empty-calorie answer: %s', (text) => {
    expect(assessReviewAnswer('q1Methods', text).ok).toBe(false);
  });

  it('accepts a real answer and names the question when it fails', () => {
    expect(assessReviewAnswer('q1Methods', 'The protocol was blinded and sound.').ok).toBe(true);
    const failed = assessReviewAnswer('q2Hypothesis', 'ok');
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toContain('q2Hypothesis');
  });
});

describe('assessEvidence', () => {
  it('rejects a bare noun and placeholders', () => {
    expect(assessEvidenceItem('data').ok).toBe(false);
    expect(assessEvidenceItem('n/a').ok).toBe(false);
    expect(assessEvidenceList(['reaction time fell', 'x']).ok).toBe(false);
  });

  it('accepts a described observation', () => {
    expect(assessEvidenceList(['reaction time fell versus placebo']).ok).toBe(true);
  });
});
