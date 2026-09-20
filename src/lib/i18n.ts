import { createContext, useContext } from 'react'
import { ru } from './translations/ru'

// A tiny, dependency-free i18n layer. The source language (English) doubles as the key: the UI
// calls `t('Some text')`, and another language only needs a dictionary mapping that exact English
// text to its translation. Anything missing from a dictionary simply falls back to the English
// text, so a forgotten entry is a visible-but-harmless gap rather than a blank label.
//
//  - `t(text, vars?)`: `{name}` placeholders in the text are replaced from `vars`.
//  - `tn(n, one, other, vars?)`: picks the plural form for `n`. `one` / `other` are the English
//    singular / plural texts (use `{n}` for the number); a dictionary entry for `one` is either a
//    plain string or [one, few, many] forms, the three that Russian-style plurals need.

export type Lang = 'en' | 'ru'

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'ru', label: 'RU' },
]

export type PluralForms = readonly [one: string, few: string, many: string]
export type Dictionary = Record<string, string | PluralForms>
type Vars = Record<string, string | number>

const DICTIONARIES: Record<Lang, Dictionary> = { en: {}, ru }

const STORAGE_KEY = 'dome-builder-lang'
const DEFAULT_LANG: Lang = 'en'

function isLang(value: unknown): value is Lang {
  return LANGUAGES.some((l) => l.value === value)
}

// The remembered choice from the last visit, or English. Wrapped in try/catch since storage can
// be unavailable (private mode, blocked cookies).
export function loadLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isLang(stored) ? stored : DEFAULT_LANG
  } catch {
    return DEFAULT_LANG
  }
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Not remembering the choice is fine.
  }
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

function pluralIndex(lang: Lang, n: number): 0 | 1 | 2 {
  const category = new Intl.PluralRules(lang).select(n)
  if (category === 'one') return 0
  if (category === 'few') return 1
  return 2
}

export interface Translator {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (text: string, vars?: Vars) => string
  tn: (n: number, one: string, other: string, vars?: Vars) => string
}

export function createTranslator(lang: Lang, setLang: (lang: Lang) => void): Translator {
  const dictionary = DICTIONARIES[lang]
  return {
    lang,
    setLang,
    t: (text, vars) => {
      const entry = dictionary[text]
      return interpolate(typeof entry === 'string' ? entry : text, vars)
    },
    tn: (n, one, other, vars) => {
      const entry = dictionary[one]
      const text = Array.isArray(entry)
        ? entry[pluralIndex(lang, n)]
        : typeof entry === 'string'
          ? entry
          : n === 1
            ? one
            : other
      return interpolate(text, { n, ...vars })
    },
  }
}

export const I18nContext = createContext<Translator>(createTranslator(DEFAULT_LANG, () => {}))

export function useI18n(): Translator {
  return useContext(I18nContext)
}
