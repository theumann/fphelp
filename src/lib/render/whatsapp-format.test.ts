import { describe, expect, it } from 'vitest'

import { parseLine, parseWhatsApp } from './whatsapp-format'

describe('parseLine', () => {
  it('reads bold, italic and strike', () => {
    expect(parseLine('*Standings*')).toEqual([{ text: 'Standings', bold: true }])
    expect(parseLine('a _quiet_ week, ~no~ some')).toEqual([
      { text: 'a ' },
      { text: 'quiet', italic: true },
      { text: ' week, ' },
      { text: 'no', strike: true },
      { text: ' some' },
    ])
  })

  it('leaves markers inside words alone', () => {
    expect(parseLine('snake_case_name')).toEqual([{ text: 'snake_case_name' }])
    expect(parseLine('2*3*4')).toEqual([{ text: '2*3*4' }])
  })

  it('needs the content to hug its markers', () => {
    expect(parseLine('a * b * c')).toEqual([{ text: 'a * b * c' }])
  })

  it('keeps arrows and figures as they are', () => {
    expect(parseLine('1. Fozzy FC: 742 ▲2')).toEqual([{ text: '1. Fozzy FC: 742 ▲2' }])
  })

  it('returns nothing for an empty line, which renders as a blank one', () => {
    expect(parseLine('')).toEqual([])
  })
})

describe('parseWhatsApp', () => {
  it('splits a fenced block out as code, without its fences', () => {
    expect(parseWhatsApp('*Prizes*\n```\nPot   $1,800\n1st   $500\n```\nGood luck')).toEqual([
      { kind: 'text', lines: [[{ text: 'Prizes', bold: true }]] },
      { kind: 'code', text: 'Pot   $1,800\n1st   $500' },
      { kind: 'text', lines: [[{ text: 'Good luck' }]] },
    ])
  })

  it('treats an unclosed fence as text, as WhatsApp does', () => {
    expect(parseWhatsApp('```\nPot')).toEqual([
      { kind: 'text', lines: [[{ text: '```' }], [{ text: 'Pot' }]] },
    ])
  })

  it('does not read markup inside a code block', () => {
    expect(parseWhatsApp('```\n*not bold*\n```')).toEqual([{ kind: 'code', text: '*not bold*' }])
  })
})
