'use client';

import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * A text field that cannot be typed past what the record will hold.
 *
 * Every ceiling in this system was enforced only on the server, so a contributor could
 * fill in five steps of a form and learn at the very end that the title they wrote in the
 * second step was sixty characters too long (V7-5). Every other rule in that form is
 * checked as it is broken. This one was not, and the ceiling was invisible until it
 * refused.
 *
 * `maxLength` is the browser's own stop, and it counts the same UTF-16 units the server
 * counts, so the two cannot disagree about when a value is too long. The counter appears
 * as the ceiling comes into range rather than sitting under every field from the start:
 * a count on an empty box is noise, and a count on a nearly full one is the only warning
 * that matters.
 *
 * Both take `max` from the same constants the route checks against, so a field's limit is
 * one number read in two places rather than two numbers that drift.
 */

type Counted = { value: string; max: number; onValueChange: (value: string) => void };

function FieldCount({ value, max }: { value: string; max: number }) {
  const used = value.length;
  // Within ten percent of the ceiling, or the last twenty characters, whichever is wider.
  const showFrom = max - Math.max(20, Math.round(max * 0.1));
  if (max <= 0 || used < showFrom) return null;
  const full = used >= max;
  return (
    // Hidden from assistive technology on purpose. These fields sit inside their label, so
    // a count that changes on every keystroke would keep rewriting the field's own name —
    // "Short title 132 / 140". `maxLength` is what a screen reader reads for the limit.
    <small className={full ? 'field-count at-limit' : 'field-count'} aria-hidden="true">
      {used} / {max}{full ? ' · this field holds no more' : ''}
    </small>
  );
}

export function LimitedInput({ value, max, onValueChange, ...rest }: Counted
  & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'maxLength'>) {
  return (
    <>
      <input {...rest} value={value} maxLength={max} onChange={(event) => onValueChange(event.target.value)} />
      <FieldCount value={value} max={max} />
    </>
  );
}

export function LimitedTextarea({ value, max, onValueChange, ...rest }: Counted
  & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'maxLength'>) {
  return (
    <>
      <textarea {...rest} value={value} maxLength={max} onChange={(event) => onValueChange(event.target.value)} />
      <FieldCount value={value} max={max} />
    </>
  );
}
