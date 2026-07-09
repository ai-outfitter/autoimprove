import { describe, expect, it } from 'vitest';
import { extractFirstJson, parseEditsResponse } from '../src/index.js';

describe('extractFirstJson', () => {
  it('parses a bare JSON array', () => {
    expect(extractFirstJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('parses JSON surrounded by prose and code fences', () => {
    const text = 'Here are my edits:\n```json\n[{"op": "add", "text": "x"}]\n```\nHope that helps!';
    expect(extractFirstJson(text)).toEqual([{ op: 'add', text: 'x' }]);
  });

  it('skips bracket-looking prose and finds the real JSON', () => {
    const text = 'See [ref 1] and [sec 2, above. The answer: {"edits": []}';
    expect(extractFirstJson(text)).toEqual({ edits: [] });
  });

  it('handles brackets and braces inside JSON strings', () => {
    const text = 'Result: [{"op": "replace", "target": "use arr[0]", "text": "use { arr[0] }"}]';
    expect(extractFirstJson(text)).toEqual([
      { op: 'replace', target: 'use arr[0]', text: 'use { arr[0] }' },
    ]);
  });

  it('returns undefined for text with no JSON', () => {
    expect(extractFirstJson('no json here at all')).toBeUndefined();
    expect(extractFirstJson('unbalanced [ bracket')).toBeUndefined();
  });
});

describe('parseEditsResponse', () => {
  it('accepts a bare array of edits', () => {
    const edits = parseEditsResponse('[{"op": "add", "text": "hello", "rationale": "why"}]');
    expect(edits).toEqual([{ op: 'add', text: 'hello', rationale: 'why' }]);
  });

  it('accepts an object with an edits array', () => {
    const edits = parseEditsResponse('{"edits": [{"op": "delete", "target": "old line"}]}');
    expect(edits).toEqual([{ op: 'delete', target: 'old line' }]);
  });

  it('drops malformed items but keeps valid ones', () => {
    const edits = parseEditsResponse(
      '[{"op": "add", "text": "keep"}, {"op": "explode"}, {"target": "no op"}, null, 42]',
    );
    expect(edits).toEqual([{ op: 'add', text: 'keep' }]);
  });

  it('ignores non-string field values', () => {
    const edits = parseEditsResponse('[{"op": "add", "text": 5, "target": null}]');
    expect(edits).toEqual([{ op: 'add' }]);
  });

  it('returns an empty list for invalid input, never throws', () => {
    expect(parseEditsResponse('')).toEqual([]);
    expect(parseEditsResponse('I could not decide on any edits.')).toEqual([]);
    expect(parseEditsResponse('{"broken": ')).toEqual([]);
    expect(parseEditsResponse('{"other": "shape"}')).toEqual([]);
  });
});
