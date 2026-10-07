import { describe, expect, it } from 'vitest';
import { commandEcho } from './commandEcho.ts';

const known = ['review', 'anthropic-skills:productive-api-personal'];

describe('commandEcho', () => {
  it('writes a known command with its arguments as Claude Code stores it', () => {
    expect(commandEcho('/anthropic-skills:productive-api-personal create an issue\nand link it', known)).toBe(
      '<command-message>anthropic-skills:productive-api-personal</command-message>\n<command-name>/anthropic-skills:productive-api-personal</command-name>\n<command-args>create an issue\nand link it</command-args>',
    );
    expect(commandEcho('/review', known)).toContain('<command-args></command-args>');
  });

  it('leaves prompts that are not a known command alone', () => {
    expect(commandEcho('/tmp is full, clean it up', known)).toBe('/tmp is full, clean it up');
    expect(commandEcho('/Users/me/app/src look here', known)).toBe('/Users/me/app/src look here');
    expect(commandEcho('please /review this', known)).toBe('please /review this');
    expect(commandEcho('/review', [])).toBe('/review');
  });
});
