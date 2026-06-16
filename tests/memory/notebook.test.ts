import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotebookStore } from '../../src/memory/notebook.js';

describe('NotebookStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'falsify-notebook-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records an entry and reads it back', () => {
    const store = new NotebookStore(dir, 'test');
    const item = store.record({ kind: 'hypothesis', text: 'Coffee causes rain' });

    expect(item.id).toBeTruthy();
    expect(item.kind).toBe('hypothesis');
    expect(item.createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.text).toBe('Coffee causes rain');
    expect(listed[0]?.struck).toBeUndefined();
  });

  it('marks an entry struck-through with a dated reason', () => {
    const store = new NotebookStore(dir, 'test');
    const item = store.record({ kind: 'mistake', text: 'Predicted X, observed not-X' });

    const struck = store.strikeThrough(item.id, 'refuted by decisive evidence');
    expect(struck).toBe(true);

    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.struck?.reason).toBe('refuted by decisive evidence');
    expect(listed[0]?.struck?.struckAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('never deletes the original line when striking through', () => {
    const store = new NotebookStore(dir, 'test');
    const item = store.record({ kind: 'mistake', text: 'original-claim-text' });
    store.strikeThrough(item.id, 'wrong');

    const file = join(dir, 'test.jsonl');
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf8');
    // the original entry event is still physically present after the strike
    expect(raw).toContain('"type":"entry"');
    expect(raw).toContain('original-claim-text');
    expect(raw).toContain('"type":"strike"');
  });

  it('is a no-op (no crash) when striking an unknown id', () => {
    const store = new NotebookStore(dir, 'test');
    store.record({ kind: 'mistake', text: 'kept' });

    const struck = store.strikeThrough('does-not-exist', 'whatever');
    expect(struck).toBe(false);

    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.struck).toBeUndefined();
  });

  it('returns an empty list when the notebook file does not exist yet', () => {
    const store = new NotebookStore(dir, 'fresh');
    expect(store.list()).toEqual([]);
  });

  it('preserves record order across many entries', () => {
    const store = new NotebookStore(dir, 'test');
    const a = store.record({ kind: 'hypothesis', text: 'A' });
    const b = store.record({ kind: 'hypothesis', text: 'B' });
    const c = store.record({ kind: 'hypothesis', text: 'C' });
    store.strikeThrough(b.id, 'mid');

    const ids = store.list().map((i) => i.id);
    expect(ids).toEqual([a.id, b.id, c.id]);
  });
});
