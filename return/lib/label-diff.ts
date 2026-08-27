export type LabelDiffSegment = {
  type: 'equal' | 'removed' | 'added';
  text: string;
};

/** Preserve whitespace so both rendered versions reproduce the source copy. */
function tokenize(value: string) {
  return value.match(/\s+|[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*|[^\s]/gu) ?? [];
}

function append(segments: LabelDiffSegment[], type: LabelDiffSegment['type'], text: string) {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.type === type) previous.text += text;
  else segments.push({ type, text });
}

/** A deterministic word-level diff suitable for short public label copy. */
export function diffLabelText(before: string, after: string): LabelDiffSegment[] {
  const left = tokenize(before);
  const right = tokenize(after);
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const segments: LabelDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      append(segments, 'equal', left[i]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      append(segments, 'removed', left[i]);
      i++;
    } else {
      append(segments, 'added', right[j]);
      j++;
    }
  }
  while (i < left.length) append(segments, 'removed', left[i++]);
  while (j < right.length) append(segments, 'added', right[j++]);
  return segments;
}
